/**
 * CRM Dashboard Service
 *
 * Provides pre-computed analytics from the CRM gift tables
 * for the CRM dashboard and fundraiser performance pages.
 * Results are cached for 10 minutes to avoid repeated heavy queries.
 *
 * All query functions accept an optional dateRange { startDate, endDate }
 * to filter by fiscal year (April 1 – March 31).
 */
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// Options for heavy aggregate queries — must complete before Render's 30s proxy timeout
const QUERY_OPTS = { type: QueryTypes.SELECT, timeout: 20000 };

// Simple in-memory cache: key → { data, expiry }
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function cached(key, fn) {
  return async (...args) => {
    const cacheKey = `${key}:${JSON.stringify(args)}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() < hit.expiry) return hit.data;
    const data = await fn(...args);
    cache.set(cacheKey, { data, expiry: Date.now() + CACHE_TTL });
    return data;
  };
}

// Clear cache when new data is imported
function clearCrmCache(tenantId) {
  for (const key of cache.keys()) {
    if (key.includes(tenantId)) cache.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Date-range SQL helpers
// ---------------------------------------------------------------------------
function dateWhere(dateRange, alias) {
  if (!dateRange) return '';
  const col = alias ? `${alias}.gift_date` : 'gift_date';
  return ` AND ${col} >= :startDate AND ${col} < :endDate`;
}

function dateReplacements(dateRange) {
  if (!dateRange) return {};
  return { startDate: dateRange.startDate, endDate: dateRange.endDate };
}

// Extract FY number from dateRange (endDate is always "${fy}-04-01")
function fyFromDateRange(dateRange) {
  if (!dateRange) return null;
  return Number(dateRange.endDate.split('-')[0]);
}

// Try MV query first with a 10s race; if it fails or is slow, fall back to raw query
async function tryMV(mvQuery, fallbackQuery) {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('MV query timeout (10s)')), 10000));
    return await Promise.race([mvQuery(), timeout]);
  } catch (err) {
    console.warn('[CRM MV Fallback]', err.message);
    return fallbackQuery();
  }
}

// ---------------------------------------------------------------------------
// Discover which fiscal years exist in the data (April 1 – March 31)
// FY2025 = April 1 2024 – March 31 2025
// ---------------------------------------------------------------------------
async function getFiscalYears(tenantId) {
  const rows = await tryMV(
    () => sequelize.query(`
      SELECT fy, gift_count, total FROM mv_crm_fiscal_years
      WHERE tenant_id = :tenantId ORDER BY fy DESC
    `, { replacements: { tenantId }, ...QUERY_OPTS }),
    () => sequelize.query(`
      SELECT CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
             THEN EXTRACT(YEAR FROM gift_date) + 1
             ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
             COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
      GROUP BY fy ORDER BY fy DESC
    `, { replacements: { tenantId }, ...QUERY_OPTS })
  );
  return rows.map(r => ({
    fy: Number(r.fy),
    label: `FY${r.fy}`,
    gift_count: Number(r.gift_count),
    total: Number(r.total),
  }));
}

// ---------------------------------------------------------------------------
// Dashboard queries — all accept optional dateRange
// ---------------------------------------------------------------------------

async function getCrmOverview(tenantId, dateRange) {
  const empty = { total_gifts: 0, total_raised: 0, avg_gift: 0, largest_gift: 0, earliest_date: null, latest_date: null, unique_donors: 0, unique_funds: 0, unique_campaigns: 0, unique_appeals: 0 };
  const overviewCols = `COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
    COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
    MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
    COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
    COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals`;
  const fy = fyFromDateRange(dateRange);
  if (fy) {
    const [row] = await tryMV(
      () => sequelize.query(`
        SELECT total_gifts, total_raised, avg_gift, largest_gift, earliest_date, latest_date,
               unique_donors, unique_funds, unique_campaigns, unique_appeals
        FROM mv_crm_fy_overview WHERE tenant_id = :tenantId AND fiscal_year = :fy
      `, { replacements: { tenantId, fy }, ...QUERY_OPTS }),
      () => sequelize.query(`
        SELECT ${overviewCols} FROM crm_gifts WHERE tenant_id = :tenantId${dateWhere(dateRange)}
      `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS })
    );
    return row || empty;
  }
  const [row] = await tryMV(
    () => sequelize.query(`
      SELECT total_gifts, total_raised, avg_gift, largest_gift, earliest_date, latest_date,
             unique_donors, unique_funds, unique_campaigns, unique_appeals
      FROM mv_crm_alltime_overview WHERE tenant_id = :tenantId
    `, { replacements: { tenantId }, ...QUERY_OPTS }),
    () => sequelize.query(`
      SELECT ${overviewCols} FROM crm_gifts WHERE tenant_id = :tenantId
    `, { replacements: { tenantId }, ...QUERY_OPTS })
  );
  return row || empty;
}

async function getGivingByMonth(tenantId, dateRange, limit = 24) {
  const fy = fyFromDateRange(dateRange);
  return tryMV(
    () => {
      const fyWhere = fy ? ' AND fiscal_year = :fy' : '';
      return sequelize.query(`
        SELECT month, SUM(gift_count)::int as gift_count, SUM(total) as total
        FROM mv_crm_giving_by_month WHERE tenant_id = :tenantId${fyWhere}
        GROUP BY month ORDER BY month DESC LIMIT :limit
      `, { replacements: { tenantId, fy, limit }, ...QUERY_OPTS });
    },
    () => sequelize.query(`
      SELECT TO_CHAR(gift_date, 'YYYY-MM') as month, COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND gift_date IS NOT NULL${dateWhere(dateRange)}
      GROUP BY month ORDER BY month DESC LIMIT :limit
    `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, ...QUERY_OPTS })
  );
}

async function getTopDonors(tenantId, dateRange, limit = 15) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT first_name, last_name, constituent_id, COUNT(*) as gift_count,
           SUM(gift_amount) as total, MAX(gift_date) as last_gift_date
    FROM crm_gifts WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dateWhere(dateRange)}
    GROUP BY first_name, last_name, constituent_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT first_name, last_name, constituent_id, gift_count, total, last_gift_date
      FROM mv_crm_donor_totals WHERE tenant_id = :tenantId AND fiscal_year = :fy
      ORDER BY total DESC LIMIT :limit
    `, { replacements: { tenantId, fy, limit }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT first_name, last_name, constituent_id,
           SUM(gift_count)::int as gift_count, SUM(total) as total, MAX(last_gift_date) as last_gift_date
    FROM mv_crm_donor_totals WHERE tenant_id = :tenantId
    GROUP BY first_name, last_name, constituent_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, ...QUERY_OPTS }), fallback);
}

async function getTopFunds(tenantId, dateRange, limit = 10) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT fund_description, fund_id, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts WHERE tenant_id = :tenantId AND fund_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY fund_description, fund_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT fund_description, fund_id, gift_count, total FROM mv_crm_fund_totals
      WHERE tenant_id = :tenantId AND fiscal_year = :fy ORDER BY total DESC LIMIT :limit
    `, { replacements: { tenantId, fy, limit }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT fund_description, fund_id, SUM(gift_count)::int as gift_count, SUM(total) as total
    FROM mv_crm_fund_totals WHERE tenant_id = :tenantId
    GROUP BY fund_description, fund_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, ...QUERY_OPTS }), fallback);
}

async function getTopCampaigns(tenantId, dateRange, limit = 10) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT campaign_description, campaign_id, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY campaign_description, campaign_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT campaign_description, campaign_id, gift_count, total FROM mv_crm_campaign_totals
      WHERE tenant_id = :tenantId AND fiscal_year = :fy ORDER BY total DESC LIMIT :limit
    `, { replacements: { tenantId, fy, limit }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT campaign_description, campaign_id, SUM(gift_count)::int as gift_count, SUM(total) as total
    FROM mv_crm_campaign_totals WHERE tenant_id = :tenantId
    GROUP BY campaign_description, campaign_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, ...QUERY_OPTS }), fallback);
}

async function getTopAppeals(tenantId, dateRange, limit = 10) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT appeal_description, appeal_id, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts WHERE tenant_id = :tenantId AND appeal_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY appeal_description, appeal_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT appeal_description, appeal_id, gift_count, total FROM mv_crm_appeal_totals
      WHERE tenant_id = :tenantId AND fiscal_year = :fy ORDER BY total DESC LIMIT :limit
    `, { replacements: { tenantId, fy, limit }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT appeal_description, appeal_id, SUM(gift_count)::int as gift_count, SUM(total) as total
    FROM mv_crm_appeal_totals WHERE tenant_id = :tenantId
    GROUP BY appeal_description, appeal_id ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, ...QUERY_OPTS }), fallback);
}

async function getGiftsByType(tenantId, dateRange) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT COALESCE(gift_code, 'Unknown') as gift_type, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    GROUP BY gift_type ORDER BY total DESC LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT gift_type, gift_count, total FROM mv_crm_gift_types
      WHERE tenant_id = :tenantId AND fiscal_year = :fy ORDER BY total DESC LIMIT 15
    `, { replacements: { tenantId, fy }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT gift_type, SUM(gift_count)::int as gift_count, SUM(total) as total
    FROM mv_crm_gift_types WHERE tenant_id = :tenantId
    GROUP BY gift_type ORDER BY total DESC LIMIT 15
  `, { replacements: { tenantId }, ...QUERY_OPTS }), fallback);
}

// ---------------------------------------------------------------------------
// Fundraiser Performance — all accept optional dateRange
// ---------------------------------------------------------------------------

async function getFundraiserLeaderboard(tenantId, dateRange) {
  const fy = fyFromDateRange(dateRange);
  const fallback = () => sequelize.query(`
    SELECT f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name,
           COUNT(DISTINCT f.gift_id) as gift_count, COUNT(DISTINCT g.constituent_id) as donor_count,
           SUM(f.fundraiser_amount) as total_credited, SUM(g.gift_amount) as total_gift_amount,
           MIN(g.gift_date) as earliest_gift, MAX(g.gift_date) as latest_gift
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name IS NOT NULL${dateWhere(dateRange, 'g')}
    GROUP BY f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
    ORDER BY total_credited DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  if (fy) {
    return tryMV(() => sequelize.query(`
      SELECT fundraiser_name, fundraiser_first_name, fundraiser_last_name,
             gift_count, donor_count, total_credited, total_gift_amount, earliest_gift, latest_gift
      FROM mv_crm_fundraiser_totals WHERE tenant_id = :tenantId AND fiscal_year = :fy
      ORDER BY total_credited DESC
    `, { replacements: { tenantId, fy }, ...QUERY_OPTS }), fallback);
  }
  return tryMV(() => sequelize.query(`
    SELECT fundraiser_name, fundraiser_first_name, fundraiser_last_name,
           SUM(gift_count)::int as gift_count, SUM(donor_count)::int as donor_count,
           SUM(total_credited) as total_credited, SUM(total_gift_amount) as total_gift_amount,
           MIN(earliest_gift) as earliest_gift, MAX(latest_gift) as latest_gift
    FROM mv_crm_fundraiser_totals WHERE tenant_id = :tenantId
    GROUP BY fundraiser_name, fundraiser_first_name, fundraiser_last_name
    ORDER BY total_credited DESC
  `, { replacements: { tenantId }, ...QUERY_OPTS }), fallback);
}

async function getFundraiserPortfolio(tenantId, fundraiserName, dateRange) {
  const dr = dateReplacements(dateRange);
  const dw = dateWhere(dateRange, 'g');
  const repl = { tenantId, fundraiserName, ...dr };
  console.log('[getFundraiserPortfolio] Start:', fundraiserName);
  const t0 = Date.now();

  // Get the gift IDs for this fundraiser first (fast indexed lookup)
  const fundraiserGifts = await sequelize.query(`
    SELECT gift_id FROM crm_gift_fundraisers
    WHERE tenant_id = :tenantId AND fundraiser_name = :fundraiserName
  `, { replacements: { tenantId, fundraiserName }, ...QUERY_OPTS });
  console.log('[getFundraiserPortfolio] Gift IDs:', fundraiserGifts.length, 'in', Date.now() - t0, 'ms');

  if (fundraiserGifts.length === 0) {
    return { summary: null, donors: [], byFund: [], byMonth: [] };
  }

  const giftIds = fundraiserGifts.map(g => g.gift_id);

  // Now query crm_gifts using IN clause instead of JOIN (much faster)
  const dw2 = dateWhere(dateRange);
  const repl2 = { tenantId, giftIds, ...dr };

  // Sequential to avoid overloading the tiny Postgres instance
  const summaryRows = await sequelize.query(`
    SELECT
      COUNT(*) as total_gifts,
      COUNT(DISTINCT constituent_id) as total_donors,
      COALESCE(SUM(gift_amount), 0) as total_gift_amount,
      COALESCE(AVG(gift_amount), 0) as avg_gift
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_id IN (:giftIds)${dw2}
  `, { replacements: repl2, ...QUERY_OPTS });

  const donors = await sequelize.query(`
    SELECT
      first_name, last_name, constituent_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total_credited,
      SUM(gift_amount) as total_gift_amount,
      MIN(gift_date) as first_gift,
      MAX(gift_date) as last_gift
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_id IN (:giftIds)${dw2}
    GROUP BY first_name, last_name, constituent_id
    ORDER BY total_credited DESC LIMIT 50
  `, { replacements: repl2, ...QUERY_OPTS });

  const byFund = await sequelize.query(`
    SELECT fund_description, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_id IN (:giftIds)${dw2}
    GROUP BY fund_description ORDER BY total DESC LIMIT 10
  `, { replacements: repl2, ...QUERY_OPTS });

  const byMonth = await sequelize.query(`
    SELECT TO_CHAR(gift_date, 'YYYY-MM') as month, COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_id IN (:giftIds) AND gift_date IS NOT NULL${dw2}
    GROUP BY month ORDER BY month DESC LIMIT 24
  `, { replacements: repl2, ...QUERY_OPTS });

  // Get the total credited amount from the fundraiser table itself
  const creditRows = await sequelize.query(`
    SELECT COALESCE(SUM(fundraiser_amount), 0) as total_credited
    FROM crm_gift_fundraisers
    WHERE tenant_id = :tenantId AND fundraiser_name = :fundraiserName
      AND gift_id IN (:giftIds)
  `, { replacements: { tenantId, fundraiserName, giftIds }, ...QUERY_OPTS });

  const summary = summaryRows[0] || {};
  summary.total_credited = creditRows[0] ? creditRows[0].total_credited : summary.total_gift_amount;

  console.log('[getFundraiserPortfolio] Done in', Date.now() - t0, 'ms');
  return { summary, donors, byFund, byMonth };
}

