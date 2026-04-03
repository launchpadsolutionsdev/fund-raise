/**
 * Blackbaud Live Data Service
 *
 * Fetches and shapes data from Blackbaud SKY API for the live dashboard.
 */

const blackbaud = require('./blackbaudClient');

// ---------------------------------------------------------------------------
// In-memory cache for fund names (refreshed per dashboard load)
// ---------------------------------------------------------------------------
let fundCache = {};
let fundCacheExpiry = 0;

async function getFundMap(tenantId) {
  if (Date.now() < fundCacheExpiry && Object.keys(fundCache).length > 0) {
    return fundCache;
  }
  try {
    const funds = await blackbaud.apiRequestAll(tenantId, '/fundraising/v1/funds?limit=500', 'value', 5);
    const map = {};
    for (const f of funds) {
      map[f.id] = f.description || f.lookup_id || String(f.id);
    }
    fundCache = map;
    fundCacheExpiry = Date.now() + 10 * 60 * 1000; // cache 10 min
    return map;
  } catch (err) {
    console.error('[BB DATA] Fund map error:', err.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Dashboard summary — aggregates multiple API calls
// ---------------------------------------------------------------------------

async function getLiveDashboardData(tenantId) {
  // Fetch fund names first so gifts can use them
  const fundMap = await getFundMap(tenantId);

  const [
    recentGifts,
    giftSummary,
    constituentSummary,
    campaigns,
  ] = await Promise.all([
    getRecentGifts(tenantId, 500, fundMap),
    getGiftSummary(tenantId, fundMap),
    getConstituentSummary(tenantId),
    getCampaigns(tenantId),
  ]);

  return {
    recentGifts,
    giftSummary,
    constituentSummary,
    campaigns,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Recent gifts — paginate to get enough, then sort by date
// ---------------------------------------------------------------------------

async function getRecentGifts(tenantId, limit = 100, fundMap = {}) {
  try {
    const since = daysAgo(30);
    const data = await blackbaud.apiRequest(
      tenantId,
      `/gift/v1/gifts?limit=${Math.min(limit, 500)}&date_added>${since}`
    );

    const gifts = (data.value || []).map(g => mapGift(g, fundMap));
    gifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return { gifts, count: data.count || gifts.length };
  } catch (err) {
    console.error('[BB DATA] Recent gifts error:', err.message);
    return { gifts: [], count: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Gift summary — compute totals from all fetched gifts
// ---------------------------------------------------------------------------

async function getGiftSummary(tenantId, fundMap = {}) {
  try {
    // Fetch gifts from last 30 days only
    const since = daysAgo(30);
    const allGifts = await blackbaud.apiRequestAll(
      tenantId,
      `/gift/v1/gifts?limit=500&date_added>${since}`,
      'value',
      5
    );

    let totalAmount = 0;
    let largestGift = 0;
    let largestGiftDonor = '';
    const giftsByMonth = {};
    const giftsByType = {};
    const giftsByFund = {};

    for (const g of allGifts) {
      const amt = g.amount ? g.amount.value : 0;
      totalAmount += amt;

      if (amt > largestGift) {
        largestGift = amt;
        largestGiftDonor = g.lookup_id || '';
      }

      // Group by month
      if (g.date) {
        const month = g.date.substring(0, 7); // YYYY-MM
        giftsByMonth[month] = (giftsByMonth[month] || 0) + amt;
      }

      // Group by type
      const type = g.type || 'Other';
      if (!giftsByType[type]) giftsByType[type] = { count: 0, total: 0 };
      giftsByType[type].count++;
      giftsByType[type].total += amt;

      // Group by fund
      const fundId = extractFundId(g);
      if (fundId) {
        const fundName = fundMap[fundId] || `Fund ${fundId}`;
        if (!giftsByFund[fundName]) giftsByFund[fundName] = { count: 0, total: 0 };
        giftsByFund[fundName].count++;
        giftsByFund[fundName].total += amt;
      }
    }

    return {
      totalAmount,
      giftCount: allGifts.length,
      averageGift: allGifts.length > 0 ? totalAmount / allGifts.length : 0,
      largestGift,
      largestGiftDonor,
      giftsByMonth,
      giftsByType,
      giftsByFund,
    };
  } catch (err) {
    console.error('[BB DATA] Gift summary error:', err.message);
    return {
      totalAmount: 0, giftCount: 0, averageGift: 0,
      largestGift: 0, largestGiftDonor: '',
      giftsByMonth: {}, giftsByType: {},
      giftsByFund: {}, error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Constituent summary
// ---------------------------------------------------------------------------

async function getConstituentSummary(tenantId) {
  try {
    const data = await blackbaud.apiRequest(
      tenantId,
      '/constituent/v1/constituents?limit=1'
    );
    return { totalConstituents: data.count || 0 };
  } catch (err) {
    console.error('[BB DATA] Constituent summary error:', err.message);
    return { totalConstituents: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

async function getCampaigns(tenantId) {
  try {
    const data = await blackbaud.apiRequest(
      tenantId,
      '/fundraising/v1/campaigns?limit=100'
    );
    const campaigns = (data.value || []).map(c => ({
      id: c.id,
      description: c.description,
      lookupId: c.lookup_id,
      goal: c.goal ? c.goal.value : null,
      startDate: c.start_date,
      endDate: c.end_date,
      inactive: c.inactive || false,
    }));

    return {
      campaigns: campaigns.filter(c => !c.inactive),
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter(c => !c.inactive).length,
    };
  } catch (err) {
    console.error('[BB DATA] Campaigns error:', err.message);
    return { campaigns: [], totalCampaigns: 0, activeCampaigns: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function mapGift(g, fundMap) {
  const fundId = extractFundId(g);
  return {
    id: g.id,
    amount: g.amount ? g.amount.value : 0,
    date: g.date,
    type: g.type,
    constituentId: g.constituent_id,
    lookupId: g.lookup_id,
    fundName: fundId ? (fundMap[fundId] || `Fund ${fundId}`) : '',
  };
}

function extractFundId(gift) {
  if (gift.gift_splits && gift.gift_splits.length > 0) {
    return gift.gift_splits[0].fund_id || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getLiveDashboardData,
  getRecentGifts,
  getGiftSummary,
  getConstituentSummary,
  getCampaigns,
};
