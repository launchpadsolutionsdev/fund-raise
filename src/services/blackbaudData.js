/**
 * Blackbaud Live Data Service
 *
 * Fetches and shapes data from Blackbaud SKY API for the live dashboard.
 */

const blackbaud = require('./blackbaudClient');

// ---------------------------------------------------------------------------
// Caches — dashboard data refreshes once per hour, funds every 10 min
// ---------------------------------------------------------------------------
let dashboardCache = {};  // keyed by tenantId
let fundCache = {};
let fundCacheExpiry = 0;
const DASHBOARD_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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
  // Return cached data if less than 1 hour old
  const cached = dashboardCache[tenantId];
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }

  // Fetch fresh data from Blackbaud
  const fundMap = await getFundMap(tenantId);
  const giftData = await fetchRecentGiftsRaw(tenantId);

  const [constituentSummary, campaigns] = await Promise.all([
    getConstituentSummary(tenantId),
    getCampaigns(tenantId),
  ]);

  const mappedGifts = giftData.map(g => mapGift(g, fundMap));
  mappedGifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const result = {
    recentGifts: { gifts: mappedGifts.slice(0, 100), count: mappedGifts.length },
    giftSummary: computeGiftSummary(giftData, fundMap),
    constituentSummary,
    campaigns,
    fetchedAt: new Date().toISOString(),
    nextRefresh: new Date(Date.now() + DASHBOARD_CACHE_TTL).toISOString(),
  };

  // Cache the result
  dashboardCache[tenantId] = { data: result, expiry: Date.now() + DASHBOARD_CACHE_TTL };

  return result;
}

// ---------------------------------------------------------------------------
// Fetch gifts — tries search endpoint with date filter, falls back to list
// ---------------------------------------------------------------------------

async function fetchRecentGiftsRaw(tenantId) {
  const since = daysAgo(30);
  let allGifts = [];

  // Strategy 1: Try search endpoint with date filter
  try {
    const searchResult = await blackbaud.apiRequest(tenantId, '/gift/v1/gifts/search', {
      method: 'POST',
      body: {
        search_text: '',
        gift_date_range_filter: {
          gte: since,
        },
        limit: 500,
      },
    });
    allGifts = searchResult.value || [];
    console.log('[BB DATA] Search returned', allGifts.length, 'gifts');
  } catch (searchErr) {
    console.warn('[BB DATA] Gift search failed:', searchErr.message);
  }

  // Strategy 2: If search returned nothing useful, fetch from the END of the gift list
  // (gifts are stored oldest-first, so recent gifts are at high offsets)
  if (allGifts.filter(g => g.date && g.date >= since).length === 0) {
    console.log('[BB DATA] Search had no recent gifts, trying reverse offset strategy...');
    try {
      // First get the total count with a minimal call
      const countData = await blackbaud.apiRequest(tenantId, '/gift/v1/gifts?limit=1');
      const totalCount = countData.count || 0;

      if (totalCount > 0) {
        // Fetch the last 500 gifts (most recently added)
        const offset = Math.max(0, totalCount - 500);
        const recentData = await blackbaud.apiRequest(
          tenantId,
          `/gift/v1/gifts?limit=500&offset=${offset}`
        );
        allGifts = recentData.value || [];
        console.log('[BB DATA] Reverse offset returned', allGifts.length, 'gifts from offset', offset);

        // If those aren't recent enough, try one more batch
        if (allGifts.filter(g => g.date && g.date >= since).length === 0 && offset > 500) {
          const offset2 = Math.max(0, offset - 500);
          const batch2 = await blackbaud.apiRequest(
            tenantId,
            `/gift/v1/gifts?limit=500&offset=${offset2}`
          );
          allGifts = [...(batch2.value || []), ...allGifts];
          console.log('[BB DATA] Extended to offset', offset2, ', total', allGifts.length, 'gifts');
        }
      }
    } catch (err) {
      console.error('[BB DATA] Reverse offset strategy failed:', err.message);
    }
  }

  // Always filter to last 30 days
  const filtered = allGifts.filter(g => g.date && g.date >= since);
  console.log('[BB DATA] After 30-day filter:', filtered.length, 'gifts (since', since, ')');
  return filtered;
}

// ---------------------------------------------------------------------------
// Gift summary — compute totals from fetched gifts
// ---------------------------------------------------------------------------

function computeGiftSummary(allGifts, fundMap = {}) {
    let totalAmount = 0;
    let largestGift = 0;
    let largestGiftDonor = '';
    const giftsByDay = {};
    const giftsByFund = {};

    for (const g of allGifts) {
      const amt = g.amount ? g.amount.value : 0;
      totalAmount += amt;

      if (amt > largestGift) {
        largestGift = amt;
        largestGiftDonor = g.lookup_id || '';
      }

      // Group by day
      if (g.date) {
        const day = g.date.substring(0, 10); // YYYY-MM-DD
        giftsByDay[day] = (giftsByDay[day] || 0) + amt;
      }

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
      giftsByDay,
      giftsByFund,
    };
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

async function getRecentGifts(tenantId, limit = 100) {
  try {
    const fundMap = await getFundMap(tenantId);
    const raw = await fetchRecentGiftsRaw(tenantId);
    const gifts = raw.map(g => mapGift(g, fundMap));
    gifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return { gifts: gifts.slice(0, limit), count: gifts.length };
  } catch (err) {
    console.error('[BB DATA] Recent gifts error:', err.message);
    return { gifts: [], count: 0, error: err.message };
  }
}

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

function clearDashboardCache(tenantId) {
  delete dashboardCache[tenantId];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getLiveDashboardData,
  getRecentGifts,
  computeGiftSummary,
  getConstituentSummary,
  getCampaigns,
  clearDashboardCache,
};