// ---------------------------------------------------------------------------
// Donor Retention / Lapsed Analysis
// Compares two fiscal years to find retained, new, lapsed, and recovered donors
// ---------------------------------------------------------------------------
async function getDonorRetention(tenantId, currentFY) {
  if (!currentFY) return null;
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd = `${currentFY - 1}-04-01`;
  const olderEnd = prevStart; // anything before prior FY

  const [result] = await sequelize.query(`
    WITH cur AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd
        AND constituent_id IS NOT NULL
    ),
    prev AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd
        AND constituent_id IS NOT NULL
    ),
    older AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date < :olderEnd
        AND constituent_id IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM cur) as current_donors,
      (SELECT COUNT(*) FROM prev) as prior_donors,
      (SELECT COUNT(*) FROM cur c INNER JOIN prev p ON c.constituent_id = p.constituent_id) as retained,
      (SELECT COUNT(*) FROM cur c LEFT JOIN prev p ON c.constituent_id = p.constituent_id
        LEFT JOIN older o ON c.constituent_id = o.constituent_id
        WHERE p.constituent_id IS NULL AND o.constituent_id IS NULL) as brand_new,
      (SELECT COUNT(*) FROM cur c LEFT JOIN prev p ON c.constituent_id = p.constituent_id
        INNER JOIN older o ON c.constituent_id = o.constituent_id
        WHERE p.constituent_id IS NULL) as recovered,
      (SELECT COUNT(*) FROM prev p LEFT JOIN cur c ON p.constituent_id = c.constituent_id
        WHERE c.constituent_id IS NULL) as lapsed
  `, {
    replacements: { tenantId, curStart, curEnd, prevStart, prevEnd, olderEnd },
    ...QUERY_OPTS,
  });
  return {
    currentFY,
    priorFY: currentFY - 1,
    current_donors: Number(result.current_donors),
    prior_donors: Number(result.prior_donors),
    retained: Number(result.retained),
    brand_new: Number(result.brand_new),
    recovered: Number(result.recovered),
    lapsed: Number(result.lapsed),
    retention_rate: Number(result.prior_donors) > 0
      ? (Number(result.retained) / Number(result.prior_donors) * 100).toFixed(1)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Giving Pyramid — donor distribution by gift-size bands
// ---------------------------------------------------------------------------
async function getGivingPyramid(tenantId, dateRange) {
  return sequelize.query(`
    SELECT
      CASE
        WHEN total < 100 THEN '$1 – $99'
        WHEN total < 500 THEN '$100 – $499'
        WHEN total < 1000 THEN '$500 – $999'
        WHEN total < 5000 THEN '$1,000 – $4,999'
        WHEN total < 10000 THEN '$5,000 – $9,999'
        WHEN total < 25000 THEN '$10,000 – $24,999'
        WHEN total < 50000 THEN '$25,000 – $49,999'
        WHEN total < 100000 THEN '$50,000 – $99,999'
        ELSE '$100,000+'
      END AS band,
      CASE
        WHEN total < 100 THEN 1
        WHEN total < 500 THEN 2
        WHEN total < 1000 THEN 3
        WHEN total < 5000 THEN 4
        WHEN total < 10000 THEN 5
        WHEN total < 25000 THEN 6
        WHEN total < 50000 THEN 7
        WHEN total < 100000 THEN 8
        ELSE 9
      END AS sort_order,
      COUNT(*) as donor_count,
      SUM(total) as band_total,
      AVG(total) as band_avg
    FROM (
      SELECT constituent_id, SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dateWhere(dateRange)}
      GROUP BY constituent_id
    ) donor_totals
    GROUP BY band, sort_order
    ORDER BY sort_order
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
}

// ---------------------------------------------------------------------------
// Donor Detail
// ---------------------------------------------------------------------------
async function getDonorDetail(tenantId, constituentId) {
  const repl = { tenantId, constituentId };
  console.log('[getDonorDetail] Start, constituentId:', constituentId);
  const t0 = Date.now();

  // Run the lightweight queries first
  const [gifts, summaryRows, byYear] = await Promise.all([
    sequelize.query(`
      SELECT gift_id, gift_date, gift_amount, gift_code,
             fund_description, fund_id, campaign_description, campaign_id,
             appeal_description, appeal_id
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId
      ORDER BY gift_date DESC
      LIMIT 500
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT
        first_name, last_name, constituent_id,
        COUNT(*) as total_gifts,
        COALESCE(SUM(gift_amount), 0) as total_given,
        COALESCE(AVG(gift_amount), 0) as avg_gift,
        COALESCE(MAX(gift_amount), 0) as largest_gift,
        MIN(gift_date) as first_gift_date,
        MAX(gift_date) as last_gift_date,
        COUNT(DISTINCT fund_id) as unique_funds,
        COUNT(DISTINCT campaign_id) as unique_campaigns
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId
      GROUP BY first_name, last_name, constituent_id
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT
        CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
             THEN EXTRACT(YEAR FROM gift_date) + 1
             ELSE EXTRACT(YEAR FROM gift_date)
        END AS fy,
        COUNT(*) as gift_count,
        SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId AND gift_date IS NOT NULL
      GROUP BY fy ORDER BY fy DESC
    `, { replacements: repl, ...QUERY_OPTS }),
  ]);
  console.log('[getDonorDetail] Core queries done in', Date.now() - t0, 'ms');

  // Fundraiser lookup — use gift IDs from the gifts we already fetched instead of a join
  let fundraisers = [];
  if (gifts.length > 0) {
    const giftIds = [...new Set(gifts.map(g => g.gift_id))].slice(0, 200);
    try {
      const rows = await sequelize.query(`
        SELECT DISTINCT fundraiser_name
        FROM crm_gift_fundraisers
        WHERE tenant_id = :tenantId AND gift_id IN (:giftIds)
          AND fundraiser_name IS NOT NULL
      `, { replacements: { tenantId, giftIds }, ...QUERY_OPTS });
      fundraisers = rows.map(f => f.fundraiser_name);
    } catch (err) {
      console.warn('[getDonorDetail] Fundraiser lookup failed:', err.message);
    }
  }
  console.log('[getDonorDetail] Total:', Date.now() - t0, 'ms');

  return { summary: summaryRows[0] || null, gifts, byYear, fundraisers };
}

// ---------------------------------------------------------------------------
// Gift Search with pagination
// ---------------------------------------------------------------------------
async function searchGifts(tenantId, { page = 1, limit = 50, search, fund, campaign, appeal, minAmount, maxAmount, dateRange, sortBy = 'gift_date', sortDir = 'DESC' } = {}) {
  const where = ['g.tenant_id = :tenantId'];
  const replacements = { tenantId };

  if (search) {
    // Support multi-word search: "Glenn Craig" matches first_name=Glenn + last_name=Craig
    const terms = search.trim().split(/\s+/);
    if (terms.length > 1) {
      where.push(`(
        (g.first_name ILIKE :searchFirst AND g.last_name ILIKE :searchLast)
        OR g.first_name ILIKE :search OR g.last_name ILIKE :search
        OR g.constituent_id ILIKE :search
        OR CONCAT(g.first_name, ' ', g.last_name) ILIKE :search
      )`);
      replacements.searchFirst = `%${terms[0]}%`;
      replacements.searchLast = `%${terms[terms.length - 1]}%`;
    } else {
      where.push(`(g.first_name ILIKE :search OR g.last_name ILIKE :search OR g.constituent_id ILIKE :search)`);
    }
    replacements.search = `%${search}%`;
  }
  if (fund) { where.push('g.fund_id = :fund'); replacements.fund = fund; }
  if (campaign) { where.push('g.campaign_id = :campaign'); replacements.campaign = campaign; }
  if (appeal) { where.push('g.appeal_id = :appeal'); replacements.appeal = appeal; }
  if (minAmount) { where.push('g.gift_amount >= :minAmount'); replacements.minAmount = Number(minAmount); }
  if (maxAmount) { where.push('g.gift_amount <= :maxAmount'); replacements.maxAmount = Number(maxAmount); }
  if (dateRange) {
    where.push('g.gift_date >= :startDate AND g.gift_date < :endDate');
    replacements.startDate = dateRange.startDate;
    replacements.endDate = dateRange.endDate;
  }

  const allowedSorts = ['gift_date', 'gift_amount', 'last_name', 'fund_description'];
  const col = allowedSorts.includes(sortBy) ? 'g.' + sortBy : 'g.gift_date';
  const dir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  const whereClause = where.join(' AND ');
  const offset = (page - 1) * limit;

  const [[{ count }]] = await sequelize.query(
    `SELECT COUNT(*) as count FROM crm_gifts g WHERE ${whereClause}`,
    { replacements, type: QueryTypes.RAW }
  );

  const rows = await sequelize.query(`
    SELECT g.gift_id, g.gift_date, g.gift_amount, g.gift_code,
           g.first_name, g.last_name, g.constituent_id,
           g.fund_description, g.fund_id,
           g.campaign_description, g.campaign_id,
           g.appeal_description, g.appeal_id
    FROM crm_gifts g
    WHERE ${whereClause}
    ORDER BY ${col} ${dir}
    LIMIT :limit OFFSET :offset
  `, { replacements: { ...replacements, limit, offset }, ...QUERY_OPTS });

  return { rows, total: Number(count), page, limit, totalPages: Math.ceil(Number(count) / limit) };
}

// ---------------------------------------------------------------------------
// Filter options for gift search dropdowns
// ---------------------------------------------------------------------------
async function getFilterOptions(tenantId) {
  const [funds, campaigns, appeals] = await Promise.all([
    sequelize.query(`SELECT DISTINCT fund_id, fund_description FROM crm_gifts WHERE tenant_id = :tenantId AND fund_id IS NOT NULL ORDER BY fund_description`, { replacements: { tenantId }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT DISTINCT campaign_id, campaign_description FROM crm_gifts WHERE tenant_id = :tenantId AND campaign_id IS NOT NULL ORDER BY campaign_description`, { replacements: { tenantId }, type: QueryTypes.SELECT }),
    sequelize.query(`SELECT DISTINCT appeal_id, appeal_description FROM crm_gifts WHERE tenant_id = :tenantId AND appeal_id IS NOT NULL ORDER BY appeal_description`, { replacements: { tenantId }, type: QueryTypes.SELECT }),
  ]);
  return { funds, campaigns, appeals };
}

// ---------------------------------------------------------------------------
// Entity Detail (Fund, Campaign, or Appeal)
// ---------------------------------------------------------------------------
async function getEntityDetail(tenantId, entityType, entityId, dateRange) {
  const colId = entityType + '_id';
  const colDesc = entityType + '_description';
  const repl = { tenantId, entityId, ...dateReplacements(dateRange) };

  // Run all queries in parallel to avoid sequential timeout
  const [summaryRows, topDonors, byMonth, fundraisers] = await Promise.all([
    sequelize.query(`
      SELECT
        ${colDesc} as name,
        COUNT(*) as total_gifts,
        COALESCE(SUM(gift_amount), 0) as total_raised,
        COALESCE(AVG(gift_amount), 0) as avg_gift,
        COUNT(DISTINCT constituent_id) as unique_donors,
        MIN(gift_date) as earliest_date,
        MAX(gift_date) as latest_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND ${colId} = :entityId${dateWhere(dateRange)}
      GROUP BY ${colDesc}
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT first_name, last_name, constituent_id,
             COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND ${colId} = :entityId${dateWhere(dateRange)}
      GROUP BY first_name, last_name, constituent_id
      ORDER BY total DESC LIMIT 20
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT TO_CHAR(gift_date, 'YYYY-MM') as month,
             COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND ${colId} = :entityId AND gift_date IS NOT NULL${dateWhere(dateRange)}
      GROUP BY month ORDER BY month DESC LIMIT 24
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT f.fundraiser_name, COUNT(DISTINCT f.gift_id) as gift_count,
             SUM(f.fundraiser_amount) as total_credited
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND g.${colId} = :entityId AND f.fundraiser_name IS NOT NULL${dateWhere(dateRange, 'g')}
      GROUP BY f.fundraiser_name ORDER BY total_credited DESC LIMIT 15
    `, { replacements: repl, ...QUERY_OPTS }),
  ]);

  return { summary: summaryRows[0] || null, topDonors, byMonth, fundraisers };
}

// ---------------------------------------------------------------------------
// 1. Donor Scoring & Segmentation (RFM-based)
// Scores each donor on Recency, Frequency, Monetary and assigns a segment
// ---------------------------------------------------------------------------
async function getDonorScoring(tenantId, dateRange, { page = 1, limit = 50, segment } = {}) {
  const scoringCTE = `
    WITH donor_stats AS (
      SELECT
        constituent_id, first_name, last_name,
        COUNT(*) as gift_count,
        SUM(gift_amount) as total_given,
        AVG(gift_amount) as avg_gift,
        MAX(gift_date) as last_gift_date,
        MIN(gift_date) as first_gift_date,
        MAX(gift_amount) as largest_gift,
        (CURRENT_DATE - MAX(gift_date)) as days_since_last
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dateWhere(dateRange)}
      GROUP BY constituent_id, first_name, last_name
    ),
    scoring AS (
      SELECT *,
        NTILE(5) OVER (ORDER BY days_since_last ASC) as recency_score,
        NTILE(5) OVER (ORDER BY gift_count ASC) as frequency_score,
        NTILE(5) OVER (ORDER BY total_given ASC) as monetary_score
      FROM donor_stats
    ),
    classified AS (
      SELECT *,
        (recency_score + frequency_score + monetary_score) as rfm_total,
        CASE
          WHEN recency_score >= 4 AND frequency_score >= 4 AND monetary_score >= 4 THEN 'Champion'
          WHEN monetary_score >= 4 AND recency_score >= 3 THEN 'Major Gift Prospect'
          WHEN recency_score >= 4 AND frequency_score >= 3 THEN 'Loyal & Active'
          WHEN monetary_score >= 3 AND recency_score <= 2 THEN 'At Risk - High Value'
          WHEN frequency_score >= 3 AND recency_score <= 2 THEN 'At Risk - Frequent'
          WHEN recency_score >= 4 AND frequency_score <= 2 THEN 'New / Promising'
          WHEN recency_score <= 2 AND frequency_score <= 2 AND monetary_score <= 2 THEN 'Lapsed'
          WHEN frequency_score >= 3 AND monetary_score <= 2 THEN 'Upgrade Candidate'
          ELSE 'Core Donor'
        END as segment
      FROM scoring
    )`;

  const replacements = { tenantId, ...dateReplacements(dateRange) };

  // Lightweight summary query — counts ALL donors by segment
  const summaryRows = await sequelize.query(`
    ${scoringCTE}
    SELECT segment, COUNT(*) as count, SUM(total_given) as total
    FROM classified GROUP BY segment
  `, { replacements, ...QUERY_OPTS });

  const segments = {};
  let totalDonors = 0;
  summaryRows.forEach(r => {
    segments[r.segment] = { count: Number(r.count), total: Number(r.total) };
    totalDonors += Number(r.count);
  });

  // Paginated detail query
  const segmentFilter = segment ? ' WHERE segment = :segment' : '';
  const offset = (page - 1) * limit;

  const rows = await sequelize.query(`
    ${scoringCTE}
    SELECT * FROM classified${segmentFilter}
    ORDER BY rfm_total DESC, total_given DESC
    LIMIT :limit OFFSET :offset
  `, { replacements: { ...replacements, ...(segment ? { segment } : {}), limit, offset }, ...QUERY_OPTS });

  const filteredTotal = segment ? (segments[segment] ? segments[segment].count : 0) : totalDonors;

  return { donors: rows, segments, total: filteredTotal, page, limit, totalPages: Math.ceil(filteredTotal / limit) };
}

// ---------------------------------------------------------------------------
// 2. Fundraiser Goal Tracking
// ---------------------------------------------------------------------------
const { FundraiserGoal, DepartmentGoal } = require('../models');

async function getFundraiserGoals(tenantId, fiscalYear) {
  if (!fiscalYear) return [];
  return FundraiserGoal.findAll({
    where: { tenantId, fiscalYear },
    order: [['fundraiserName', 'ASC']],
    raw: true,
  });
}

async function setFundraiserGoal(tenantId, fundraiserName, fiscalYear, goalAmount) {
  const [goal] = await FundraiserGoal.upsert({
    tenantId, fundraiserName, fiscalYear, goalAmount,
  }, {
    conflictFields: ['tenant_id', 'fundraiser_name', 'fiscal_year'],
  });
  return goal;
}

async function deleteFundraiserGoal(tenantId, fundraiserName, fiscalYear) {
  return FundraiserGoal.destroy({
    where: { tenantId, fundraiserName, fiscalYear },
  });
}

// ---------------------------------------------------------------------------
// 2b. Department Goal Tracking
// ---------------------------------------------------------------------------
async function getDepartmentGoals(tenantId, fiscalYear) {
  if (!fiscalYear) return [];
  return DepartmentGoal.findAll({
    where: { tenantId, fiscalYear },
    order: [['department', 'ASC']],
    raw: true,
  });
}

async function setDepartmentGoal(tenantId, department, fiscalYear, goalAmount) {
  const [goal] = await DepartmentGoal.upsert({
    tenantId, department, fiscalYear, goalAmount,
  }, {
    conflictFields: ['tenant_id', 'department', 'fiscal_year'],
  });
  return goal;
}

async function deleteDepartmentGoal(tenantId, department, fiscalYear) {
  return DepartmentGoal.destroy({
    where: { tenantId, department, fiscalYear },
  });
}

// Get actual giving totals per department for a fiscal year (fast — uses pre-computed column)
async function getDepartmentActuals(tenantId, dateRange) {
  if (!dateRange) return [];
  return sequelize.query(`
    SELECT department, COALESCE(SUM(gift_amount),0) as total,
           COUNT(*) as gift_count, COUNT(DISTINCT constituent_id) as donor_count
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department IS NOT NULL
      AND gift_date >= :startDate AND gift_date < :endDate
    GROUP BY department
  `, { replacements: { tenantId, ...dateRange }, ...QUERY_OPTS });
}

