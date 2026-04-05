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

// Options for heavy aggregate queries — longer timeout for large datasets
const QUERY_OPTS = { type: QueryTypes.SELECT, timeout: 60000 };

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
    FROM crm_gifts WHERE tenant_id = :tenantId AND last_name IS NOT NULL${dateWhere(dateRange)}
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

  const [donors, byFund, byMonth, summaryRows] = await Promise.all([
    sequelize.query(`
      SELECT
        g.first_name, g.last_name, g.constituent_id,
        COUNT(*) as gift_count,
        SUM(f.fundraiser_amount) as total_credited,
        SUM(g.gift_amount) as total_gift_amount,
        MIN(g.gift_date) as first_gift,
        MAX(g.gift_date) as last_gift
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName${dw}
      GROUP BY g.first_name, g.last_name, g.constituent_id
      ORDER BY total_credited DESC LIMIT 50
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT
        g.fund_description,
        COUNT(*) as gift_count,
        SUM(f.fundraiser_amount) as total
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName${dw}
      GROUP BY g.fund_description ORDER BY total DESC LIMIT 10
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT
        TO_CHAR(g.gift_date, 'YYYY-MM') as month,
        COUNT(*) as gift_count,
        SUM(f.fundraiser_amount) as total
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName AND g.gift_date IS NOT NULL${dw}
      GROUP BY month ORDER BY month DESC LIMIT 24
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT
        COUNT(DISTINCT f.gift_id) as total_gifts,
        COUNT(DISTINCT g.constituent_id) as total_donors,
        SUM(f.fundraiser_amount) as total_credited,
        SUM(g.gift_amount) as total_gift_amount,
        AVG(f.fundraiser_amount) as avg_gift
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName${dw}
    `, { replacements: repl, ...QUERY_OPTS }),
  ]);

  return { summary: summaryRows[0] || null, donors, byFund, byMonth };
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

  const [gifts, summaryRows, byYear, fundraiserRows] = await Promise.all([
    sequelize.query(`
      SELECT gift_id, gift_date, gift_amount, gift_code,
             fund_description, fund_id, campaign_description, campaign_id,
             appeal_description, appeal_id
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId
      ORDER BY gift_date DESC
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

    sequelize.query(`
      SELECT DISTINCT f.fundraiser_name
      FROM crm_gift_fundraisers f
      JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
      WHERE f.tenant_id = :tenantId AND g.constituent_id = :constituentId
        AND f.fundraiser_name IS NOT NULL
    `, { replacements: repl, ...QUERY_OPTS }),
  ]);

  return { summary: summaryRows[0] || null, gifts, byYear, fundraisers: fundraiserRows.map(f => f.fundraiser_name) };
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
async function getDonorScoring(tenantId, dateRange) {
  const rows = await sequelize.query(`
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
        -- Recency: 5=recent, 1=stale
        NTILE(5) OVER (ORDER BY days_since_last ASC) as recency_score,
        -- Frequency: 5=many gifts, 1=few
        NTILE(5) OVER (ORDER BY gift_count ASC) as frequency_score,
        -- Monetary: 5=big giver, 1=small
        NTILE(5) OVER (ORDER BY total_given ASC) as monetary_score
      FROM donor_stats
    )
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
    ORDER BY rfm_total DESC, total_given DESC
    LIMIT 200
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Compute segment summary counts
  const segmentCounts = {};
  rows.forEach(r => {
    if (!segmentCounts[r.segment]) segmentCounts[r.segment] = { count: 0, total: 0 };
    segmentCounts[r.segment].count++;
    segmentCounts[r.segment].total += Number(r.total_given);
  });

  return { donors: rows, segments: segmentCounts };
}

// ---------------------------------------------------------------------------
// 2. Fundraiser Goal Tracking
// ---------------------------------------------------------------------------
const { FundraiserGoal } = require('../models');

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
// 3. Recurring Donor Analysis
// ---------------------------------------------------------------------------
async function getRecurringDonorAnalysis(tenantId, dateRange) {
  // Analyze giving frequency per donor
  const rows = await sequelize.query(`
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
    )
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
    ORDER BY total_given DESC
    LIMIT 200
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

  // Pattern summary
  const patterns = {};
  rows.forEach(r => {
    if (!patterns[r.pattern]) patterns[r.pattern] = { count: 0, total: 0 };
    patterns[r.pattern].count++;
    patterns[r.pattern].total += Number(r.total_given);
  });

  return { donors: rows, patterns };
}

// ---------------------------------------------------------------------------
// 4. Acknowledgment Tracker
// ---------------------------------------------------------------------------
async function getAcknowledgmentTracker(tenantId, dateRange) {
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

  // Unacknowledged gifts (most recent first)
  const unacknowledged = await sequelize.query(`
    SELECT gift_id, gift_date, gift_amount, gift_code,
           first_name, last_name, constituent_id,
           fund_description, gift_acknowledge, gift_acknowledge_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId
      AND (gift_acknowledge IS NULL OR gift_acknowledge = '' OR LOWER(gift_acknowledge) = 'not acknowledged')${dateWhere(dateRange)}
    ORDER BY gift_amount DESC, gift_date DESC
    LIMIT 100
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, ...QUERY_OPTS });

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

  return { summary, unacknowledged, byStatus, byFund, avgDays: avgDays || { avg_days: null, min_days: null, max_days: null } };
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
    WHERE m.tenant_id = :tenantId AND g.last_name IS NOT NULL${dateWhere(dateRange, 'g')}
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
async function getGiftTrendAnalysis(tenantId, dateRange) {
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
  const donorTrends = await sequelize.query(`
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
    )
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
    ORDER BY ABS(a.avg_gift - b.avg_gift) DESC
    LIMIT 100
  `, { replacements: { tenantId }, ...QUERY_OPTS });

  const increasing = donorTrends.filter(d => d.trend === 'Increasing');
  const decreasing = donorTrends.filter(d => d.trend === 'Decreasing');

  return { monthlyTrend, distribution, yoyAvg, donorTrends, increasing, decreasing };
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
  clearCrmCache,
};
