/**
 * CRM Dashboard Service
 *
 * Provides pre-computed analytics from the CRM gift tables
 * for the CRM dashboard and fundraiser performance pages.
 * Results are cached for 10 minutes to avoid repeated heavy queries.
 */
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

// Simple in-memory cache: key → { data, expiry }
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function cached(key, fn) {
  return async (...args) => {
    const cacheKey = `${key}:${args.join(':')}`;
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
    if (key.includes(`:${tenantId}`)) cache.delete(key);
  }
}

async function getCrmOverview(tenantId) {
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
    FROM crm_gifts WHERE tenant_id = :tenantId
  `, { replacements: { tenantId }, type: QueryTypes.SELECT });
  return overview;
}

async function getGivingByMonth(tenantId, limit = 24) {
  return sequelize.query(`
    SELECT
      TO_CHAR(gift_date, 'YYYY-MM') as month,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND gift_date IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, type: QueryTypes.SELECT });
}

async function getTopDonors(tenantId, limit = 15) {
  return sequelize.query(`
    SELECT
      first_name, last_name, constituent_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total,
      MAX(gift_date) as last_gift_date
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND last_name IS NOT NULL
    GROUP BY first_name, last_name, constituent_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, type: QueryTypes.SELECT });
}

async function getTopFunds(tenantId, limit = 10) {
  return sequelize.query(`
    SELECT
      fund_description, fund_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND fund_description IS NOT NULL
    GROUP BY fund_description, fund_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, type: QueryTypes.SELECT });
}

async function getTopCampaigns(tenantId, limit = 10) {
  return sequelize.query(`
    SELECT
      campaign_description, campaign_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL
    GROUP BY campaign_description, campaign_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, type: QueryTypes.SELECT });
}

async function getTopAppeals(tenantId, limit = 10) {
  return sequelize.query(`
    SELECT
      appeal_description, appeal_id,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND appeal_description IS NOT NULL
    GROUP BY appeal_description, appeal_id
    ORDER BY total DESC LIMIT :limit
  `, { replacements: { tenantId, limit }, type: QueryTypes.SELECT });
}

async function getGiftsByType(tenantId) {
  return sequelize.query(`
    SELECT
      COALESCE(gift_code, 'Unknown') as gift_type,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId
    GROUP BY gift_type ORDER BY total DESC LIMIT 15
  `, { replacements: { tenantId }, type: QueryTypes.SELECT });
}

// ---------------------------------------------------------------------------
// Fundraiser Performance
// ---------------------------------------------------------------------------

async function getFundraiserLeaderboard(tenantId) {
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
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name IS NOT NULL
    GROUP BY f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
    ORDER BY total_credited DESC
  `, { replacements: { tenantId }, type: QueryTypes.SELECT });
}

async function getFundraiserPortfolio(tenantId, fundraiserName) {
  // Top donors for this fundraiser
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
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName
    GROUP BY g.first_name, g.last_name, g.constituent_id
    ORDER BY total_credited DESC LIMIT 50
  `, { replacements: { tenantId, fundraiserName }, type: QueryTypes.SELECT });

  // Giving by fund
  const byFund = await sequelize.query(`
    SELECT
      g.fund_description,
      COUNT(*) as gift_count,
      SUM(f.fundraiser_amount) as total
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName
    GROUP BY g.fund_description ORDER BY total DESC LIMIT 10
  `, { replacements: { tenantId, fundraiserName }, type: QueryTypes.SELECT });

  // Giving by month
  const byMonth = await sequelize.query(`
    SELECT
      TO_CHAR(g.gift_date, 'YYYY-MM') as month,
      COUNT(*) as gift_count,
      SUM(f.fundraiser_amount) as total
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName AND g.gift_date IS NOT NULL
    GROUP BY month ORDER BY month DESC LIMIT 24
  `, { replacements: { tenantId, fundraiserName }, type: QueryTypes.SELECT });

  // Summary stats
  const [summary] = await sequelize.query(`
    SELECT
      COUNT(DISTINCT f.gift_id) as total_gifts,
      COUNT(DISTINCT g.constituent_id) as total_donors,
      SUM(f.fundraiser_amount) as total_credited,
      SUM(g.gift_amount) as total_gift_amount,
      AVG(f.fundraiser_amount) as avg_gift
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    WHERE f.tenant_id = :tenantId AND f.fundraiser_name = :fundraiserName
  `, { replacements: { tenantId, fundraiserName }, type: QueryTypes.SELECT });

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
  clearCrmCache,
};