// Data quality summary for the data quality dashboard
async function getDataQualityReport(tenantId) {
  const rows = await sequelize.query(`
    SELECT
      COUNT(*) as total_gifts,
      COUNT(CASE WHEN gift_date IS NULL THEN 1 END) as missing_date,
      COUNT(CASE WHEN gift_amount IS NULL OR gift_amount = 0 THEN 1 END) as missing_amount,
      COUNT(CASE WHEN constituent_id IS NULL OR constituent_id = '' THEN 1 END) as missing_constituent,
      COUNT(CASE WHEN (first_name IS NULL OR first_name = '') AND (last_name IS NULL OR last_name = '') THEN 1 END) as missing_name,
      COUNT(CASE WHEN fund_id IS NULL OR fund_id = '' THEN 1 END) as missing_fund,
      COUNT(CASE WHEN campaign_id IS NULL OR campaign_id = '' THEN 1 END) as missing_campaign,
      COUNT(CASE WHEN appeal_id IS NULL OR appeal_id = '' THEN 1 END) as missing_appeal,
      COUNT(CASE WHEN gift_code IS NULL OR gift_code = '' THEN 1 END) as missing_gift_code,
      COUNT(CASE WHEN appeal_category IS NULL OR appeal_category = '' THEN 1 END) as missing_appeal_category,
      COUNT(CASE WHEN fund_category IS NULL OR fund_category = '' THEN 1 END) as missing_fund_category,
      COUNT(CASE WHEN gift_amount < 0 THEN 1 END) as negative_amounts,
      COUNT(CASE WHEN gift_date > CURRENT_DATE THEN 1 END) as future_dates,
      COUNT(CASE WHEN gift_date < '1990-01-01' THEN 1 END) as very_old_dates,
      COUNT(DISTINCT constituent_id) as unique_constituents
    FROM crm_gifts WHERE tenant_id = :tenantId
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Duplicate detection: same constituent, same amount, same date
  const dupes = await sequelize.query(`
    SELECT COUNT(*) as duplicate_count FROM (
      SELECT constituent_id, gift_amount, gift_date, COUNT(*) as cnt
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL AND gift_date IS NOT NULL
      GROUP BY constituent_id, gift_amount, gift_date
      HAVING COUNT(*) > 1
    ) d
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Potential duplicate constituents (same last_name + first initial)
  const dupeConstituents = await sequelize.query(`
    SELECT COUNT(*) as count FROM (
      SELECT LOWER(last_name) as ln, LEFT(LOWER(first_name),1) as fi, COUNT(DISTINCT constituent_id) as cnt
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND last_name IS NOT NULL AND last_name != '' AND constituent_id IS NOT NULL
      GROUP BY ln, fi
      HAVING COUNT(DISTINCT constituent_id) > 1
    ) d
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Top missing-field records (sample for user review)
  const sampleBadRecords = await sequelize.query(`
    SELECT gift_id, constituent_id, first_name, last_name, gift_amount, gift_date,
           fund_id, campaign_id, appeal_id, gift_code,
           (CASE WHEN gift_date IS NULL THEN 1 ELSE 0 END +
            CASE WHEN gift_amount IS NULL OR gift_amount = 0 THEN 1 ELSE 0 END +
            CASE WHEN constituent_id IS NULL OR constituent_id = '' THEN 1 ELSE 0 END +
            CASE WHEN fund_id IS NULL OR fund_id = '' THEN 1 ELSE 0 END +
            CASE WHEN campaign_id IS NULL OR campaign_id = '' THEN 1 ELSE 0 END +
            CASE WHEN appeal_id IS NULL OR appeal_id = '' THEN 1 ELSE 0 END) as issue_count
    FROM crm_gifts WHERE tenant_id = :tenantId
    ORDER BY (CASE WHEN gift_date IS NULL THEN 1 ELSE 0 END +
              CASE WHEN gift_amount IS NULL OR gift_amount = 0 THEN 1 ELSE 0 END +
              CASE WHEN constituent_id IS NULL OR constituent_id = '' THEN 1 ELSE 0 END +
              CASE WHEN fund_id IS NULL OR fund_id = '' THEN 1 ELSE 0 END +
              CASE WHEN campaign_id IS NULL OR campaign_id = '' THEN 1 ELSE 0 END +
              CASE WHEN appeal_id IS NULL OR appeal_id = '' THEN 1 ELSE 0 END) DESC
    LIMIT 20
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  return {
    ...(rows[0] || {}),
    duplicate_gifts: Number((dupes[0] || {}).duplicate_count) || 0,
    duplicate_constituents: Number((dupeConstituents[0] || {}).count) || 0,
    sampleBadRecords,
  };
}

// ---------------------------------------------------------------------------
// 3. Recurring Donor Analysis
// ---------------------------------------------------------------------------
async function getRecurringDonorAnalysis(tenantId, dateRange, { page = 1, limit = 50, pattern } = {}) {
  const donorGivingCTE = `
    WITH donor_giving AS (
      SELECT
        constituent_id, first_name, last_name,
        COUNT(*) as gift_count,
        SUM(gift_amount) as total_given,
        MIN(gift_date) as first_gift,
        MAX(gift_date) as last_gift,
        (MAX(gift_date) - MIN(gift_date)) as giving_span_days,
        COUNT(DISTINCT TO_CHAR(gift_date, 'YYYY-MM')) as active_months,
        COUNT(DISTINCT CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
          THEN EXTRACT(YEAR FROM gift_date) + 1
          ELSE EXTRACT(YEAR FROM gift_date) END) as active_fys
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date IS NOT NULL${dateWhere(dateRange)}
      GROUP BY constituent_id, first_name, last_name
      HAVING COUNT(*) >= 2
    ), classified AS (
      SELECT *,
        CASE
          WHEN active_months >= 6 AND giving_span_days > 150 AND gift_count >= 6 THEN 'Monthly'
          WHEN active_fys >= 3 AND gift_count >= 3 THEN 'Annual Faithful'
          WHEN active_fys >= 2 AND gift_count >= 2 THEN 'Multi-Year'
          WHEN gift_count >= 3 AND giving_span_days <= 365 THEN 'Frequent (Single Year)'
          ELSE 'Occasional'
        END as pattern,
        CASE
          WHEN giving_span_days > 0 THEN ROUND(giving_span_days::numeric / gift_count, 0)
          ELSE 0
        END as avg_days_between
      FROM donor_giving
    )`;

  const replacements = { tenantId, ...dateReplacements(dateRange) };

  // Lightweight summary query — counts ALL recurring donors by pattern
  const summaryRows = await sequelize.query(`
    ${donorGivingCTE}
    SELECT pattern, COUNT(*) as count, SUM(total_given) as total
    FROM classified GROUP BY pattern
  `, { replacements, ...QUERY_OPTS });

  const patterns = {};
  let totalDonors = 0;
  summaryRows.forEach(r => {
    patterns[r.pattern] = { count: Number(r.count), total: Number(r.total) };
    totalDonors += Number(r.count);
  });

  // Paginated detail query — filtered by pattern if specified
  const patternFilter = pattern ? ' WHERE pattern = :pattern' : '';
  const offset = (page - 1) * limit;

  const rows = await sequelize.query(`
    ${donorGivingCTE}
    SELECT * FROM classified${patternFilter}
    ORDER BY total_given DESC
    LIMIT :limit OFFSET :offset
  `, { replacements: { ...replacements, ...(pattern ? { pattern } : {}), limit, offset }, ...QUERY_OPTS });

  const filteredTotal = pattern ? (patterns[pattern] ? patterns[pattern].count : 0) : totalDonors;

  return { donors: rows, patterns, total: filteredTotal, page, limit, totalPages: Math.ceil(filteredTotal / limit) };
}

// ---------------------------------------------------------------------------
// 4. Acknowledgment Tracker
// ---------------------------------------------------------------------------
async function getAcknowledgmentTracker(tenantId, dateRange, { page = 1, limit = 50 } = {}) {
  // Summary stats
  const [summary] = await sequelize.query(`
    SELECT
      COUNT(*) as total_gifts,
      SUM(CASE WHEN gift_acknowledge IS NOT NULL AND gift_acknowledge != '' AND LOWER(gift_acknowledge) != 'not acknowledged' THEN 1 ELSE 0 END) as acknowledged,
      SUM(CASE WHEN gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged' THEN 1 ELSE 0 END) as unacknowledged,
      SUM(CASE WHEN (gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged') THEN gift_amount ELSE 0 END) as unack_total,
      SUM(gift_amount) as total_amount
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Count of unacknowledged gifts for pagination
  const [unackCount] = await sequelize.query(`
    SELECT COUNT(*) as count FROM crm_gifts
    WHERE tenant_id = :tenantId
      AND (gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged')${dateWhere(dateRange)}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  const unackTotal = Number(unackCount.count) || 0;
  const totalPages = Math.ceil(unackTotal / limit) || 1;
  const offset = (page - 1) * limit;

  // Unacknowledged gifts (most recent first)
  const unacknowledged = await sequelize.query(`
    SELECT gift_id, gift_date, gift_amount, gift_code,
           first_name, last_name, constituent_id,
           fund_description, gift_acknowledge, gift_acknowledge_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId
      AND (gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged')${dateWhere(dateRange)}
    ORDER BY gift_amount DESC, gift_date DESC
    LIMIT :limit OFFSET :offset
  `, { replacements: { tenantId, ...dateReplacements(dateRange), limit, offset }, ...QUERY_OPTS });

  // By acknowledgment status breakdown
  const byStatus = await sequelize.query(`
    SELECT
      COALESCE(NULLIF(gift_acknowledge, ''), 'Not Acknowledged') as status,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    GROUP BY status
    ORDER BY total DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // By fund acknowledgment rate
  const byFund = await sequelize.query(`
    SELECT
      COALESCE(fund_description, 'Unassigned') as fund,
      COUNT(*) as total_gifts,
      SUM(CASE WHEN gift_acknowledge IS NOT NULL AND gift_acknowledge != '' AND LOWER(gift_acknowledge) != 'not acknowledged' THEN 1 ELSE 0 END) as acknowledged,
      SUM(CASE WHEN gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged' THEN 1 ELSE 0 END) as unacknowledged,
      SUM(gift_amount) as total_amount
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    GROUP BY fund
    ORDER BY unacknowledged DESC
    LIMIT 25
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Average days to acknowledge
  const [avgDays] = await sequelize.query(`
    SELECT
      AVG(gift_acknowledge_date - gift_date) as avg_days,
      MIN(gift_acknowledge_date - gift_date) as min_days,
      MAX(gift_acknowledge_date - gift_date) as max_days
    FROM crm_gifts
    WHERE tenant_id = :tenantId
      AND gift_acknowledge_date IS NOT NULL AND gift_date IS NOT NULL
      AND gift_acknowledge IS NOT NULL AND gift_acknowledge != '' AND LOWER(gift_acknowledge) != 'not acknowledged'${dateWhere(dateRange)}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return { summary, unacknowledged, byStatus, byFund, avgDays: avgDays || { avg_days: null, min_days: null, max_days: null }, total: unackTotal, page, limit, totalPages };
}

// ---------------------------------------------------------------------------
// 5. Matching Gift Analysis
// ---------------------------------------------------------------------------
async function getMatchingGiftAnalysis(tenantId, dateRange) {
  const [summary] = await sequelize.query(`
    SELECT
      COUNT(DISTINCT m.match_gift_id) as total_matches,
      COALESCE(SUM(m.match_receipt_amount), 0) as total_match_amount,
      COUNT(DISTINCT g.constituent_id) as unique_donors,
      (SELECT COUNT(*) FROM crm_gifts WHERE tenant_id = :tenantId${dateWhere(dateRange)}) as total_gifts
    FROM crm_gift_matches m
    JOIN crm_gifts g ON m.gift_id = g.gift_id AND m.tenant_id = g.tenant_id
    WHERE m.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Top donors by match amount
  const topDonors = await sequelize.query(`
    SELECT
      g.first_name, g.last_name, g.constituent_id,
      COUNT(DISTINCT m.match_gift_id) as match_count,
      COALESCE(SUM(m.match_receipt_amount), 0) as total_match_amount,
      COALESCE(SUM(g.gift_amount), 0) as total_gift_amount
    FROM crm_gift_matches m
    JOIN crm_gifts g ON m.gift_id = g.gift_id AND m.tenant_id = g.tenant_id
    WHERE m.tenant_id = :tenantId AND g.constituent_id IS NOT NULL${dateWhere(dateRange, 'g')}
    GROUP BY g.first_name, g.last_name, g.constituent_id
    ORDER BY total_match_amount DESC
    LIMIT 25
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // By fund
  const byFund = await sequelize.query(`
    SELECT
      COALESCE(g.fund_description, 'Unassigned') as fund,
      COUNT(DISTINCT m.match_gift_id) as match_count,
      COALESCE(SUM(m.match_receipt_amount), 0) as total_match_amount
    FROM crm_gift_matches m
    JOIN crm_gifts g ON m.gift_id = g.gift_id AND m.tenant_id = g.tenant_id
    WHERE m.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
    GROUP BY fund
    ORDER BY total_match_amount DESC
    LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // By campaign
  const byCampaign = await sequelize.query(`
    SELECT
      COALESCE(g.campaign_description, 'Unassigned') as campaign,
      COUNT(DISTINCT m.match_gift_id) as match_count,
      COALESCE(SUM(m.match_receipt_amount), 0) as total_match_amount
    FROM crm_gift_matches m
    JOIN crm_gifts g ON m.gift_id = g.gift_id AND m.tenant_id = g.tenant_id
    WHERE m.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
    GROUP BY campaign
    ORDER BY total_match_amount DESC
    LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return { summary, topDonors, byFund, byCampaign };
}

// ---------------------------------------------------------------------------
// 6. Soft Credit Analytics
// ---------------------------------------------------------------------------
async function getSoftCreditAnalysis(tenantId, dateRange) {
  const [summary] = await sequelize.query(`
    SELECT
      COUNT(*) as total_soft_credits,
      COALESCE(SUM(s.soft_credit_amount), 0) as total_amount,
      COUNT(DISTINCT s.recipient_id) as unique_recipients,
      COUNT(DISTINCT g.gift_id) as unique_gifts
    FROM crm_gift_soft_credits s
    JOIN crm_gifts g ON s.gift_id = g.gift_id AND s.tenant_id = g.tenant_id
    WHERE s.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Top recipients
  const topRecipients = await sequelize.query(`
    SELECT
      s.recipient_first_name, s.recipient_last_name, s.recipient_id, s.recipient_name,
      COUNT(*) as credit_count,
      COALESCE(SUM(s.soft_credit_amount), 0) as total_amount
    FROM crm_gift_soft_credits s
    JOIN crm_gifts g ON s.gift_id = g.gift_id AND s.tenant_id = g.tenant_id
    WHERE s.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
    GROUP BY s.recipient_first_name, s.recipient_last_name, s.recipient_id, s.recipient_name
    ORDER BY total_amount DESC
    LIMIT 25
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // By fund
  const byFund = await sequelize.query(`
    SELECT
      COALESCE(g.fund_description, 'Unassigned') as fund,
      COUNT(*) as credit_count,
      COALESCE(SUM(s.soft_credit_amount), 0) as total_amount
    FROM crm_gift_soft_credits s
    JOIN crm_gifts g ON s.gift_id = g.gift_id AND s.tenant_id = g.tenant_id
    WHERE s.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
    GROUP BY fund
    ORDER BY total_amount DESC
    LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return { summary, topRecipients, byFund };
}

// ---------------------------------------------------------------------------
// 7. Payment Method Analysis
// ---------------------------------------------------------------------------
async function getPaymentMethodAnalysis(tenantId, dateRange) {
  const [summary] = await sequelize.query(`
    SELECT
      COUNT(*) as total_gifts,
      COALESCE(SUM(gift_amount), 0) as total_amount,
      COUNT(DISTINCT gift_payment_type) as unique_methods
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // By payment method
  const byMethod = await sequelize.query(`
    SELECT
      COALESCE(NULLIF(gift_payment_type, ''), 'Unknown') as payment_method,
      COUNT(*) as gift_count,
      COALESCE(SUM(gift_amount), 0) as total_amount,
      COALESCE(AVG(gift_amount), 0) as avg_amount,
      COUNT(DISTINCT constituent_id) as unique_donors
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    GROUP BY payment_method
    ORDER BY total_amount DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return { summary, byMethod };
}

// ---------------------------------------------------------------------------
// 8. Donor Lifecycle Analysis
// ---------------------------------------------------------------------------
async function getDonorLifecycleAnalysis(tenantId, dateRange) {
  // We need the current period and a prior comparison period
  // If dateRange is provided, use it; otherwise use last 12 months
  let curStart, curEnd, priorStart, priorEnd, lapseThreshold;
  if (dateRange) {
    curStart = dateRange.startDate;
    curEnd = dateRange.endDate;
    // prior period = same length, immediately before
    const startD = new Date(curStart);
    const endD = new Date(curEnd);
    const diffMs = endD - startD;
    const priorStartD = new Date(startD - diffMs);
    priorStart = priorStartD.toISOString().split('T')[0];
    priorEnd = curStart;
  } else {
    curEnd = new Date().toISOString().split('T')[0];
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    curStart = oneYearAgo.toISOString().split('T')[0];
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    priorStart = twoYearsAgo.toISOString().split('T')[0];
    priorEnd = curStart;
  }

  // 18 months before current period end for lapse threshold
  const lapseDate = new Date(curEnd);
  lapseDate.setMonth(lapseDate.getMonth() - 18);
  lapseThreshold = lapseDate.toISOString().split('T')[0];

  const rows = await sequelize.query(`
    WITH current_donors AS (
      SELECT constituent_id,
             SUM(gift_amount) as current_total,
             COUNT(*) as current_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :curStart AND gift_date < :curEnd
      GROUP BY constituent_id
    ),
    prior_donors AS (
      SELECT constituent_id,
             SUM(gift_amount) as prior_total,
             COUNT(*) as prior_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :priorStart AND gift_date < :priorEnd
      GROUP BY constituent_id
    ),
    all_donors AS (
      SELECT constituent_id, MAX(gift_date) as last_gift_date, MIN(gift_date) as first_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      GROUP BY constituent_id
    ),
    classified AS (
      SELECT
        a.constituent_id,
        a.last_gift_date,
        a.first_gift_date,
        c.current_total,
        c.current_count,
        p.prior_total,
        p.prior_count,
        CASE
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NULL AND a.first_gift_date >= :curStart THEN 'New'
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NULL AND a.first_gift_date < :curStart THEN 'Recovered'
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NOT NULL AND c.current_total > p.prior_total THEN 'Growing'
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NOT NULL AND c.current_total <= p.prior_total THEN 'Declining'
          WHEN c.constituent_id IS NULL AND a.last_gift_date < :lapseThreshold THEN 'Lapsed'
          WHEN c.constituent_id IS NULL AND a.last_gift_date >= :lapseThreshold THEN 'At Risk'
          ELSE 'Other'
        END as lifecycle_stage
      FROM all_donors a
      LEFT JOIN current_donors c ON a.constituent_id = c.constituent_id
      LEFT JOIN prior_donors p ON a.constituent_id = p.constituent_id
    )
    SELECT lifecycle_stage,
           COUNT(*) as donor_count,
           COALESCE(SUM(current_total), 0) as total_giving
    FROM classified
    GROUP BY lifecycle_stage
    ORDER BY donor_count DESC
  `, {
    replacements: { tenantId, curStart, curEnd, priorStart, priorEnd, lapseThreshold },
    ...QUERY_OPTS,
  });

  // Get at-risk donors (declining + at risk) with details
  const atRiskDonors = await sequelize.query(`
    WITH current_donors AS (
      SELECT constituent_id,
             SUM(gift_amount) as current_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :curStart AND gift_date < :curEnd
      GROUP BY constituent_id
    ),
    prior_donors AS (
      SELECT constituent_id,
             SUM(gift_amount) as prior_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :priorStart AND gift_date < :priorEnd
      GROUP BY constituent_id
    ),
    all_donors AS (
      SELECT constituent_id, MAX(gift_date) as last_gift_date,
             MAX(first_name) as first_name, MAX(last_name) as last_name,
             SUM(gift_amount) as lifetime_total, COUNT(*) as lifetime_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      GROUP BY constituent_id
    )
    SELECT
      a.constituent_id, a.first_name, a.last_name, a.last_gift_date,
      a.lifetime_total, a.lifetime_count,
      COALESCE(c.current_total, 0) as current_total,
      COALESCE(p.prior_total, 0) as prior_total,
      CASE
        WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NOT NULL AND c.current_total <= p.prior_total THEN 'Declining'
        WHEN c.constituent_id IS NULL AND a.last_gift_date >= :lapseThreshold THEN 'At Risk'
        ELSE 'Other'
      END as risk_type
    FROM all_donors a
    LEFT JOIN current_donors c ON a.constituent_id = c.constituent_id
    LEFT JOIN prior_donors p ON a.constituent_id = p.constituent_id
    WHERE (c.constituent_id IS NOT NULL AND p.constituent_id IS NOT NULL AND c.current_total <= p.prior_total)
       OR (c.constituent_id IS NULL AND a.last_gift_date >= :lapseThreshold)
    ORDER BY a.lifetime_total DESC
    LIMIT 50
  `, {
    replacements: { tenantId, curStart, curEnd, priorStart, priorEnd, lapseThreshold },
    ...QUERY_OPTS,
  });

  return { stages: rows, atRiskDonors, periods: { curStart, curEnd, priorStart, priorEnd } };
}

// ---------------------------------------------------------------------------
// Feature 6: Gift Size Trend Analysis
// ---------------------------------------------------------------------------
async function getGiftTrendAnalysis(tenantId, dateRange, { page = 1, limit = 50 } = {}) {
  // Average and median gift size by month
  const monthlyTrend = await sequelize.query(`
    SELECT TO_CHAR(gift_date, 'YYYY-MM') as month,
           COUNT(*) as gift_count,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gift_amount), 0) as median_gift,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL${dateWhere(dateRange)}
    GROUP BY month ORDER BY month
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Gift size distribution (histogram buckets)
  const distribution = await sequelize.query(`
    SELECT
      CASE
        WHEN gift_amount < 50 THEN '$1-50'
        WHEN gift_amount < 100 THEN '$50-100'
        WHEN gift_amount < 250 THEN '$100-250'
        WHEN gift_amount < 500 THEN '$250-500'
        WHEN gift_amount < 1000 THEN '$500-1K'
        WHEN gift_amount < 5000 THEN '$1K-5K'
        WHEN gift_amount < 10000 THEN '$5K-10K'
        ELSE '$10K+'
      END as bucket,
      CASE
        WHEN gift_amount < 50 THEN 1
        WHEN gift_amount < 100 THEN 2
        WHEN gift_amount < 250 THEN 3
        WHEN gift_amount < 500 THEN 4
        WHEN gift_amount < 1000 THEN 5
        WHEN gift_amount < 5000 THEN 6
        WHEN gift_amount < 10000 THEN 7
        ELSE 8
      END as sort_order,
      COUNT(*) as gift_count,
      COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_amount IS NOT NULL${dateWhere(dateRange)}
    GROUP BY bucket, sort_order ORDER BY sort_order
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Year-over-year avg gift size comparison
  const yoyAvg = await sequelize.query(`
    SELECT CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                THEN EXTRACT(YEAR FROM gift_date) + 1
                ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           COUNT(*) as gift_count,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
    GROUP BY fy ORDER BY fy
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Donors whose avg gift is increasing vs decreasing (compare last 2 FYs)
  const donorTrendsCTE = `
    WITH donor_fy AS (
      SELECT constituent_id, first_name, last_name,
             CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                  THEN EXTRACT(YEAR FROM gift_date) + 1
                  ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
             AVG(gift_amount) as avg_gift,
             COUNT(*) as gift_count,
             SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL AND gift_date IS NOT NULL
      GROUP BY constituent_id, first_name, last_name, fy
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY fy DESC) as rn
      FROM donor_fy
    ),
    trends AS (
      SELECT
        a.constituent_id, a.first_name, a.last_name,
        a.avg_gift as current_avg, a.fy as current_fy,
        b.avg_gift as prior_avg, b.fy as prior_fy,
        CASE WHEN a.avg_gift > b.avg_gift THEN 'Increasing'
             WHEN a.avg_gift < b.avg_gift THEN 'Decreasing'
             ELSE 'Stable' END as trend,
        ROUND(((a.avg_gift - b.avg_gift) / NULLIF(b.avg_gift, 0) * 100)::numeric, 1) as pct_change
      FROM ranked a
      JOIN ranked b ON a.constituent_id = b.constituent_id AND a.rn = 1 AND b.rn = 2
    )`;

  const offset = (page - 1) * limit;

  const [donorTrends, [summaryRow]] = await Promise.all([
    sequelize.query(`${donorTrendsCTE}
    SELECT * FROM trends
    ORDER BY ABS(current_avg - prior_avg) DESC
    LIMIT :limit OFFSET :offset
  `, { replacements: { tenantId, limit, offset }, ...QUERY_OPTS }),
    sequelize.query(`${donorTrendsCTE}
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE trend = 'Increasing') as increasing,
      COUNT(*) FILTER (WHERE trend = 'Decreasing') as decreasing
    FROM trends
  `, { replacements: { tenantId }, ...QUERY_OPTS }),
  ]);

  const donorTrendsTotal = Number(summaryRow.total);
  const donorTrendsTotalPages = Math.ceil(donorTrendsTotal / limit) || 1;

  return {
    monthlyTrend, distribution, yoyAvg, donorTrends,
    increasing: Number(summaryRow.increasing),
    decreasing: Number(summaryRow.decreasing),
    donorTrendsTotal,
    donorTrendsPage: page,
    donorTrendsLimit: limit,
    donorTrendsTotalPages,
  };
}

// ---------------------------------------------------------------------------
// Feature 7: Campaign Performance Comparison
// ---------------------------------------------------------------------------
async function getCampaignComparison(tenantId, dateRange) {
  // Side-by-side campaign metrics
  const campaigns = await sequelize.query(`
    SELECT campaign_description, campaign_id,
           COALESCE(SUM(gift_amount), 0) as total_raised,
           COUNT(DISTINCT constituent_id) as donor_count,
           COUNT(*) as gift_count,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           MIN(gift_date) as first_gift_date,
           MAX(gift_date) as last_gift_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY campaign_description, campaign_id
    ORDER BY total_raised DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Campaign timeline (monthly breakdown per campaign, top 10 campaigns)
  const topCampaignIds = campaigns.slice(0, 10).map(c => c.campaign_id).filter(Boolean);
  let timeline = [];
  if (topCampaignIds.length > 0) {
    timeline = await sequelize.query(`
      SELECT campaign_description, campaign_id,
             TO_CHAR(gift_date, 'YYYY-MM') as month,
             COUNT(*) as gift_count,
             COALESCE(SUM(gift_amount), 0) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND campaign_id IN (:campaignIds)
        AND gift_date IS NOT NULL${dateWhere(dateRange)}
      GROUP BY campaign_description, campaign_id, month
      ORDER BY campaign_description, month
    `, { replacements: { tenantId, campaignIds: topCampaignIds, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  }

  // Donor overlap between campaigns (top 10 pairs)
  const overlap = await sequelize.query(`
    WITH campaign_donors AS (
      SELECT DISTINCT campaign_description, constituent_id
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL
        AND constituent_id IS NOT NULL${dateWhere(dateRange)}
    )
    SELECT a.campaign_description as campaign_a,
           b.campaign_description as campaign_b,
           COUNT(DISTINCT a.constituent_id) as shared_donors
    FROM campaign_donors a
    JOIN campaign_donors b ON a.constituent_id = b.constituent_id
      AND a.campaign_description < b.campaign_description
    GROUP BY a.campaign_description, b.campaign_description
    ORDER BY shared_donors DESC
    LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Effectiveness score: donors * avg_gift * (repeat donor ratio)
  const withScore = campaigns.map(c => {
    const repeatRatio = c.gift_count > 0 ? Math.min(Number(c.gift_count) / Math.max(Number(c.donor_count), 1), 5) : 1;
    const score = Math.round(Number(c.donor_count) * Number(c.avg_gift) * repeatRatio);
    return { ...c, effectiveness_score: score };
  });

  return { campaigns: withScore, timeline, overlap };
}

// ---------------------------------------------------------------------------
// Feature 8: Fund Diversification / Health Report
// ---------------------------------------------------------------------------
async function getFundHealthReport(tenantId, dateRange) {
  // Per-fund health metrics
  const funds = await sequelize.query(`
    SELECT fund_description, fund_id,
           COALESCE(SUM(gift_amount), 0) as total,
           COUNT(DISTINCT constituent_id) as donor_count,
           COUNT(*) as gift_count,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           MIN(gift_date) as first_gift_date,
           MAX(gift_date) as last_gift_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND fund_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY fund_description, fund_id
    ORDER BY total DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Grand total for dependency calculations
  const grandTotal = funds.reduce((s, f) => s + Number(f.total), 0);

  // Add dependency pct and cumulative pct
  let cumPct = 0;
  const fundsWithPct = funds.map(f => {
    const pct = grandTotal > 0 ? (Number(f.total) / grandTotal * 100) : 0;
    cumPct += pct;
    return { ...f, pct_of_total: Math.round(pct * 10) / 10, cumulative_pct: Math.round(cumPct * 10) / 10 };
  });

  // Top fund dependency risk
  const topFundPct = fundsWithPct.length > 0 ? fundsWithPct[0].pct_of_total : 0;
  const top3FundPct = fundsWithPct.slice(0, 3).reduce((s, f) => s + f.pct_of_total, 0);

  // Donor concentration: top 10 donors as % of each fund (top 10 funds)
  const topFundIds = funds.slice(0, 10).map(f => f.fund_id).filter(Boolean);
  let donorConcentration = [];
  if (topFundIds.length > 0) {
    donorConcentration = await sequelize.query(`
      WITH fund_donor_totals AS (
        SELECT fund_description, fund_id, constituent_id, first_name, last_name,
               SUM(gift_amount) as donor_total
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND fund_id IN (:fundIds)
          AND constituent_id IS NOT NULL${dateWhere(dateRange)}
        GROUP BY fund_description, fund_id, constituent_id, first_name, last_name
      ),
      fund_totals AS (
        SELECT fund_id, SUM(donor_total) as fund_total FROM fund_donor_totals GROUP BY fund_id
      ),
      ranked AS (
        SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.fund_id ORDER BY d.donor_total DESC) as rn,
               f.fund_total
        FROM fund_donor_totals d JOIN fund_totals f ON d.fund_id = f.fund_id
      )
      SELECT fund_description, fund_id, fund_total,
             SUM(donor_total) as top10_total,
             ROUND((SUM(donor_total) / NULLIF(fund_total, 0) * 100)::numeric, 1) as top10_pct
      FROM ranked WHERE rn <= 10
      GROUP BY fund_description, fund_id, fund_total
      ORDER BY top10_pct DESC
    `, { replacements: { tenantId, fundIds: topFundIds, ...dateReplacements(dateRange) }, ...QUERY_OPTS });
  }

  // Funds trending up vs down (compare current vs prior period giving)
  const fundGrowth = await sequelize.query(`
    WITH fund_fy AS (
      SELECT fund_description, fund_id,
             CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                  THEN EXTRACT(YEAR FROM gift_date) + 1
                  ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
             SUM(gift_amount) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND fund_description IS NOT NULL AND gift_date IS NOT NULL
      GROUP BY fund_description, fund_id, fy
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY fund_id ORDER BY fy DESC) as rn
      FROM fund_fy
    )
    SELECT a.fund_description, a.fund_id,
           a.total as current_total, a.fy as current_fy,
           b.total as prior_total, b.fy as prior_fy,
           ROUND(((a.total - b.total) / NULLIF(b.total, 0) * 100)::numeric, 1) as growth_pct
    FROM ranked a
    JOIN ranked b ON a.fund_id = b.fund_id AND a.rn = 1 AND b.rn = 2
    ORDER BY growth_pct DESC
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const trendingUp = fundGrowth.filter(f => Number(f.growth_pct) > 0);
  const trendingDown = fundGrowth.filter(f => Number(f.growth_pct) < 0);

  return {
    funds: fundsWithPct, grandTotal,
    dependency: { topFundPct, top3FundPct },
    donorConcentration, fundGrowth, trendingUp, trendingDown,
  };
}

// ---------------------------------------------------------------------------
// Feature 9: Year-over-Year Comparison Dashboard
// ---------------------------------------------------------------------------
async function getYearOverYearComparison(tenantId) {
  // All fiscal years side by side
  const yearMetrics = await sequelize.query(`
    SELECT CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                THEN EXTRACT(YEAR FROM gift_date) + 1
                ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
           COALESCE(SUM(gift_amount), 0) as total_raised,
           COUNT(DISTINCT constituent_id) as donor_count,
           COUNT(*) as gift_count,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           COALESCE(MAX(gift_amount), 0) as largest_gift,
           MIN(gift_date) as first_gift,
           MAX(gift_date) as last_gift
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
    GROUP BY fy ORDER BY fy
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Add growth rates between consecutive years
  const years = yearMetrics.map((y, i) => {
    const prev = i > 0 ? yearMetrics[i - 1] : null;
    const totalGrowth = prev && Number(prev.total_raised) > 0
      ? Math.round((Number(y.total_raised) - Number(prev.total_raised)) / Number(prev.total_raised) * 1000) / 10 : null;
    const donorGrowth = prev && Number(prev.donor_count) > 0
      ? Math.round((Number(y.donor_count) - Number(prev.donor_count)) / Number(prev.donor_count) * 1000) / 10 : null;
    const avgGrowth = prev && Number(prev.avg_gift) > 0
      ? Math.round((Number(y.avg_gift) - Number(prev.avg_gift)) / Number(prev.avg_gift) * 1000) / 10 : null;
    return { ...y, total_growth: totalGrowth, donor_growth: donorGrowth, avg_growth: avgGrowth };
  });

  // Best/worst performing year
  let bestYear = null, worstYear = null;
  if (years.length > 0) {
    bestYear = years.reduce((a, b) => Number(a.total_raised) > Number(b.total_raised) ? a : b);
    worstYear = years.reduce((a, b) => Number(a.total_raised) < Number(b.total_raised) ? a : b);
  }

  // Monthly giving by FY for cumulative chart
  const monthlyByFy = await sequelize.query(`
    SELECT CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                THEN EXTRACT(YEAR FROM gift_date) + 1
                ELSE EXTRACT(YEAR FROM gift_date) END AS fy,
           CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                THEN EXTRACT(MONTH FROM gift_date) - 3
                ELSE EXTRACT(MONTH FROM gift_date) + 9 END AS fy_month,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
    GROUP BY fy, fy_month ORDER BY fy, fy_month
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  // Cumulative totals
  const cumulative = {};
  monthlyByFy.forEach(r => {
    const fy = Number(r.fy);
    if (!cumulative[fy]) cumulative[fy] = [];
    const prev = cumulative[fy].length > 0 ? cumulative[fy][cumulative[fy].length - 1].cumulative : 0;
    cumulative[fy].push({ fy_month: Number(r.fy_month), total: Number(r.total), cumulative: prev + Number(r.total) });
  });

  return { years, bestYear, worstYear, cumulative };
}

// ---------------------------------------------------------------------------
// Feature 10: Donor Communication Insights
// ---------------------------------------------------------------------------
async function getDonorInsights(tenantId, dateRange) {
  // 1. Donors to Thank: recent large gifts (top 25% by amount in period)
  const donorsToThank = await sequelize.query(`
    WITH period_stats AS (
      SELECT PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY gift_amount) as p75
      FROM crm_gifts WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    )
    SELECT g.constituent_id, g.first_name, g.last_name,
           g.gift_amount, g.gift_date, g.fund_description, g.campaign_description,
           'Send Thank You' as suggested_action
    FROM crm_gifts g, period_stats p
    WHERE g.tenant_id = :tenantId AND g.gift_amount >= p.p75
      AND g.constituent_id IS NOT NULL${dateWhere(dateRange, 'g')}
    ORDER BY g.gift_amount DESC, g.gift_date DESC
    LIMIT 50
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // 2. Donors to Reconnect: gave before but not in current period
  const reconnectDonors = await sequelize.query(`
    WITH all_donors AS (
      SELECT constituent_id, first_name, last_name,
             SUM(gift_amount) as lifetime_total,
             COUNT(*) as lifetime_gifts,
             MAX(gift_date) as last_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      GROUP BY constituent_id, first_name, last_name
    ),
    recent_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= NOW() - INTERVAL '12 months'
    )
    SELECT a.constituent_id, a.first_name, a.last_name,
           a.lifetime_total, a.lifetime_gifts, a.last_gift_date,
           'Reconnect' as suggested_action,
           EXTRACT(DAY FROM NOW() - a.last_gift_date)::int as days_since_last
    FROM all_donors a
    LEFT JOIN recent_donors r ON a.constituent_id = r.constituent_id
    WHERE r.constituent_id IS NULL AND a.lifetime_gifts >= 2
    ORDER BY a.lifetime_total DESC
    LIMIT 50
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // 3. Upgrade Candidates: consistent donors whose avg is below their segment avg
  const upgradeCandidates = await sequelize.query(`
    WITH donor_stats AS (
      SELECT constituent_id, first_name, last_name,
             AVG(gift_amount) as donor_avg,
             COUNT(*) as gift_count,
             SUM(gift_amount) as total_given,
             MAX(gift_date) as last_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dateWhere(dateRange)}
      GROUP BY constituent_id, first_name, last_name
      HAVING COUNT(*) >= 2
    ),
    overall AS (
      SELECT AVG(donor_avg) as segment_avg FROM donor_stats
    )
    SELECT d.constituent_id, d.first_name, d.last_name,
           d.donor_avg, d.gift_count, d.total_given, d.last_gift_date,
           o.segment_avg,
           ROUND((o.segment_avg - d.donor_avg)::numeric, 2) as upgrade_potential,
           'Upgrade Ask' as suggested_action
    FROM donor_stats d, overall o
    WHERE d.donor_avg < o.segment_avg AND d.gift_count >= 3
    ORDER BY d.total_given DESC
    LIMIT 50
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // 4. New Donor Welcome: first-time donors in period
  const newDonors = await sequelize.query(`
    WITH first_gifts AS (
      SELECT constituent_id, MIN(gift_date) as first_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL AND gift_date IS NOT NULL
      GROUP BY constituent_id
    )
    SELECT g.constituent_id, g.first_name, g.last_name,
           g.gift_amount, g.gift_date, g.fund_description, g.campaign_description,
           'Welcome & Onboard' as suggested_action
    FROM crm_gifts g
    JOIN first_gifts f ON g.constituent_id = f.constituent_id AND g.gift_date = f.first_gift_date
    WHERE g.tenant_id = :tenantId${dateWhere(dateRange, 'g')}
    ORDER BY g.gift_date DESC
    LIMIT 50
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return {
    donorsToThank, reconnectDonors, upgradeCandidates, newDonors,
    summary: {
      thankCount: donorsToThank.length,
      reconnectCount: reconnectDonors.length,
      upgradeCount: upgradeCandidates.length,
      newCount: newDonors.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Appeal Comparison (all appeals + head-to-head)
// ---------------------------------------------------------------------------
async function getAppealComparison(tenantId, dateRange) {
  // All appeals with metrics
  const appeals = await sequelize.query(`
    SELECT appeal_description, appeal_id,
           COALESCE(SUM(gift_amount), 0) as total_raised,
           COUNT(DISTINCT constituent_id) as donor_count,
           COUNT(*) as gift_count,
           COALESCE(AVG(gift_amount), 0) as avg_gift,
           MIN(gift_date) as first_gift_date,
           MAX(gift_date) as last_gift_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY appeal_description, appeal_id
    ORDER BY total_raised DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Effectiveness score: donors * avg_gift * repeat ratio
  const withScore = appeals.map(a => {
    const repeatRatio = a.gift_count > 0 ? Math.min(Number(a.gift_count) / Math.max(Number(a.donor_count), 1), 5) : 1;
    const score = Math.round(Number(a.donor_count) * Number(a.avg_gift) * repeatRatio);
    return { ...a, effectiveness_score: score };
  });

  return { appeals: withScore };
}

async function getAppealDetail(tenantId, appealId, dateRange) {
  // Giving by month for this appeal
  const byMonth = await sequelize.query(`
    SELECT TO_CHAR(gift_date, 'YYYY-MM') as month,
           COUNT(*) as gift_count,
           COALESCE(SUM(gift_amount), 0) as total,
           COUNT(DISTINCT constituent_id) as donors
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_id = :appealId AND gift_date IS NOT NULL${dateWhere(dateRange)}
    GROUP BY month ORDER BY month
  `, { replacements: { tenantId, appealId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Top donors for this appeal
  const topDonors = await sequelize.query(`
    SELECT constituent_id, first_name, last_name,
           COUNT(*) as gift_count,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_id = :appealId${dateWhere(dateRange)}
    GROUP BY constituent_id, first_name, last_name
    ORDER BY total DESC LIMIT 15
  `, { replacements: { tenantId, appealId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Gift type breakdown for this appeal
  const byType = await sequelize.query(`
    SELECT COALESCE(gift_code, 'Unknown') as gift_type,
           COUNT(*) as gift_count,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_id = :appealId${dateWhere(dateRange)}
    GROUP BY gift_type ORDER BY total DESC
  `, { replacements: { tenantId, appealId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Funds breakdown
  const byFund = await sequelize.query(`
    SELECT fund_description, fund_id,
           COUNT(*) as gift_count,
           COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_id = :appealId AND fund_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY fund_description, fund_id ORDER BY total DESC LIMIT 10
  `, { replacements: { tenantId, appealId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Donor overlap with other appeals
  const overlap = await sequelize.query(`
    WITH appeal_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND appeal_id = :appealId${dateWhere(dateRange)}
    )
    SELECT g.appeal_description, g.appeal_id,
           COUNT(DISTINCT g.constituent_id) as shared_donors,
           COALESCE(SUM(g.gift_amount), 0) as total_from_shared
    FROM crm_gifts g
    JOIN appeal_donors ad ON g.constituent_id = ad.constituent_id
    WHERE g.tenant_id = :tenantId AND g.appeal_id != :appealId
      AND g.appeal_description IS NOT NULL${dateWhere(dateRange, 'g')}
    GROUP BY g.appeal_description, g.appeal_id
    ORDER BY shared_donors DESC LIMIT 10
  `, { replacements: { tenantId, appealId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  return { byMonth, topDonors, byType, byFund, overlap };
}

// ---------------------------------------------------------------------------
// Department Analytics
// ---------------------------------------------------------------------------
// Classification now happens at import time via crmDepartmentClassifier.js.
// The pre-computed `department` column on crm_gifts eliminates all regex
// from query time, turning 30s+ queries into sub-second indexed lookups.

async function getDepartmentAnalytics(tenantId, dateRange) {
  const dw = dateWhere(dateRange);
  const dr = dateReplacements(dateRange);
  const t0 = Date.now();
  const repl = { tenantId, ...dr };

  // Uses pre-computed `department` column — no regex at query time.
  // The fy_bounds CTE is lightweight (single MAX on indexed column).
  const rows = await sequelize.query(`
    WITH fy_bounds AS (
      SELECT MAX(CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
                      THEN EXTRACT(YEAR FROM gift_date) + 1
                      ELSE EXTRACT(YEAR FROM gift_date) END) AS current_fy
      FROM crm_gifts WHERE tenant_id = :tenantId AND gift_date IS NOT NULL${dw}
    )
    SELECT
      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT department, COUNT(*) as gift_count,
               COUNT(DISTINCT constituent_id) as donor_count,
               COALESCE(SUM(gift_amount),0) as total_amount,
               COALESCE(AVG(gift_amount),0) as avg_gift
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
        GROUP BY department ORDER BY SUM(gift_amount) DESC
      ) r) as summary,

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT department, TO_CHAR(gift_date,'YYYY-MM') as month,
               COALESCE(SUM(gift_amount),0) as total
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL
          AND gift_date >= (CURRENT_DATE - INTERVAL '24 months')${dw}
        GROUP BY department, month ORDER BY month
      ) r) as monthly,

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT g.department,
               SUM(CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy THEN gift_amount ELSE 0 END) as current_fy_total,
               SUM(CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy-1 THEN gift_amount ELSE 0 END) as prior_fy_total,
               COUNT(CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy THEN 1 END) as current_fy_gifts,
               COUNT(CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy-1 THEN 1 END) as prior_fy_gifts,
               COUNT(DISTINCT CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy THEN constituent_id END) as current_fy_donors,
               COUNT(DISTINCT CASE WHEN (CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
                    THEN EXTRACT(YEAR FROM g.gift_date) + 1
                    ELSE EXTRACT(YEAR FROM g.gift_date) END) = fb.current_fy-1 THEN constituent_id END) as prior_fy_donors,
               fb.current_fy
        FROM crm_gifts g, fy_bounds fb
        WHERE g.tenant_id = :tenantId AND g.department IS NOT NULL AND g.gift_date IS NOT NULL${dw.replace(/gift_date/g, 'g.gift_date')}
        GROUP BY g.department, fb.current_fy
      ) r) as yoy,

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT * FROM (
          SELECT department, constituent_id, first_name, last_name,
                 COUNT(*) as gift_count, SUM(gift_amount) as total,
                 ROW_NUMBER() OVER (PARTITION BY department ORDER BY SUM(gift_amount) DESC) as rn
          FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
          GROUP BY department, constituent_id, first_name, last_name
        ) ranked WHERE rn <= 5
      ) r) as "topDonors",

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT department, COALESCE(gift_code,'Unknown') as gift_type,
               COUNT(*) as gift_count, COALESCE(SUM(gift_amount),0) as total
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
        GROUP BY department, gift_type ORDER BY department, SUM(gift_amount) DESC
      ) r) as "giftTypes",

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT department,
               CASE WHEN EXTRACT(MONTH FROM gift_date) IN (4,5,6) THEN 'Q1 (Apr-Jun)'
                    WHEN EXTRACT(MONTH FROM gift_date) IN (7,8,9) THEN 'Q2 (Jul-Sep)'
                    WHEN EXTRACT(MONTH FROM gift_date) IN (10,11,12) THEN 'Q3 (Oct-Dec)'
                    ELSE 'Q4 (Jan-Mar)' END as fq,
               COUNT(*) as gift_count, COALESCE(SUM(gift_amount),0) as total,
               COALESCE(AVG(gift_amount),0) as avg_gift
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL AND gift_date IS NOT NULL${dw}
        GROUP BY department, fq ORDER BY department, fq
      ) r) as seasonality,

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT department,
               CASE WHEN gift_amount<100 THEN 'Under $100' WHEN gift_amount<500 THEN '$100-$499'
                    WHEN gift_amount<1000 THEN '$500-$999' WHEN gift_amount<5000 THEN '$1K-$4,999'
                    WHEN gift_amount<10000 THEN '$5K-$9,999' WHEN gift_amount<25000 THEN '$10K-$24,999'
                    WHEN gift_amount<100000 THEN '$25K-$99,999' ELSE '$100K+' END as bracket,
               CASE WHEN gift_amount<100 THEN 1 WHEN gift_amount<500 THEN 2
                    WHEN gift_amount<1000 THEN 3 WHEN gift_amount<5000 THEN 4
                    WHEN gift_amount<10000 THEN 5 WHEN gift_amount<25000 THEN 6
                    WHEN gift_amount<100000 THEN 7 ELSE 8 END as sort_order,
               COUNT(*) as gift_count, COALESCE(SUM(gift_amount),0) as total,
               COUNT(DISTINCT constituent_id) as donor_count
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
        GROUP BY department, bracket, sort_order ORDER BY department, sort_order
      ) r) as "giftSizes"
  `, { replacements: repl, ...QUERY_OPTS });

  const result = rows[0] || {};
  console.log('[getDeptAnalytics] Done in', Date.now() - t0, 'ms');
  return {
    summary: result.summary || [],
    monthly: result.monthly || [],
    yoy: result.yoy || [],
    topDonors: result.topDonors || [],
    giftTypes: result.giftTypes || [],
    seasonality: result.seasonality || [],
    giftSizes: result.giftSizes || [],
    crossDept: [], multiDeptDonors: [], signalSample: [],
  };
}

// Lazy-loaded heavy analytics (cross-dept overlap, signals)
async function getDepartmentExtras(tenantId, dateRange) {
  const dw = dateWhere(dateRange);
  const dr = dateReplacements(dateRange);
  const repl = { tenantId, ...dr };
  const t0 = Date.now();

  // Uses pre-computed department column — no regex at query time
  const rows = await sequelize.query(`
    SELECT
      (SELECT COALESCE(json_agg(r),'[]') FROM (
        WITH dd AS (
          SELECT constituent_id, COUNT(DISTINCT department) as dept_count,
                 SUM(gift_amount) as total_given
          FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
          GROUP BY constituent_id
        )
        SELECT dept_count, COUNT(*) as donor_count,
               COALESCE(SUM(total_given),0) as total_given,
               COALESCE(AVG(total_given),0) as avg_total
        FROM dd GROUP BY dept_count ORDER BY dept_count
      ) r) as "crossDept",

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        WITH dd AS (
          SELECT constituent_id,
                 ARRAY_AGG(DISTINCT department ORDER BY department) as depts,
                 COUNT(DISTINCT department) as dept_count,
                 MIN(first_name) as first_name, MIN(last_name) as last_name,
                 SUM(gift_amount) as total_given, COUNT(*) as gift_count
          FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
          GROUP BY constituent_id
        )
        SELECT * FROM dd WHERE dept_count >= 2
        ORDER BY total_given DESC LIMIT 10
      ) r) as "multiDeptDonors",

      (SELECT COALESCE(json_agg(r),'[]') FROM (
        SELECT * FROM (
          SELECT department,
                 COALESCE(appeal_category,'') as appeal_category,
                 COALESCE(fund_category,'') as fund_category,
                 COALESCE(gift_code,'') as gift_code,
                 COALESCE(appeal_description,'') as appeal_description,
                 COALESCE(fund_description,'') as fund_description,
                 COUNT(*) as cnt,
                 ROW_NUMBER() OVER (PARTITION BY department ORDER BY COUNT(*) DESC) as rn
          FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL${dw}
          GROUP BY department, appeal_category, fund_category, gift_code, appeal_description, fund_description
        ) ranked WHERE rn <= 10
      ) r) as "signalSample"
  `, { replacements: repl, ...QUERY_OPTS });

  const result = rows[0] || {};
  console.log('[getDeptExtras] Done in', Date.now() - t0, 'ms');
  return {
    crossDept: result.crossDept || [],
    multiDeptDonors: result.multiDeptDonors || [],
    signalSample: result.signalSample || [],
  };
}

// ---------------------------------------------------------------------------
// Household-Level Giving — group donors via soft credits into households
// A "household" is defined as the hard-credit donor + all soft-credit
// recipients on the same gifts. This deduplicates spouse/partner giving.
// ---------------------------------------------------------------------------
async function getHouseholdGiving(tenantId, dateRange) {
  const dw = dateWhere(dateRange, 'g');
  const repl = { tenantId, ...dateReplacements(dateRange) };

  // Build household groups: link donor constituent_id to soft credit recipient_ids
  // Each household is identified by the lowest constituent_id in the group
  const households = await sequelize.query(`
    WITH links AS (
      -- For each gift, link the hard-credit donor to each soft-credit recipient
      SELECT DISTINCT g.constituent_id as donor_id, s.recipient_id
      FROM crm_gifts g
      JOIN crm_gift_soft_credits s ON g.gift_id = s.gift_id AND g.tenant_id = s.tenant_id
      WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL AND s.recipient_id IS NOT NULL
        AND g.constituent_id != s.recipient_id
    ),
    household_map AS (
      -- Each pair shares a household; use LEAST as the household key
      SELECT LEAST(donor_id, recipient_id) as household_id,
             GREATEST(donor_id, recipient_id) as member_id
      FROM links
    ),
    all_members AS (
      SELECT household_id, household_id as member FROM household_map
      UNION
      SELECT household_id, member_id as member FROM household_map
    ),
    household_names AS (
      SELECT am.household_id,
             am.member,
             MAX(CONCAT(COALESCE(g.first_name,''), ' ', COALESCE(g.last_name,''))) as name
      FROM all_members am
      JOIN crm_gifts g ON am.member = g.constituent_id AND g.tenant_id = :tenantId
      GROUP BY am.household_id, am.member
    ),
    household_giving AS (
      SELECT am.household_id,
             SUM(g.gift_amount) as total_giving,
             COUNT(*) as gift_count,
             COUNT(DISTINCT am.member) as member_count,
             MIN(g.gift_date) as first_gift,
             MAX(g.gift_date) as last_gift
      FROM all_members am
      JOIN crm_gifts g ON am.member = g.constituent_id AND g.tenant_id = :tenantId${dw}
      GROUP BY am.household_id
    ),
    individual_giving AS (
      -- Giving by individuals NOT in any household
      SELECT g.constituent_id as household_id,
             SUM(g.gift_amount) as total_giving,
             COUNT(*) as gift_count,
             1 as member_count,
             MIN(g.gift_date) as first_gift,
             MAX(g.gift_date) as last_gift
      FROM crm_gifts g
      WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL${dw}
        AND g.constituent_id NOT IN (SELECT member FROM all_members)
      GROUP BY g.constituent_id
    )
    SELECT * FROM (
      SELECT * FROM household_giving
      UNION ALL
      SELECT * FROM individual_giving
    ) combined
    ORDER BY total_giving DESC
    LIMIT 100
  `, { replacements: repl, ...QUERY_OPTS });

  // Summary stats
  const [summary] = await sequelize.query(`
    WITH links AS (
      SELECT DISTINCT g.constituent_id as donor_id, s.recipient_id
      FROM crm_gifts g
      JOIN crm_gift_soft_credits s ON g.gift_id = s.gift_id AND g.tenant_id = s.tenant_id
      WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL AND s.recipient_id IS NOT NULL
        AND g.constituent_id != s.recipient_id
    ),
    household_map AS (
      SELECT LEAST(donor_id, recipient_id) as household_id,
             GREATEST(donor_id, recipient_id) as member_id
      FROM links
    ),
    all_members AS (
      SELECT household_id, household_id as member FROM household_map
      UNION
      SELECT household_id, member_id as member FROM household_map
    )
    SELECT
      (SELECT COUNT(DISTINCT constituent_id) FROM crm_gifts WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dw}) as total_individuals,
      (SELECT COUNT(DISTINCT household_id) FROM household_map) as household_count,
      (SELECT COUNT(DISTINCT member) FROM all_members) as members_in_households,
      (SELECT COALESCE(SUM(g.gift_amount), 0) FROM crm_gifts g WHERE g.tenant_id = :tenantId${dw}) as total_giving
  `, { replacements: repl, ...QUERY_OPTS });

  // Get household member names for top households
  let householdDetails = [];
  if (households.length > 0) {
    const topIds = households.filter(h => Number(h.member_count) > 1).slice(0, 50).map(h => h.household_id);
    if (topIds.length > 0) {
      householdDetails = await sequelize.query(`
        WITH links AS (
          SELECT DISTINCT g.constituent_id as donor_id, s.recipient_id
          FROM crm_gifts g
          JOIN crm_gift_soft_credits s ON g.gift_id = s.gift_id AND g.tenant_id = s.tenant_id
          WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL AND s.recipient_id IS NOT NULL
            AND g.constituent_id != s.recipient_id
        ),
        household_map AS (
          SELECT LEAST(donor_id, recipient_id) as household_id,
                 GREATEST(donor_id, recipient_id) as member_id
          FROM links
        ),
        all_members AS (
          SELECT household_id, household_id as member FROM household_map
          UNION
          SELECT household_id, member_id as member FROM household_map
        )
        SELECT am.household_id, am.member as constituent_id,
               MAX(CONCAT(COALESCE(g.first_name,''), ' ', COALESCE(g.last_name,''))) as name,
               COALESCE(SUM(g.gift_amount), 0) as individual_total
        FROM all_members am
        JOIN crm_gifts g ON am.member = g.constituent_id AND g.tenant_id = :tenantId${dw}
        WHERE am.household_id IN (:topIds)
        GROUP BY am.household_id, am.member
        ORDER BY am.household_id, individual_total DESC
      `, { replacements: { ...repl, topIds }, ...QUERY_OPTS });
    }
  }

  // Group member details by household
  const detailMap = {};
  householdDetails.forEach(d => {
    if (!detailMap[d.household_id]) detailMap[d.household_id] = [];
    detailMap[d.household_id].push(d);
  });

  const s = summary;
  const totalIndividuals = Number(s.total_individuals || 0);
  const householdCount = Number(s.household_count || 0);
  const membersInHouseholds = Number(s.members_in_households || 0);
  const effectiveHouseholds = totalIndividuals - membersInHouseholds + householdCount;

  return {
    totalIndividuals,
    householdCount,
    membersInHouseholds,
    effectiveHouseholds,
    totalGiving: Number(s.total_giving || 0),
    deduplicationRate: totalIndividuals > 0 ? ((1 - effectiveHouseholds / totalIndividuals) * 100).toFixed(1) : 0,
    topHouseholds: households.map(h => ({
      ...h,
      total_giving: Number(h.total_giving || 0),
      gift_count: Number(h.gift_count || 0),
      member_count: Number(h.member_count || 0),
      members: detailMap[h.household_id] || [],
    })),
  };
}

// ---------------------------------------------------------------------------
// Enhanced Retention Analytics — drill-down by fund, campaign, dept, giving band
// ---------------------------------------------------------------------------
async function getRetentionDrilldown(tenantId, currentFY) {
  if (!currentFY) return null;
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd   = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd  = `${currentFY - 1}-04-01`;

  // Overall retention (same as getDonorRetention but we need it alongside drill-downs)
  const [overall] = await sequelize.query(`
    WITH cur AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
    ),
    prev AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM prev) as prior_donors,
      (SELECT COUNT(*) FROM cur) as current_donors,
      (SELECT COUNT(*) FROM cur c INNER JOIN prev p ON c.constituent_id = p.constituent_id) as retained,
      (SELECT COUNT(*) FROM prev p LEFT JOIN cur c ON p.constituent_id = c.constituent_id WHERE c.constituent_id IS NULL) as lapsed
  `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

  // Retention by department
  const byDepartment = await sequelize.query(`
    WITH prev_donors AS (
      SELECT constituent_id, department
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd
        AND constituent_id IS NOT NULL AND department IS NOT NULL
      GROUP BY constituent_id, department
    ),
    cur_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
    )
    SELECT p.department,
           COUNT(DISTINCT p.constituent_id) as prior_donors,
           COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END) as retained,
           ROUND(COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END)::numeric /
             NULLIF(COUNT(DISTINCT p.constituent_id), 0) * 100, 1) as retention_rate
    FROM prev_donors p
    LEFT JOIN cur_donors c ON p.constituent_id = c.constituent_id
    GROUP BY p.department
    ORDER BY retention_rate DESC
  `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

  // Retention by fund (top 15 by prior donor count)
  const byFund = await sequelize.query(`
    WITH prev_donors AS (
      SELECT constituent_id, fund_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd
        AND constituent_id IS NOT NULL AND fund_description IS NOT NULL
      GROUP BY constituent_id, fund_description
    ),
    cur_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
    )
    SELECT p.fund_description as name,
           COUNT(DISTINCT p.constituent_id) as prior_donors,
           COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END) as retained,
           ROUND(COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END)::numeric /
             NULLIF(COUNT(DISTINCT p.constituent_id), 0) * 100, 1) as retention_rate
    FROM prev_donors p
    LEFT JOIN cur_donors c ON p.constituent_id = c.constituent_id
    GROUP BY p.fund_description
    HAVING COUNT(DISTINCT p.constituent_id) >= 5
    ORDER BY prior_donors DESC
    LIMIT 15
  `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

  // Retention by campaign (top 15)
  const byCampaign = await sequelize.query(`
    WITH prev_donors AS (
      SELECT constituent_id, campaign_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd
        AND constituent_id IS NOT NULL AND campaign_description IS NOT NULL
      GROUP BY constituent_id, campaign_description
    ),
    cur_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
    )
    SELECT p.campaign_description as name,
           COUNT(DISTINCT p.constituent_id) as prior_donors,
           COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END) as retained,
           ROUND(COUNT(DISTINCT CASE WHEN c.constituent_id IS NOT NULL THEN p.constituent_id END)::numeric /
             NULLIF(COUNT(DISTINCT p.constituent_id), 0) * 100, 1) as retention_rate
    FROM prev_donors p
    LEFT JOIN cur_donors c ON p.constituent_id = c.constituent_id
    GROUP BY p.campaign_description
    HAVING COUNT(DISTINCT p.constituent_id) >= 5
    ORDER BY prior_donors DESC
    LIMIT 15
  `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

  // Retention by giving band (based on prior FY giving)
  const byGivingBand = await sequelize.query(`
    WITH prev_donors AS (
      SELECT constituent_id, SUM(gift_amount) as prior_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
      GROUP BY constituent_id
    ),
    cur_donors AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
    ),
    banded AS (
      SELECT p.constituent_id,
             CASE WHEN c.constituent_id IS NOT NULL THEN 1 ELSE 0 END as retained,
             CASE
               WHEN p.prior_total < 100 THEN '$1–$99'
               WHEN p.prior_total < 500 THEN '$100–$499'
               WHEN p.prior_total < 1000 THEN '$500–$999'
               WHEN p.prior_total < 5000 THEN '$1K–$4,999'
               WHEN p.prior_total < 10000 THEN '$5K–$9,999'
               ELSE '$10,000+'
             END as band,
             CASE
               WHEN p.prior_total < 100 THEN 1
               WHEN p.prior_total < 500 THEN 2
               WHEN p.prior_total < 1000 THEN 3
               WHEN p.prior_total < 5000 THEN 4
               WHEN p.prior_total < 10000 THEN 5
               ELSE 6
             END as band_order
      FROM prev_donors p
      LEFT JOIN cur_donors c ON p.constituent_id = c.constituent_id
    )
    SELECT band, band_order,
           COUNT(*) as prior_donors,
           SUM(retained) as retained,
           ROUND(SUM(retained)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as retention_rate
    FROM banded
    GROUP BY band, band_order
    ORDER BY band_order
  `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

  // Multi-year retention trend (last 5 FYs)
  const retentionTrend = [];
  for (let fy = currentFY; fy >= currentFY - 4 && fy >= 2; fy--) {
    const cs = `${fy - 1}-04-01`, ce = `${fy}-04-01`;
    const ps = `${fy - 2}-04-01`, pe = `${fy - 1}-04-01`;
    try {
      const [row] = await sequelize.query(`
        WITH cur AS (
          SELECT DISTINCT constituent_id FROM crm_gifts
          WHERE tenant_id = :tenantId AND gift_date >= :cs AND gift_date < :ce AND constituent_id IS NOT NULL
        ),
        prev AS (
          SELECT DISTINCT constituent_id FROM crm_gifts
          WHERE tenant_id = :tenantId AND gift_date >= :ps AND gift_date < :pe AND constituent_id IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*) FROM prev) as prior_donors,
          (SELECT COUNT(*) FROM cur c INNER JOIN prev p ON c.constituent_id = p.constituent_id) as retained
      `, { replacements: { tenantId, cs, ce, ps, pe }, ...QUERY_OPTS });
      const pd = Number(row.prior_donors);
      retentionTrend.push({
        fy,
        priorDonors: pd,
        retained: Number(row.retained),
        rate: pd > 0 ? (Number(row.retained) / pd * 100).toFixed(1) : null,
      });
    } catch (e) { /* skip years with no data */ }
  }

  const priorDonors = Number(overall.prior_donors);
  const retained = Number(overall.retained);

  return {
    currentFY,
    priorFY: currentFY - 1,
    overall: {
      priorDonors,
      currentDonors: Number(overall.current_donors),
      retained,
      lapsed: Number(overall.lapsed),
      retentionRate: priorDonors > 0 ? (retained / priorDonors * 100).toFixed(1) : null,
    },
    byDepartment,
    byFund,
    byCampaign,
    byGivingBand,
    retentionTrend: retentionTrend.reverse(),
  };
}

// ---------------------------------------------------------------------------
// Proactive Insights — auto-generated insight cards for the CRM dashboard
// Computes actionable stats from existing data on login
// ---------------------------------------------------------------------------
async function getProactiveInsights(tenantId, currentFY) {
  if (!currentFY) return [];
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd   = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd  = `${currentFY - 1}-04-01`;
  const _fmt = n => Number(n || 0).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0});

  const insights = [];

  try {
    // 1. Lapsing donors (gave last FY, not yet this FY)
    const [lapsing] = await sequelize.query(`
      WITH cur AS (
        SELECT DISTINCT constituent_id FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
      ),
      prev AS (
        SELECT constituent_id, SUM(gift_amount) as total
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
      )
      SELECT COUNT(*) as cnt, COALESCE(SUM(p.total), 0) as revenue
      FROM prev p LEFT JOIN cur c ON p.constituent_id = c.constituent_id
      WHERE c.constituent_id IS NULL
    `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

    if (Number(lapsing.cnt) > 0) {
      insights.push({
        type: 'warning',
        icon: 'bi-person-dash',
        title: _fmt(lapsing.cnt) + ' donors at risk of lapsing',
        detail: '$' + _fmt(lapsing.revenue) + ' in revenue at risk — gave in FY' + (currentFY - 1) + ' but not yet in FY' + currentFY,
        link: '/crm/lybunt-sybunt?fy=' + currentFY,
        linkText: 'View LYBUNT report',
      });
    }
  } catch (e) { console.warn('[Insights] Lapsing error:', e.message); }

  try {
    // 2. YoY giving comparison
    const [yoy] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE WHEN gift_date >= :curStart AND gift_date < :curEnd THEN gift_amount END), 0) as current_total,
        COALESCE(SUM(CASE WHEN gift_date >= :prevStart AND gift_date < :prevEnd THEN gift_amount END), 0) as prior_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :curEnd
    `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

    const curTotal = Number(yoy.current_total);
    const prevTotal = Number(yoy.prior_total);
    if (prevTotal > 0) {
      const pctChange = ((curTotal - prevTotal) / prevTotal * 100).toFixed(1);
      const isUp = curTotal >= prevTotal;
      insights.push({
        type: isUp ? 'success' : 'danger',
        icon: isUp ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow',
        title: 'FY' + currentFY + ' giving is ' + (isUp ? 'up' : 'down') + ' ' + Math.abs(pctChange) + '% vs FY' + (currentFY - 1),
        detail: '$' + _fmt(curTotal) + ' current vs $' + _fmt(prevTotal) + ' prior year-to-date',
        link: '/crm/yoy-compare?fy=' + currentFY,
        linkText: 'View Year-over-Year',
      });
    }
  } catch (e) { console.warn('[Insights] YoY error:', e.message); }

  try {
    // 3. First-time donor conversion rate
    const [ftd] = await sequelize.query(`
      WITH donor_gifts AS (
        SELECT constituent_id,
               MIN(gift_date) as first_gift_date,
               COUNT(*) as total_gifts
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        GROUP BY constituent_id
        HAVING MIN(gift_date) >= :prevStart AND MIN(gift_date) < :prevEnd
      )
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE total_gifts > 1) as converted
      FROM donor_gifts
    `, { replacements: { tenantId, prevStart, prevEnd }, ...QUERY_OPTS });

    const total = Number(ftd.total);
    const converted = Number(ftd.converted);
    if (total > 0) {
      const rate = (converted / total * 100).toFixed(1);
      const benchmark = 19.0;
      insights.push({
        type: Number(rate) >= benchmark ? 'success' : 'warning',
        icon: 'bi-person-check',
        title: 'First-time donor retention: ' + rate + '%',
        detail: converted + ' of ' + total + ' FY' + (currentFY - 1) + ' first-time donors made a second gift (national avg: ' + benchmark + '%)',
        link: '/crm/first-time-donors',
        linkText: 'View conversion funnel',
      });
    }
  } catch (e) { console.warn('[Insights] FTD error:', e.message); }

  try {
    // 4. Upgrade/downgrade summary
    const rows = await sequelize.query(`
      WITH cur AS (
        SELECT constituent_id, SUM(gift_amount) as total FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
      ),
      prev AS (
        SELECT constituent_id, SUM(gift_amount) as total FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
      )
      SELECT
        COUNT(*) FILTER (WHERE c.total > p.total * 1.1) as upgraded,
        COUNT(*) FILTER (WHERE c.total < p.total * 0.9) as downgraded
      FROM cur c INNER JOIN prev p ON c.constituent_id = p.constituent_id
    `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

    const r = rows[0] || {};
    const upgraded = Number(r.upgraded || 0);
    const downgraded = Number(r.downgraded || 0);
    if (upgraded + downgraded > 0) {
      insights.push({
        type: upgraded > downgraded ? 'success' : 'warning',
        icon: 'bi-arrow-up-down',
        title: upgraded + ' donors upgraded, ' + downgraded + ' downgraded',
        detail: 'Returning donors who changed giving by more than 10% in FY' + currentFY + ' vs FY' + (currentFY - 1),
        link: '/crm/donor-upgrade-downgrade?fy=' + currentFY,
        linkText: 'View upgrade/downgrade',
      });
    }
  } catch (e) { console.warn('[Insights] Upgrade error:', e.message); }

  try {
    // 5. Recent large gifts (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const [bigGifts] = await sequelize.query(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(gift_amount), 0) as total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_amount >= 1000 AND gift_date >= :since
    `, { replacements: { tenantId, since: thirtyDaysAgo }, ...QUERY_OPTS });

    if (Number(bigGifts.cnt) > 0) {
      insights.push({
        type: 'info',
        icon: 'bi-gift',
        title: bigGifts.cnt + ' gifts of $1,000+ in the last 30 days',
        detail: '$' + _fmt(bigGifts.total) + ' from major gifts since ' + thirtyDaysAgo,
        link: '/crm/gifts',
        linkText: 'Search gifts',
      });
    }
  } catch (e) { console.warn('[Insights] Big gifts error:', e.message); }

  try {
    // 6. Anomaly count — surface high-severity anomalies
    const anomalyData = await getAnomalyDetection(tenantId, null);
    const highAnomalies = anomalyData.anomalies.filter(a => a.severity === 'high');
    if (highAnomalies.length > 0) {
      insights.push({
        type: 'danger',
        icon: 'bi-exclamation-triangle',
        title: highAnomalies.length + ' high-severity anomal' + (highAnomalies.length === 1 ? 'y' : 'ies') + ' detected',
        detail: highAnomalies.slice(0, 2).map(a => a.title).join('; '),
        link: '/crm/anomalies',
        linkText: 'View anomalies',
      });
    }
  } catch (e) { console.warn('[Insights] Anomaly error:', e.message); }

  return insights;
}

// ---------------------------------------------------------------------------
// LYBUNT / SYBUNT — donors who gave in prior FY(s) but not current FY
// LYBUNT = Last Year But Unfortunately Not This Year
// SYBUNT = Some Years But Unfortunately Not This Year (gave 2+ years ago, not last year or this year)
// ---------------------------------------------------------------------------
async function getLybuntSybunt(tenantId, currentFY, { page = 1, limit = 50, category, yearsSince, gaveInFyStart, gaveInFyEnd, notInFyStart, notInFyEnd, segment } = {}) {
  if (!currentFY) return null;
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd   = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd  = `${currentFY - 1}-04-01`;
  const offset = (page - 1) * limit;

  // Resolve segment presets into filter parameters
  if (segment === 'recently-lapsed') {
    category = 'LYBUNT';
  } else if (segment === 'long-lapsed') {
    yearsSince = '5+';
  } else if (segment === 'high-value-lapsed') {
    // handled in query via HAVING
  } else if (segment === 'frequent-gone-quiet') {
    // handled in query via HAVING
  } else if (segment === 'one-and-done') {
    // handled in query via HAVING
  }

  // Main query: classify each non-current donor as LYBUNT or SYBUNT
  const rows = await sequelize.query(`
    WITH current_fy AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd
        AND constituent_id IS NOT NULL
    ),
    prior_fy AS (
      SELECT constituent_id,
             COUNT(*) as gift_count,
             SUM(gift_amount) as total_given,
             MAX(gift_date) as last_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd
        AND constituent_id IS NOT NULL
      GROUP BY constituent_id
    ),
    older AS (
      SELECT constituent_id,
             COUNT(*) as gift_count,
             SUM(gift_amount) as total_given,
             MAX(gift_date) as last_gift_date
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date < :prevStart
        AND constituent_id IS NOT NULL
      GROUP BY constituent_id
    ),
    lybunt AS (
      SELECT p.constituent_id, p.total_given, p.gift_count, p.last_gift_date,
             'LYBUNT' as category
      FROM prior_fy p
      LEFT JOIN current_fy c ON p.constituent_id = c.constituent_id
      WHERE c.constituent_id IS NULL
    ),
    sybunt AS (
      SELECT o.constituent_id, o.total_given, o.gift_count, o.last_gift_date,
             'SYBUNT' as category
      FROM older o
      LEFT JOIN current_fy c ON o.constituent_id = c.constituent_id
      LEFT JOIN prior_fy p ON o.constituent_id = p.constituent_id
      WHERE c.constituent_id IS NULL AND p.constituent_id IS NULL
    ),
    combined AS (
      SELECT * FROM lybunt UNION ALL SELECT * FROM sybunt
    )
    SELECT category,
           COUNT(*) as donor_count,
           SUM(total_given) as revenue_at_risk,
           AVG(total_given) as avg_gift,
           MAX(last_gift_date) as most_recent
    FROM combined
    GROUP BY category
    ORDER BY category
  `, {
    replacements: { tenantId, curStart, curEnd, prevStart, prevEnd },
    ...QUERY_OPTS,
  });

  // Summary by giving band
  const bands = await sequelize.query(`
    WITH current_fy AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd
        AND constituent_id IS NOT NULL
    ),
    lapsed_donors AS (
      SELECT constituent_id,
             SUM(gift_amount) as total_given,
             MAX(gift_date) as last_gift_date,
             CASE
               WHEN MAX(gift_date) >= :prevStart THEN 'LYBUNT'
               ELSE 'SYBUNT'
             END as category
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      GROUP BY constituent_id
      HAVING constituent_id NOT IN (SELECT constituent_id FROM current_fy)
    )
    SELECT category,
           CASE
             WHEN total_given < 100 THEN '$1–$99'
             WHEN total_given < 500 THEN '$100–$499'
             WHEN total_given < 1000 THEN '$500–$999'
             WHEN total_given < 5000 THEN '$1K–$4,999'
             WHEN total_given < 10000 THEN '$5K–$9,999'
             ELSE '$10,000+'
           END as band,
           CASE
             WHEN total_given < 100 THEN 1
             WHEN total_given < 500 THEN 2
             WHEN total_given < 1000 THEN 3
             WHEN total_given < 5000 THEN 4
             WHEN total_given < 10000 THEN 5
             ELSE 6
           END as band_order,
           COUNT(*) as donor_count,
           SUM(total_given) as band_total
    FROM lapsed_donors
    GROUP BY category, band, band_order
    ORDER BY category, band_order
  `, {
    replacements: { tenantId, curStart, curEnd, prevStart, prevEnd },
    ...QUERY_OPTS,
  });

  // Build dynamic WHERE filters for the lapsed CTE results
  const filterClauses = [];
  const extraReplacements = {};
  if (category) {
    filterClauses.push('category = :category');
    extraReplacements.category = category;
  }
  // Years since last gift filter
  if (yearsSince) {
    if (yearsSince === '1') {
      filterClauses.push('last_gift_date >= :ysCutoff');
      extraReplacements.ysCutoff = `${currentFY - 2}-04-01`;
    } else if (yearsSince === '2-3') {
      filterClauses.push('last_gift_date < :ysCutoffHi AND last_gift_date >= :ysCutoffLo');
      extraReplacements.ysCutoffHi = `${currentFY - 2}-04-01`;
      extraReplacements.ysCutoffLo = `${currentFY - 4}-04-01`;
    } else if (yearsSince === '4-5') {
      filterClauses.push('last_gift_date < :ysCutoffHi AND last_gift_date >= :ysCutoffLo');
      extraReplacements.ysCutoffHi = `${currentFY - 4}-04-01`;
      extraReplacements.ysCutoffLo = `${currentFY - 6}-04-01`;
    } else if (yearsSince === '5+') {
      filterClauses.push('last_gift_date < :ysCutoff');
      extraReplacements.ysCutoff = `${currentFY - 6}-04-01`;
    }
  }
  // Custom FY range: gave in a specific range
  if (gaveInFyStart && gaveInFyEnd) {
    filterClauses.push(`constituent_id IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :gaveStartDate AND gift_date < :gaveEndDate
        AND constituent_id IS NOT NULL
    )`);
    extraReplacements.gaveStartDate = `${gaveInFyStart - 1}-04-01`;
    extraReplacements.gaveEndDate = `${gaveInFyEnd}-04-01`;
  }
  // Custom FY range: did NOT give in a specific range
  if (notInFyStart && notInFyEnd) {
    filterClauses.push(`constituent_id NOT IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :notInStart AND gift_date < :notInEnd
        AND constituent_id IS NOT NULL
    )`);
    extraReplacements.notInStart = `${notInFyStart - 1}-04-01`;
    extraReplacements.notInEnd = `${notInFyEnd}-04-01`;
  }
  // Segment presets with custom conditions
  if (segment === 'high-value-lapsed') {
    filterClauses.push('lifetime_giving >= 1000');
  } else if (segment === 'frequent-gone-quiet') {
    filterClauses.push('total_gifts >= 3');
    filterClauses.push('last_gift_date < :freqCutoff');
    extraReplacements.freqCutoff = `${currentFY - 3}-04-01`;
  } else if (segment === 'one-and-done') {
    filterClauses.push('total_gifts = 1');
  }

  const filterWhere = filterClauses.length ? 'WHERE ' + filterClauses.join(' AND ') : '';
  const allReplacements = { tenantId, curStart, curEnd, prevStart, prevEnd, ...extraReplacements };

  // Shared lapsed CTE — uses LEFT JOIN anti-pattern instead of NOT IN for performance
  const lapsedCte = `
    current_fy AS (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd
        AND constituent_id IS NOT NULL
    ),
    lapsed AS (
      SELECT g.constituent_id,
             COALESCE(NULLIF(TRIM(MAX(CONCAT(COALESCE(g.first_name,''), ' ', COALESCE(g.last_name,'')))), ''), g.constituent_id) as donor_name,
             MAX(g.first_name) as first_name,
             MAX(g.last_name) as last_name,
             MAX(g.constituent_email) as constituent_email,
             MAX(g.constituent_phone) as constituent_phone,
             MAX(g.constituent_address) as constituent_address,
             MAX(g.constituent_city) as constituent_city,
             MAX(g.constituent_state) as constituent_state,
             MAX(g.constituent_zip) as constituent_zip,
             SUM(CASE WHEN g.gift_date >= :prevStart AND g.gift_date < :prevEnd THEN g.gift_amount ELSE 0 END) as last_year_giving,
             SUM(g.gift_amount) as lifetime_giving,
             COUNT(*) as total_gifts,
             MAX(g.gift_date) as last_gift_date,
             MIN(g.gift_date) as first_gift_date,
             COUNT(DISTINCT EXTRACT(YEAR FROM g.gift_date + INTERVAL '9 months')) as distinct_fy_count,
             CASE
               WHEN MAX(g.gift_date) >= :prevStart THEN 'LYBUNT'
               ELSE 'SYBUNT'
             END as category
      FROM crm_gifts g
      LEFT JOIN current_fy cf ON g.constituent_id = cf.constituent_id
      WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL
        AND cf.constituent_id IS NULL
      GROUP BY g.constituent_id
    )`;

  // filtered_ids CTE extracts just the IDs once to avoid re-materializing lapsed
  const filteredIdsCte = `${lapsedCte},
    filtered_ids AS (
      SELECT constituent_id FROM lapsed ${filterWhere}
    )`;

  // Count total lapsed donors with filters
  const [countResult] = await sequelize.query(`
    WITH ${filteredIdsCte}
    SELECT COUNT(*) as total FROM filtered_ids
  `, {
    replacements: allReplacements,
    ...QUERY_OPTS,
  });
  const topDonorsTotal = Number(countResult.total || 0);

  // Top at-risk donors (paginated, with consecutive years and giving trend)
  // For one-and-done segment, skip expensive consecutive/trend CTEs (always 1 yr, one-time)
  const skipTrendCtes = segment === 'one-and-done';

  const topDonorsQuery = skipTrendCtes ? `
    WITH ${filteredIdsCte}
    SELECT l.*,
           1 as consecutive_years,
           'one-time' as giving_trend
    FROM (SELECT * FROM lapsed ${filterWhere}) l
    ORDER BY last_year_giving DESC NULLS LAST, lifetime_giving DESC
    LIMIT :limit OFFSET :offset
  ` : `
    WITH ${filteredIdsCte},
    donor_fy_amounts AS (
      SELECT g.constituent_id,
             EXTRACT(YEAR FROM g.gift_date + INTERVAL '9 months')::int as fy,
             SUM(g.gift_amount) as fy_total
      FROM crm_gifts g
      WHERE g.tenant_id = :tenantId AND g.constituent_id IS NOT NULL
        AND g.constituent_id IN (SELECT constituent_id FROM filtered_ids)
      GROUP BY g.constituent_id, EXTRACT(YEAR FROM g.gift_date + INTERVAL '9 months')
    ),
    consecutive AS (
      SELECT constituent_id,
             COUNT(*) as run_length
      FROM (
        SELECT constituent_id, fy,
               fy - ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY fy) as grp
        FROM donor_fy_amounts
      ) sub
      GROUP BY constituent_id, grp
    ),
    max_consecutive AS (
      SELECT constituent_id, MAX(run_length) as consecutive_years
      FROM consecutive
      GROUP BY constituent_id
    ),
    trend AS (
      SELECT d.constituent_id,
             CASE
               WHEN COUNT(*) <= 1 THEN 'one-time'
               WHEN regr_slope(d.fy_total, d.fy) > 0.01 THEN 'increasing'
               WHEN regr_slope(d.fy_total, d.fy) < -0.01 THEN 'declining'
               ELSE 'stable'
             END as giving_trend
      FROM donor_fy_amounts d
      GROUP BY d.constituent_id
    )
    SELECT l.*,
           COALESCE(mc.consecutive_years, 1) as consecutive_years,
           COALESCE(t.giving_trend, 'one-time') as giving_trend
    FROM (SELECT * FROM lapsed ${filterWhere}) l
    LEFT JOIN max_consecutive mc ON l.constituent_id = mc.constituent_id
    LEFT JOIN trend t ON l.constituent_id = t.constituent_id
    ORDER BY last_year_giving DESC NULLS LAST, lifetime_giving DESC
    LIMIT :limit OFFSET :offset
  `;

  const topDonors = await sequelize.query(topDonorsQuery, {
    replacements: { ...allReplacements, limit, offset },
    ...QUERY_OPTS,
  });

  // Summary stats
  const lybunt = rows.find(r => r.category === 'LYBUNT') || { donor_count: 0, revenue_at_risk: 0, avg_gift: 0 };
  const sybunt = rows.find(r => r.category === 'SYBUNT') || { donor_count: 0, revenue_at_risk: 0, avg_gift: 0 };

  return {
    currentFY,
    priorFY: currentFY - 1,
    lybunt: {
      donorCount: Number(lybunt.donor_count),
      revenueAtRisk: Number(lybunt.revenue_at_risk || 0),
      avgGift: Number(lybunt.avg_gift || 0),
    },
    sybunt: {
      donorCount: Number(sybunt.donor_count),
      revenueAtRisk: Number(sybunt.revenue_at_risk || 0),
      avgGift: Number(sybunt.avg_gift || 0),
    },
    totalAtRisk: Number(lybunt.donor_count || 0) + Number(sybunt.donor_count || 0),
    totalRevenueAtRisk: Number(lybunt.revenue_at_risk || 0) + Number(sybunt.revenue_at_risk || 0),
    bands,
    topDonors,
    topDonorsTotal,
    topDonorsPage: page,
    topDonorsLimit: limit,
    topDonorsTotalPages: Math.ceil(topDonorsTotal / limit),
  };
}

// ---------------------------------------------------------------------------
// Donor Upgrade / Downgrade Tracking
// Compare each donor's giving in current FY vs prior FY and classify as
// Upgraded, Maintained, Downgraded, or Lapsed (gave last year, not this year)
// New donors (gave this year, not last year) are also tracked
// ---------------------------------------------------------------------------
async function getDonorUpgradeDowngrade(tenantId, currentFY, { page = 1, limit = 50, category } = {}) {
  if (!currentFY) return null;
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd   = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd  = `${currentFY - 1}-04-01`;

  // Summary by category
  const summary = await sequelize.query(`
    WITH cur AS (
      SELECT constituent_id,
             MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as donor_name,
             SUM(gift_amount) as current_total,
             COUNT(*) as current_gifts
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :curStart AND gift_date < :curEnd
      GROUP BY constituent_id
    ),
    prev AS (
      SELECT constituent_id,
             MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as donor_name,
             SUM(gift_amount) as prior_total,
             COUNT(*) as prior_gifts
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :prevStart AND gift_date < :prevEnd
      GROUP BY constituent_id
    ),
    classified AS (
      SELECT
        COALESCE(c.constituent_id, p.constituent_id) as constituent_id,
        COALESCE(c.donor_name, p.donor_name) as donor_name,
        COALESCE(c.current_total, 0) as current_total,
        COALESCE(c.current_gifts, 0) as current_gifts,
        COALESCE(p.prior_total, 0) as prior_total,
        COALESCE(p.prior_gifts, 0) as prior_gifts,
        CASE
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NULL THEN 'New'
          WHEN c.constituent_id IS NULL AND p.constituent_id IS NOT NULL THEN 'Lapsed'
          WHEN c.current_total > p.prior_total * 1.1 THEN 'Upgraded'
          WHEN c.current_total < p.prior_total * 0.9 THEN 'Downgraded'
          ELSE 'Maintained'
        END as category
      FROM cur c
      FULL OUTER JOIN prev p ON c.constituent_id = p.constituent_id
    )
    SELECT category,
           COUNT(*) as donor_count,
           SUM(current_total) as current_revenue,
           SUM(prior_total) as prior_revenue,
           SUM(current_total) - SUM(prior_total) as revenue_change,
           AVG(current_total) as avg_current,
           AVG(prior_total) as avg_prior
    FROM classified
    GROUP BY category
    ORDER BY category
  `, {
    replacements: { tenantId, curStart, curEnd, prevStart, prevEnd },
    ...QUERY_OPTS,
  });

  // Giving change distribution (histogram of % change)
  const distribution = await sequelize.query(`
    WITH cur AS (
      SELECT constituent_id, SUM(gift_amount) as current_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :curStart AND gift_date < :curEnd
      GROUP BY constituent_id
    ),
    prev AS (
      SELECT constituent_id, SUM(gift_amount) as prior_total
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :prevStart AND gift_date < :prevEnd
      GROUP BY constituent_id
    ),
    both AS (
      SELECT c.constituent_id,
             c.current_total,
             p.prior_total,
             CASE
               WHEN p.prior_total > 0 THEN ROUND(((c.current_total - p.prior_total) / p.prior_total * 100)::numeric, 0)
               ELSE NULL
             END as pct_change
      FROM cur c
      INNER JOIN prev p ON c.constituent_id = p.constituent_id
    )
    SELECT
      CASE
        WHEN pct_change <= -50 THEN 'Down 50%+'
        WHEN pct_change <= -25 THEN 'Down 25–50%'
        WHEN pct_change <= -10 THEN 'Down 10–25%'
        WHEN pct_change <= 10 THEN 'Stable (±10%)'
        WHEN pct_change <= 25 THEN 'Up 10–25%'
        WHEN pct_change <= 50 THEN 'Up 25–50%'
        ELSE 'Up 50%+'
      END as change_band,
      CASE
        WHEN pct_change <= -50 THEN 1
        WHEN pct_change <= -25 THEN 2
        WHEN pct_change <= -10 THEN 3
        WHEN pct_change <= 10 THEN 4
        WHEN pct_change <= 25 THEN 5
        WHEN pct_change <= 50 THEN 6
        ELSE 7
      END as band_order,
      COUNT(*) as donor_count,
      SUM(current_total - prior_total) as net_change
    FROM both
    WHERE pct_change IS NOT NULL
    GROUP BY change_band, band_order
    ORDER BY band_order
  `, {
    replacements: { tenantId, curStart, curEnd, prevStart, prevEnd },
    ...QUERY_OPTS,
  });

  // Top movers — biggest upgrades and downgrades (paginated)
  const classifiedCTE = `
    WITH cur AS (
      SELECT constituent_id,
             MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as donor_name,
             SUM(gift_amount) as current_total,
             COUNT(*) as current_gifts
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :curStart AND gift_date < :curEnd
      GROUP BY constituent_id
    ),
    prev AS (
      SELECT constituent_id,
             MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as donor_name,
             SUM(gift_amount) as prior_total,
             COUNT(*) as prior_gifts
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND gift_date >= :prevStart AND gift_date < :prevEnd
      GROUP BY constituent_id
    ),
    classified AS (
      SELECT
        COALESCE(c.constituent_id, p.constituent_id) as constituent_id,
        COALESCE(c.donor_name, p.donor_name) as donor_name,
        COALESCE(c.current_total, 0) as current_total,
        COALESCE(c.current_gifts, 0) as current_gifts,
        COALESCE(p.prior_total, 0) as prior_total,
        COALESCE(p.prior_gifts, 0) as prior_gifts,
        COALESCE(c.current_total, 0) - COALESCE(p.prior_total, 0) as dollar_change,
        CASE
          WHEN c.constituent_id IS NOT NULL AND p.constituent_id IS NULL THEN 'New'
          WHEN c.constituent_id IS NULL AND p.constituent_id IS NOT NULL THEN 'Lapsed'
          WHEN c.current_total > p.prior_total * 1.1 THEN 'Upgraded'
          WHEN c.current_total < p.prior_total * 0.9 THEN 'Downgraded'
          ELSE 'Maintained'
        END as category
      FROM cur c
      FULL OUTER JOIN prev p ON c.constituent_id = p.constituent_id
    )`;

  const categoryFilter = category ? ' WHERE category = :category' : '';
  const offset = (page - 1) * limit;
  const moverReplacements = { tenantId, curStart, curEnd, prevStart, prevEnd, ...(category ? { category } : {}) };

  const [[{ total: topMoversTotal }]] = await sequelize.query(
    `${classifiedCTE} SELECT COUNT(*) as total FROM classified${categoryFilter}`,
    { replacements: moverReplacements, ...QUERY_OPTS }
  );

  const topMovers = await sequelize.query(
    `${classifiedCTE} SELECT * FROM classified${categoryFilter} ORDER BY ABS(dollar_change) DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...moverReplacements, limit, offset }, ...QUERY_OPTS }
  );

  // Build result
  const catMap = {};
  summary.forEach(r => { catMap[r.category] = r; });
  const cats = ['Upgraded', 'Maintained', 'Downgraded', 'Lapsed', 'New'];
  const totalCurrentRev = summary.reduce((s, r) => s + Number(r.current_revenue || 0), 0);
  const totalPriorRev = summary.reduce((s, r) => s + Number(r.prior_revenue || 0), 0);

  return {
    currentFY,
    priorFY: currentFY - 1,
    categories: cats.map(cat => {
      const r = catMap[cat] || { donor_count: 0, current_revenue: 0, prior_revenue: 0, revenue_change: 0, avg_current: 0, avg_prior: 0 };
      return {
        category: cat,
        donorCount: Number(r.donor_count || 0),
        currentRevenue: Number(r.current_revenue || 0),
        priorRevenue: Number(r.prior_revenue || 0),
        revenueChange: Number(r.revenue_change || 0),
        avgCurrent: Number(r.avg_current || 0),
        avgPrior: Number(r.avg_prior || 0),
      };
    }),
    totalCurrentRevenue: totalCurrentRev,
    totalPriorRevenue: totalPriorRev,
    netChange: totalCurrentRev - totalPriorRev,
    distribution,
    topMovers,
    topMoversTotal: Number(topMoversTotal),
    topMoversPage: page,
    topMoversLimit: limit,
    topMoversTotalPages: Math.ceil(Number(topMoversTotal) / limit),
  };
}

// ---------------------------------------------------------------------------
// First-Time Donor Conversion Funnel
// Track how many first-time donors make a second gift, and how long it takes.
// National average is ~19% — this helps orgs measure and improve.
// ---------------------------------------------------------------------------
async function getFirstTimeDonorConversion(tenantId, dateRange, { page = 1, limit = 50 } = {}) {
  // If dateRange given, only look at donors whose first gift was in that FY
  const dw = dateRange ? ' AND first_gift_date >= :startDate AND first_gift_date < :endDate' : '';
  const offset = (page - 1) * limit;
  const repl = { tenantId, ...(dateRange ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : {}) };

  // Core funnel: first-time donors, how many converted, time to second gift
  const funnel = await sequelize.query(`
    WITH donor_gifts AS (
      SELECT constituent_id,
             MIN(gift_date) as first_gift_date,
             MIN(gift_amount) FILTER (WHERE rn = 1) as first_gift_amount,
             MIN(gift_date) FILTER (WHERE rn = 2) as second_gift_date,
             MIN(gift_amount) FILTER (WHERE rn = 2) as second_gift_amount,
             COUNT(*) as total_gifts,
             SUM(gift_amount) as lifetime_total
      FROM (
        SELECT constituent_id, gift_date, gift_amount,
               ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      ) numbered
      GROUP BY constituent_id
    )
    SELECT
      COUNT(*) as total_first_time,
      COUNT(*) FILTER (WHERE second_gift_date IS NOT NULL) as converted,
      COUNT(*) FILTER (WHERE second_gift_date IS NULL) as not_converted,
      ROUND(AVG(EXTRACT(DAY FROM (second_gift_date::timestamp - first_gift_date::timestamp))) FILTER (WHERE second_gift_date IS NOT NULL)) as avg_days_to_second,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM (second_gift_date::timestamp - first_gift_date::timestamp))) FILTER (WHERE second_gift_date IS NOT NULL) as median_days_to_second,
      AVG(first_gift_amount) as avg_first_gift,
      AVG(first_gift_amount) FILTER (WHERE second_gift_date IS NOT NULL) as avg_first_gift_converted,
      AVG(first_gift_amount) FILTER (WHERE second_gift_date IS NULL) as avg_first_gift_not_converted,
      AVG(lifetime_total) FILTER (WHERE second_gift_date IS NOT NULL) as avg_lifetime_converted
    FROM donor_gifts
    WHERE true${dw}
  `, { replacements: repl, ...QUERY_OPTS });

  // Time-to-second-gift distribution
  const timeBands = await sequelize.query(`
    WITH donor_gifts AS (
      SELECT constituent_id,
             MIN(gift_date) as first_gift_date,
             MIN(gift_date) FILTER (WHERE rn = 2) as second_gift_date
      FROM (
        SELECT constituent_id, gift_date,
               ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      ) numbered
      GROUP BY constituent_id
    ),
    with_days AS (
      SELECT constituent_id,
             first_gift_date,
             EXTRACT(DAY FROM (second_gift_date::timestamp - first_gift_date::timestamp)) as days_gap
      FROM donor_gifts
      WHERE second_gift_date IS NOT NULL${dw}
    )
    SELECT
      CASE
        WHEN days_gap <= 30 THEN '0–30 days'
        WHEN days_gap <= 90 THEN '31–90 days'
        WHEN days_gap <= 180 THEN '91–180 days'
        WHEN days_gap <= 365 THEN '181–365 days'
        ELSE '365+ days'
      END as time_band,
      CASE
        WHEN days_gap <= 30 THEN 1
        WHEN days_gap <= 90 THEN 2
        WHEN days_gap <= 180 THEN 3
        WHEN days_gap <= 365 THEN 4
        ELSE 5
      END as band_order,
      COUNT(*) as donor_count
    FROM with_days
    GROUP BY time_band, band_order
    ORDER BY band_order
  `, { replacements: repl, ...QUERY_OPTS });

  // Conversion by first-gift size band
  const byGiftSize = await sequelize.query(`
    WITH donor_gifts AS (
      SELECT constituent_id,
             MIN(gift_date) as first_gift_date,
             MIN(gift_amount) FILTER (WHERE rn = 1) as first_gift_amount,
             MIN(gift_date) FILTER (WHERE rn = 2) as second_gift_date
      FROM (
        SELECT constituent_id, gift_date, gift_amount,
               ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      ) numbered
      GROUP BY constituent_id
    )
    SELECT
      CASE
        WHEN first_gift_amount < 50 THEN 'Under $50'
        WHEN first_gift_amount < 100 THEN '$50–$99'
        WHEN first_gift_amount < 250 THEN '$100–$249'
        WHEN first_gift_amount < 500 THEN '$250–$499'
        WHEN first_gift_amount < 1000 THEN '$500–$999'
        ELSE '$1,000+'
      END as gift_band,
      CASE
        WHEN first_gift_amount < 50 THEN 1
        WHEN first_gift_amount < 100 THEN 2
        WHEN first_gift_amount < 250 THEN 3
        WHEN first_gift_amount < 500 THEN 4
        WHEN first_gift_amount < 1000 THEN 5
        ELSE 6
      END as band_order,
      COUNT(*) as total_donors,
      COUNT(*) FILTER (WHERE second_gift_date IS NOT NULL) as converted,
      ROUND(COUNT(*) FILTER (WHERE second_gift_date IS NOT NULL)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as conversion_rate
    FROM donor_gifts
    WHERE true${dw}
    GROUP BY gift_band, band_order
    ORDER BY band_order
  `, { replacements: repl, ...QUERY_OPTS });

  // Unconverted donors (for outreach list) — first-timers who haven't made gift #2
  const unconvertedCountResult = await sequelize.query(`
    WITH donor_gifts AS (
      SELECT constituent_id,
             MIN(gift_date) as first_gift_date,
             COUNT(*) as total_gifts
      FROM (
        SELECT constituent_id, gift_date,
               ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      ) numbered
      GROUP BY constituent_id
      HAVING COUNT(*) = 1
    )
    SELECT COUNT(*) as total
    FROM donor_gifts
    WHERE true${dw}
  `, { replacements: repl, ...QUERY_OPTS });

  const unconvertedTotal = Number((unconvertedCountResult[0] || {}).total || 0);

  const unconverted = await sequelize.query(`
    WITH donor_gifts AS (
      SELECT constituent_id,
             MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as donor_name,
             MIN(gift_date) as first_gift_date,
             MIN(gift_amount) FILTER (WHERE rn = 1) as first_gift_amount,
             COUNT(*) as total_gifts
      FROM (
        SELECT constituent_id, first_name, last_name, gift_date, gift_amount,
               ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
      ) numbered
      GROUP BY constituent_id
      HAVING COUNT(*) = 1
    )
    SELECT constituent_id, donor_name, first_gift_date, first_gift_amount,
           EXTRACT(DAY FROM (NOW() - first_gift_date::timestamp))::int as days_since
    FROM donor_gifts
    WHERE true${dw}
    ORDER BY first_gift_amount DESC
    LIMIT :pageLimit OFFSET :pageOffset
  `, { replacements: { ...repl, pageLimit: limit, pageOffset: offset }, ...QUERY_OPTS });

  const f = funnel[0] || {};
  const totalFirst = Number(f.total_first_time || 0);
  const converted = Number(f.converted || 0);
  const convRate = totalFirst > 0 ? (converted / totalFirst * 100).toFixed(1) : 0;

  return {
    totalFirstTime: totalFirst,
    converted,
    notConverted: Number(f.not_converted || 0),
    conversionRate: Number(convRate),
    avgDaysToSecond: Number(f.avg_days_to_second || 0),
    medianDaysToSecond: Number(f.median_days_to_second || 0),
    avgFirstGift: Number(f.avg_first_gift || 0),
    avgFirstGiftConverted: Number(f.avg_first_gift_converted || 0),
    avgFirstGiftNotConverted: Number(f.avg_first_gift_not_converted || 0),
    avgLifetimeConverted: Number(f.avg_lifetime_converted || 0),
    timeBands,
    byGiftSize,
    unconverted,
    unconvertedTotal,
    unconvertedPage: page,
    unconvertedLimit: limit,
    unconvertedTotalPages: Math.ceil(unconvertedTotal / limit),
    benchmark: 19.0, // national average first-time donor retention (FEP)
  };
}

// ---------------------------------------------------------------------------
// Anomaly Detection — auto-flag unusual patterns in gift data
// Uses statistical comparisons (month-over-month, std dev) to surface
// spikes, drops, unusual gifts, and fund/campaign anomalies
// ---------------------------------------------------------------------------
async function getAnomalyDetection(tenantId, dateRange) {
  const dw = dateWhere(dateRange);
  const repl = { tenantId, ...dateReplacements(dateRange) };
  const anomalies = [];

  try {
    // 1. Monthly giving anomalies — flag months that are >2 std devs from mean
    const monthlyRows = await sequelize.query(`
      WITH monthly AS (
        SELECT DATE_TRUNC('month', gift_date)::date as month,
               SUM(gift_amount) as total,
               COUNT(*) as gift_count,
               COUNT(DISTINCT constituent_id) as donor_count
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date IS NOT NULL${dw}
        GROUP BY DATE_TRUNC('month', gift_date)
        ORDER BY month
      ),
      stats AS (
        SELECT AVG(total) as mean_total, STDDEV(total) as std_total,
               AVG(gift_count) as mean_count, STDDEV(gift_count) as std_count
        FROM monthly
      )
      SELECT m.month, m.total, m.gift_count, m.donor_count,
             s.mean_total, s.std_total,
             CASE
               WHEN s.std_total > 0 THEN ROUND(((m.total - s.mean_total) / s.std_total)::numeric, 2)
               ELSE 0
             END as z_score
      FROM monthly m, stats s
      WHERE s.std_total > 0 AND ABS((m.total - s.mean_total) / s.std_total) > 1.5
      ORDER BY ABS((m.total - s.mean_total) / s.std_total) DESC
      LIMIT 10
    `, { replacements: repl, ...QUERY_OPTS });

    monthlyRows.forEach(r => {
      const z = Number(r.z_score);
      const isSpike = z > 0;
      anomalies.push({
        type: isSpike ? 'spike' : 'drop',
        severity: Math.abs(z) > 2.5 ? 'high' : 'medium',
        category: 'Monthly Giving',
        title: (isSpike ? 'Unusual spike' : 'Unusual drop') + ' in ' + r.month.toString().substring(0, 7),
        detail: '$' + Number(r.total).toLocaleString('en-US', {maximumFractionDigits:0}) +
          ' (' + (isSpike ? '+' : '') + ((Number(r.total) - Number(r.mean_total)) / Number(r.mean_total) * 100).toFixed(0) +
          '% vs avg $' + Number(r.mean_total).toLocaleString('en-US', {maximumFractionDigits:0}) + ')',
        metric: Number(r.total),
        zScore: z,
        month: r.month,
      });
    });
  } catch (e) { console.warn('[Anomaly] Monthly error:', e.message); }

  try {
    // 2. Unusually large individual gifts (>3 std devs above mean gift)
    const [giftStats] = await sequelize.query(`
      SELECT AVG(gift_amount) as mean, STDDEV(gift_amount) as std
      FROM crm_gifts WHERE tenant_id = :tenantId${dw}
    `, { replacements: repl, ...QUERY_OPTS });

    if (Number(giftStats.std) > 0) {
      const threshold = Number(giftStats.mean) + 3 * Number(giftStats.std);
      const bigGifts = await sequelize.query(`
        SELECT gift_id, CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as constituent_name, gift_amount, gift_date, fund_description
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_amount > :threshold${dw}
        ORDER BY gift_amount DESC LIMIT 10
      `, { replacements: { ...repl, threshold }, ...QUERY_OPTS });

      bigGifts.forEach(g => {
        anomalies.push({
          type: 'outlier',
          severity: Number(g.gift_amount) > threshold * 2 ? 'high' : 'medium',
          category: 'Outlier Gift',
          title: 'Exceptional gift: $' + Number(g.gift_amount).toLocaleString('en-US', {maximumFractionDigits:0}),
          detail: (g.constituent_name || 'Anonymous') + ' on ' + (g.gift_date ? g.gift_date.toString().substring(0,10) : '') +
            (g.fund_description ? ' to ' + g.fund_description : ''),
          metric: Number(g.gift_amount),
          constituentName: g.constituent_name,
        });
      });
    }
  } catch (e) { console.warn('[Anomaly] Gift outlier error:', e.message); }

  try {
    // 3. Fund anomalies — funds with sudden drop or spike vs their own average
    const fundAnomalies = await sequelize.query(`
      WITH recent AS (
        SELECT fund_description,
               SUM(CASE WHEN gift_date >= (CURRENT_DATE - INTERVAL '90 days') THEN gift_amount ELSE 0 END) as recent_total,
               SUM(CASE WHEN gift_date < (CURRENT_DATE - INTERVAL '90 days') THEN gift_amount ELSE 0 END) as older_total,
               COUNT(CASE WHEN gift_date >= (CURRENT_DATE - INTERVAL '90 days') THEN 1 END) as recent_gifts,
               COUNT(CASE WHEN gift_date < (CURRENT_DATE - INTERVAL '90 days') THEN 1 END) as older_gifts,
               MIN(gift_date) as earliest
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND fund_description IS NOT NULL${dw}
        GROUP BY fund_description
        HAVING COUNT(*) >= 10
      ),
      with_rate AS (
        SELECT *,
          CASE WHEN older_gifts > 0 THEN
            older_total / GREATEST(EXTRACT(DAYS FROM (CURRENT_DATE - INTERVAL '90 days' - earliest::timestamp)), 1) * 90
          ELSE 0 END as expected_90d
        FROM recent
        WHERE older_gifts >= 5
      )
      SELECT fund_description, recent_total, expected_90d, recent_gifts,
             CASE WHEN expected_90d > 0
               THEN ROUND(((recent_total - expected_90d) / expected_90d * 100)::numeric, 0)
               ELSE 0 END as pct_change
      FROM with_rate
      WHERE expected_90d > 0 AND ABS((recent_total - expected_90d) / expected_90d) > 0.5
      ORDER BY ABS(recent_total - expected_90d) DESC
      LIMIT 8
    `, { replacements: repl, ...QUERY_OPTS });

    fundAnomalies.forEach(f => {
      const pct = Number(f.pct_change);
      const isUp = pct > 0;
      anomalies.push({
        type: isUp ? 'fund_spike' : 'fund_drop',
        severity: Math.abs(pct) > 100 ? 'high' : 'medium',
        category: 'Fund Anomaly',
        title: f.fund_description + ': ' + (isUp ? '+' : '') + pct + '% in last 90 days',
        detail: '$' + Number(f.recent_total).toLocaleString('en-US', {maximumFractionDigits:0}) +
          ' actual vs $' + Number(f.expected_90d).toLocaleString('en-US', {maximumFractionDigits:0}) + ' expected',
        metric: Math.abs(pct),
        fundName: f.fund_description,
      });
    });
  } catch (e) { console.warn('[Anomaly] Fund error:', e.message); }

  try {
    // 4. Donor behavior anomalies — donors with sudden large increase or decrease
    const donorAnomalies = await sequelize.query(`
      WITH donor_yearly AS (
        SELECT constituent_id, MAX(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) as constituent_name,
               SUM(CASE WHEN gift_date >= (CURRENT_DATE - INTERVAL '365 days') THEN gift_amount ELSE 0 END) as recent_year,
               SUM(CASE WHEN gift_date < (CURRENT_DATE - INTERVAL '365 days')
                    AND gift_date >= (CURRENT_DATE - INTERVAL '730 days') THEN gift_amount ELSE 0 END) as prior_year
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL${dw}
        GROUP BY constituent_id
        HAVING SUM(CASE WHEN gift_date < (CURRENT_DATE - INTERVAL '365 days')
                    AND gift_date >= (CURRENT_DATE - INTERVAL '730 days') THEN gift_amount ELSE 0 END) >= 100
      )
      SELECT constituent_id, constituent_name, recent_year, prior_year,
             ROUND(((recent_year - prior_year) / prior_year * 100)::numeric, 0) as pct_change,
             recent_year - prior_year as dollar_change
      FROM donor_yearly
      WHERE ABS((recent_year - prior_year) / prior_year) > 2
      ORDER BY ABS(recent_year - prior_year) DESC
      LIMIT 10
    `, { replacements: repl, ...QUERY_OPTS });

    donorAnomalies.forEach(d => {
      const pct = Number(d.pct_change);
      const isUp = pct > 0;
      anomalies.push({
        type: isUp ? 'donor_surge' : 'donor_decline',
        severity: Math.abs(pct) > 500 ? 'high' : 'medium',
        category: 'Donor Behavior',
        title: (d.constituent_name || 'Donor') + ': ' + (isUp ? '+' : '') + pct + '% change',
        detail: '$' + Number(d.recent_year).toLocaleString('en-US', {maximumFractionDigits:0}) +
          ' recent year vs $' + Number(d.prior_year).toLocaleString('en-US', {maximumFractionDigits:0}) + ' prior year' +
          ' (' + (isUp ? '+' : '') + '$' + Number(d.dollar_change).toLocaleString('en-US', {maximumFractionDigits:0}) + ')',
        metric: Math.abs(Number(d.dollar_change)),
        constituentId: d.constituent_id,
        constituentName: d.constituent_name,
      });
    });
  } catch (e) { console.warn('[Anomaly] Donor error:', e.message); }

  try {
    // 5. Seasonality anomaly — is current quarter tracking differently than same quarter last year?
    const [seasonal] = await sequelize.query(`
      WITH quarterly AS (
        SELECT
          EXTRACT(QUARTER FROM gift_date) as q,
          EXTRACT(YEAR FROM gift_date) as y,
          SUM(gift_amount) as total,
          COUNT(*) as cnt
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= (CURRENT_DATE - INTERVAL '2 years')
        GROUP BY q, y
      ),
      current_q AS (
        SELECT q, y, total, cnt FROM quarterly
        WHERE y = EXTRACT(YEAR FROM CURRENT_DATE) AND q = EXTRACT(QUARTER FROM CURRENT_DATE)
      ),
      same_q_last_year AS (
        SELECT q, y, total, cnt FROM quarterly
        WHERE y = EXTRACT(YEAR FROM CURRENT_DATE) - 1 AND q = EXTRACT(QUARTER FROM CURRENT_DATE)
      )
      SELECT c.total as current_total, c.cnt as current_cnt,
             l.total as last_year_total, l.cnt as last_year_cnt,
             c.q as quarter
      FROM current_q c, same_q_last_year l
    `, { replacements: { tenantId }, ...QUERY_OPTS });

    if (seasonal && seasonal.last_year_total && Number(seasonal.last_year_total) > 0) {
      const pct = ((Number(seasonal.current_total) - Number(seasonal.last_year_total)) / Number(seasonal.last_year_total) * 100).toFixed(0);
      if (Math.abs(pct) > 20) {
        const isUp = Number(pct) > 0;
        anomalies.push({
          type: isUp ? 'seasonal_up' : 'seasonal_down',
          severity: Math.abs(pct) > 50 ? 'high' : 'medium',
          category: 'Seasonal Trend',
          title: 'Q' + seasonal.quarter + ' is ' + (isUp ? 'up' : 'down') + ' ' + Math.abs(pct) + '% vs same quarter last year',
          detail: '$' + Number(seasonal.current_total).toLocaleString('en-US', {maximumFractionDigits:0}) +
            ' vs $' + Number(seasonal.last_year_total).toLocaleString('en-US', {maximumFractionDigits:0}) + ' last year',
          metric: Math.abs(Number(pct)),
        });
      }
    }
  } catch (e) { console.warn('[Anomaly] Seasonal error:', e.message); }

  // Sort by severity then metric
  const sevOrder = { high: 0, medium: 1, low: 2 };
  anomalies.sort((a, b) => (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2) || b.metric - a.metric);

  return {
    anomalies,
    totalAnomalies: anomalies.length,
    highSeverity: anomalies.filter(a => a.severity === 'high').length,
    mediumSeverity: anomalies.filter(a => a.severity === 'medium').length,
    categories: [...new Set(anomalies.map(a => a.category))],
  };
}

// ---------------------------------------------------------------------------
// AI-Powered Recommendations — actionable next-step suggestions
// Based on current data patterns, generates prioritized actions
// ---------------------------------------------------------------------------
async function getAIRecommendations(tenantId, currentFY) {
  if (!currentFY) return [];
  const curStart = `${currentFY - 1}-04-01`;
  const curEnd   = `${currentFY}-04-01`;
  const prevStart = `${currentFY - 2}-04-01`;
  const prevEnd  = `${currentFY - 1}-04-01`;
  const recs = [];

  try {
    // 1. Thank-you recommendation: recent first-time donors needing acknowledgment
    const [recentFirst] = await sequelize.query(`
      WITH first_gift AS (
        SELECT constituent_id, MIN(gift_date) as first_date, MIN(gift_amount) FILTER (WHERE rn = 1) as amount
        FROM (
          SELECT constituent_id, gift_date, gift_amount,
                 ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY gift_date, id) as rn
          FROM crm_gifts WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        ) n GROUP BY constituent_id
        HAVING MIN(gift_date) >= (CURRENT_DATE - INTERVAL '30 days')
      )
      SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
      FROM first_gift
    `, { replacements: { tenantId }, ...QUERY_OPTS });

    if (Number(recentFirst.cnt) > 0) {
      recs.push({
        priority: 'high',
        icon: 'bi-envelope-heart',
        action: 'Send thank-you notes to ' + recentFirst.cnt + ' new first-time donors',
        reason: '$' + Number(recentFirst.total).toLocaleString('en-US', {maximumFractionDigits:0}) + ' in first gifts in the last 30 days. Prompt thank-yous within 48 hours increase retention by up to 50%.',
        link: '/crm/first-time-donors',
        category: 'Stewardship',
      });
    }
  } catch (e) { /* skip */ }

  try {
    // 2. Lapsed donor re-engagement
    const [lapsed] = await sequelize.query(`
      WITH cur AS (
        SELECT DISTINCT constituent_id FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
      ),
      prev AS (
        SELECT constituent_id, SUM(gift_amount) as total
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
        HAVING SUM(gift_amount) >= 1000
      )
      SELECT COUNT(*) as cnt, COALESCE(SUM(p.total), 0) as revenue
      FROM prev p LEFT JOIN cur c ON p.constituent_id = c.constituent_id
      WHERE c.constituent_id IS NULL
    `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

    if (Number(lapsed.cnt) > 0) {
      recs.push({
        priority: 'high',
        icon: 'bi-telephone',
        action: 'Re-engage ' + lapsed.cnt + ' lapsed major donors ($1K+)',
        reason: '$' + Number(lapsed.revenue).toLocaleString('en-US', {maximumFractionDigits:0}) + ' in prior-year giving from donors who haven\'t renewed. Personal calls to lapsed major donors recover 15-25% of revenue.',
        link: '/crm/lybunt-sybunt?fy=' + currentFY,
        category: 'Re-engagement',
      });
    }
  } catch (e) { /* skip */ }

  try {
    // 3. Upgrade candidates — donors who increased giving in last 2 years
    const [upgradeable] = await sequelize.query(`
      WITH cur AS (
        SELECT constituent_id, SUM(gift_amount) as total FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :curStart AND gift_date < :curEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
      ),
      prev AS (
        SELECT constituent_id, SUM(gift_amount) as total FROM crm_gifts
        WHERE tenant_id = :tenantId AND gift_date >= :prevStart AND gift_date < :prevEnd AND constituent_id IS NOT NULL
        GROUP BY constituent_id
      )
      SELECT COUNT(*) as cnt
      FROM cur c JOIN prev p ON c.constituent_id = p.constituent_id
      WHERE c.total > p.total * 1.25 AND c.total BETWEEN 250 AND 5000
    `, { replacements: { tenantId, curStart, curEnd, prevStart, prevEnd }, ...QUERY_OPTS });

    if (Number(upgradeable.cnt) > 0) {
      recs.push({
        priority: 'medium',
        icon: 'bi-arrow-up-circle',
        action: 'Consider upgrade asks for ' + upgradeable.cnt + ' growing mid-level donors',
        reason: 'These donors increased giving by 25%+ and are in the $250-$5K range — prime candidates for a higher ask in the next appeal.',
        link: '/crm/donor-upgrade-downgrade?fy=' + currentFY,
        category: 'Upgrade',
      });
    }
  } catch (e) { /* skip */ }

  try {
    // 4. Recurring donor opportunity — frequent givers who aren't on recurring
    const [frequentNonRecurring] = await sequelize.query(`
      SELECT COUNT(*) as cnt FROM (
        SELECT constituent_id
        FROM crm_gifts
        WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
          AND gift_date >= (CURRENT_DATE - INTERVAL '2 years')
          AND (LOWER(gift_type) NOT LIKE '%recur%' OR gift_type IS NULL)
        GROUP BY constituent_id
        HAVING COUNT(*) >= 4
      ) freq
    `, { replacements: { tenantId }, ...QUERY_OPTS });

    if (Number(frequentNonRecurring.cnt) > 0) {
      recs.push({
        priority: 'medium',
        icon: 'bi-arrow-repeat',
        action: 'Convert ' + frequentNonRecurring.cnt + ' frequent donors to recurring giving',
        reason: 'These donors gave 4+ times in 2 years but aren\'t on a recurring schedule. Recurring donors have 90%+ retention vs ~45% for one-time donors.',
        link: '/crm/recurring-donors',
        category: 'Recurring',
      });
    }
  } catch (e) { /* skip */ }

  try {
    // 5. Year-end push recommendation
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    if (month >= 10 || month <= 1) {
      const [yearEnd] = await sequelize.query(`
        SELECT COUNT(DISTINCT constituent_id) as donors,
               COALESCE(SUM(gift_amount), 0) as total
        FROM crm_gifts
        WHERE tenant_id = :tenantId
          AND EXTRACT(MONTH FROM gift_date) IN (11, 12)
          AND gift_date >= (CURRENT_DATE - INTERVAL '2 years')
      `, { replacements: { tenantId }, ...QUERY_OPTS });

      if (Number(yearEnd.donors) > 0) {
        recs.push({
          priority: 'high',
          icon: 'bi-calendar-event',
          action: 'Launch year-end appeal to ' + yearEnd.donors + ' Nov/Dec donors',
          reason: 'These donors historically give in Nov-Dec. $' + Number(yearEnd.total).toLocaleString('en-US', {maximumFractionDigits:0}) + ' was raised in this window over the past 2 years. 30% of annual giving happens in December.',
          link: '/crm/gifts',
          category: 'Seasonal',
        });
      }
    }
  } catch (e) { /* skip */ }

  try {
    // 6. Data quality action
    const [missingEmail] = await sequelize.query(`
      SELECT COUNT(DISTINCT constituent_id) as cnt
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id IS NOT NULL
        AND (constituent_email IS NULL OR constituent_email = '')
        AND gift_amount >= 100
    `, { replacements: { tenantId }, ...QUERY_OPTS });

    if (Number(missingEmail.cnt) > 20) {
      recs.push({
        priority: 'low',
        icon: 'bi-shield-check',
        action: 'Update emails for ' + missingEmail.cnt + ' donors giving $100+',
        reason: 'These donors have no email on file. Email is the most cost-effective channel for stewardship and appeals.',
        link: '/crm/data-quality',
        category: 'Data Quality',
      });
    }
  } catch (e) { /* skip */ }

  // Sort by priority
  const pOrder = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => pOrder[a.priority] - pOrder[b.priority]);

  return recs;
}

module.exports = {
  getCrmOverview: cached('overview', getCrmOverview),
  getGivingByMonth: cached('givingByMonth', getGivingByMonth),
  getTopDonors: cached('topDonors', getTopDonors),
  getTopFunds: cached('topFunds', getTopFunds),
  getTopCampaigns: cached('topCampaigns', getTopCampaigns),
  getTopAppeals: cached('topAppeals', getTopAppeals),
  getGiftsByType: cached('giftsByType', getGiftsByType),
  getFundraiserLeaderboard: cached('leaderboard', getFundraiserLeaderboard),
  getFundraiserPortfolio: cached('portfolio', getFundraiserPortfolio),
  getFiscalYears: cached('fiscalYears', getFiscalYears),
  getDonorRetention: cached('retention', getDonorRetention),
  getGivingPyramid: cached('pyramid', getGivingPyramid),
  getDonorDetail: cached('donorDetail', getDonorDetail),
  searchGifts,
  getFilterOptions: cached('filterOptions', getFilterOptions),
  getEntityDetail: cached('entityDetail', getEntityDetail),
  getDonorScoring: cached('scoring', getDonorScoring),
  getFundraiserGoals,
  setFundraiserGoal,
  deleteFundraiserGoal,
  getDepartmentGoals,
  setDepartmentGoal,
  deleteDepartmentGoal,
  getDepartmentActuals: cached('deptActuals', getDepartmentActuals),
  getDataQualityReport: cached('dataQuality', getDataQualityReport),
  getRecurringDonorAnalysis: cached('recurring', getRecurringDonorAnalysis),
  getAcknowledgmentTracker: cached('acknowledgments', getAcknowledgmentTracker),
  getMatchingGiftAnalysis: cached('matchingGifts', getMatchingGiftAnalysis),
  getSoftCreditAnalysis: cached('softCredits', getSoftCreditAnalysis),
  getPaymentMethodAnalysis: cached('paymentMethods', getPaymentMethodAnalysis),
  getDonorLifecycleAnalysis: cached('donorLifecycle', getDonorLifecycleAnalysis),
  getGiftTrendAnalysis: cached('giftTrends', getGiftTrendAnalysis),
  getCampaignComparison: cached('campaignCompare', getCampaignComparison),
  getFundHealthReport: cached('fundHealth', getFundHealthReport),
  getYearOverYearComparison: cached('yoyCompare', getYearOverYearComparison),
  getDonorInsights: cached('donorInsights', getDonorInsights),
  getAppealComparison: cached('appealCompare', getAppealComparison),
  getAppealDetail: cached('appealDetail', getAppealDetail),
  getDepartmentAnalytics: cached('deptAnalytics', getDepartmentAnalytics),
  getDepartmentExtras: cached('deptExtras', getDepartmentExtras),
  getLybuntSybunt: cached('lybuntSybunt', getLybuntSybunt),
  getDonorUpgradeDowngrade: cached('donorUpDown', getDonorUpgradeDowngrade),
  getFirstTimeDonorConversion: cached('firstTimeDonor', getFirstTimeDonorConversion),
  getProactiveInsights: cached('proactiveInsights', getProactiveInsights),
  getRetentionDrilldown: cached('retentionDrilldown', getRetentionDrilldown),
  getHouseholdGiving: cached('householdGiving', getHouseholdGiving),
  getAnomalyDetection: cached('anomalyDetection', getAnomalyDetection),
  getAIRecommendations: cached('aiRecommendations', getAIRecommendations),
  clearCrmCache,
};
