/**
 * Blackbaud Live Data Service
 *
 * Fetches and shapes data from Blackbaud SKY API for the live dashboard.
 */

const blackbaud = require('./blackbaudClient');

// ---------------------------------------------------------------------------
// Dashboard summary — aggregates multiple API calls
// ---------------------------------------------------------------------------

async function getLiveDashboardData(tenantId) {
  const [
    recentGifts,
    giftSummary,
    constituentSummary,
    campaigns,
  ] = await Promise.all([
    getRecentGifts(tenantId, 50),
    getGiftSummary(tenantId),
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
// Recent gifts
// ---------------------------------------------------------------------------

async function getRecentGifts(tenantId, limit = 50) {
  try {
    const data = await blackbaud.apiRequest(
      tenantId,
      `/gift/v1/gifts?limit=${limit}&sort=date desc`
    );
    const gifts = (data.value || []).map(g => ({
      id: g.id,
      amount: g.amount ? g.amount.value : 0,
      date: g.date,
      type: g.type,
      constituentId: g.constituent_id,
      lookupId: g.lookup_id,
      fundName: extractFundName(g),
      campaignName: extractCampaignName(g),
    }));
    return { gifts, count: data.count || gifts.length };
  } catch (err) {
    console.error('[BB DATA] Recent gifts error:', err.message);
    return { gifts: [], count: 0, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Gift summary — fiscal year totals
// ---------------------------------------------------------------------------

async function getGiftSummary(tenantId) {
  try {
    // Fetch current fiscal year gifts (Jan 1 to now as default)
    const year = new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const data = await blackbaud.apiRequest(
      tenantId,
      `/gift/v1/gifts?limit=500&date_added>${startDate}&sort=date desc`
    );

    const gifts = data.value || [];
    let totalAmount = 0;
    let giftCount = gifts.length;
    let largestGift = 0;
    let largestGiftDonor = '';
    const giftsByMonth = {};
    const giftsByType = {};

    for (const g of gifts) {
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
    }

    // If there are more gifts beyond our 500 limit, note it
    const totalAvailable = data.count || giftCount;

    return {
      totalAmount,
      giftCount,
      totalAvailable,
      averageGift: giftCount > 0 ? totalAmount / giftCount : 0,
      largestGift,
      largestGiftDonor,
      giftsByMonth,
      giftsByType,
    };
  } catch (err) {
    console.error('[BB DATA] Gift summary error:', err.message);
    return {
      totalAmount: 0, giftCount: 0, totalAvailable: 0,
      averageGift: 0, largestGift: 0, largestGiftDonor: '',
      giftsByMonth: {}, giftsByType: {},
      error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Constituent summary
// ---------------------------------------------------------------------------

async function getConstituentSummary(tenantId) {
  try {
    // Get total constituent count (just first page with limit=1 for count)
    const data = await blackbaud.apiRequest(
      tenantId,
      '/constituent/v1/constituents?limit=1'
    );

    return {
      totalConstituents: data.count || 0,
    };
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

function extractFundName(gift) {
  if (gift.gift_splits && gift.gift_splits.length > 0) {
    return gift.gift_splits[0].fund_name || gift.gift_splits[0].fund_id || '';
  }
  return '';
}

function extractCampaignName(gift) {
  if (gift.gift_splits && gift.gift_splits.length > 0) {
    return gift.gift_splits[0].campaign_name || gift.gift_splits[0].campaign_id || '';
  }
  return '';
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
