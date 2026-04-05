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

  return { summary, unacknowledged, byStatus };
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
  clearCrmCache,
};
