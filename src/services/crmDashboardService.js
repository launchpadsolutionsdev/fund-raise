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

// ---------------------------------------------------------------------------
// Discover which fiscal years exist in the data (April 1 – March 31)
// FY2025 = April 1 2024 – March 31 2025
// ---------------------------------------------------------------------------
async function getFiscalYears(tenantId) {
  const rows = await sequelize.query(`
    SELECT
      CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
           THEN EXTRACT(YEAR FROM gift_date) + 1
           ELSE EXTRACT(YEAR FROM gift_date)
      END AS fy,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
    GROUP BY fy ORDER BY fy DESC
  `, { replacements: { tenantId }, type: QueryTypes.SELECT });
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
  const [overview] = await sequelize.query(`
    SELECT
      COUNT(*) as total_gifts,
      COALESCE(SUM(gift_amount), 0) as total_raised,
      COALESCE(AVG(gift_amount), 0) as avg_gift,
      COALESCE(MAX(gift_amount), 0) as largest_gift,
      MIN(gift_date) as earliest_date,
      MAX(gift_date) as latest_date,
      COUNT(DISTINCT constituent_id) as unique_donors,
      COUNT(DISTINCT fund_id) as unique_funds,
      COUNT(DISTINCT campaign_id) as unique_campaigns,
      COUNT(DISTINCT appeal_id) as unique_appeals
    FROM crm_gifts WHERE tenant_id = :tenantId${dateWhere(dateRange)}
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
  return overview;
}

async function getGivingByMonth(tenantId, dateRange, limit = 24) {
  return sequelize.query(`
    SELECT
      TO_CHAR(gift_date, 'YYYY-MM') as month,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL${dateWhere(dateRange)}
    GROUP BY month ORDER BY month DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getTopDonors(tenantId, dateRange, limit = 15) {
  return sequelize.query(`
    SELECT
      first_name, last_name, constituent_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total,
      MAX(gift_date) as last_gift_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND last_name IS NOT NULL${dateWhere(dateRange)}
    GROUP BY first_name, last_name, constituent_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getTopFunds(tenantId, dateRange, limit = 10) {
  return sequelize.query(`
    SELECT
      fund_description, fund_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND fund_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY fund_description, fund_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getTopCampaigns(tenantId, dateRange, limit = 10) {
  return sequelize.query(`
    SELECT
      campaign_description, campaign_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY campaign_description, campaign_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getTopAppeals(tenantId, dateRange, limit = 10) {
  return sequelize.query(`
    SELECT
      appeal_description, appeal_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_description IS NOT NULL${dateWhere(dateRange)}
    GROUP BY appeal_description, appeal_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getGiftsByType(tenantId, dateRange) {
  return sequelize.query(`
    SELECT
      COALESCE(gift_code, 'Unknown') as gift_type,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId${dateWhere(dateRange)}
    GROUP BY gift_type ORDER BY total DESC LIMIT 15
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

// ---------------------------------------------------------------------------
// Fundraiser Performance — all accept optional dateRange
// ---------------------------------------------------------------------------

async function getFundraiserLeaderboard(tenantId, dateRange) {
  return sequelize.query(`
    SELECT
      f.fundraiser_name,
      f.fundraiser_first_name,
      f.fundraiser_last_name,
      COUNT(DISTINCT f.gift_id) as gift_count,
      COUNT(DISTINCT g.constituent_id) as donor_count,
      SUM(f.fundraiser_amount) as total_credited,
      SUM(g.gift_amount) as total_gift_amount,
      MIN(g.gift_date) as earliest_gift,
      MAX(g.gift_date) as latest_gift
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name IS NOT NULL${dateWhere(dateRange, 'g')}
    GROUP BY f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
    ORDER BY total_credited DESC
  `, { replacements: { tenantId, ...dateReplacements(dateRange) }, type: QueryTypes.SELECT });
}

async function getFundraiserPortfolio(tenantId, fundraiserName, dateRange) {
  const dr = dateReplacements(dateRange);
  const dw = dateWhere(dateRange, 'g');

  const donors = await sequelize.query(`
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
  `, { replacements: { tenantId, fundraiserName, ...dr }, type: QueryTypes.SELECT });

  const byFund = await sequelize.query(`
    SELECT
      g.fund_description,
      COUNT(*) as gift_count,
      SUM(f.fundraiser_amount) as total
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName${dw}
    GROUP BY g.fund_description ORDER BY total DESC LIMIT 10
  `, { replacements: { tenantId, fundraiserName, ...dr }, type: QueryTypes.SELECT });

  const byMonth = await sequelize.query(`
    SELECT
      TO_CHAR(g.gift_date, 'YYYY-MM') as month,
      COUNT(*) as gift_count,
      SUM(f.fundraiser_amount) as total
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName AND g.gift_date IS NOT NULL${dw}
    GROUP BY month ORDER BY month DESC LIMIT 24
  `, { replacements: { tenantId, fundraiserName, ...dr }, type: QueryTypes.SELECT });

  const [summary] = await sequelize.query(`
    SELECT
      COUNT(DISTINCT f.gift_id) as total_gifts,
      COUNT(DISTINCT g.constituent_id) as total_donors,
      SUM(f.fundraiser_amount) as total_credited,
      SUM(g.gift_amount) as total_gift_amount,
      AVG(f.fundraiser_amount) as avg_gift
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName${dw}
  `, { replacements: { tenantId, fundraiserName, ...dr }, type: QueryTypes.SELECT });

  return { summary, donors, byFund, byMonth };
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
  getFundraiserPortfolio,
  getFiscalYears: cached('fiscalYears', getFiscalYears),
  clearCrmCache,
};
