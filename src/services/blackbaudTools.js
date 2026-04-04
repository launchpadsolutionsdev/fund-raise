/**
 * Blackbaud Tools for Ask Fund-Raise AI
 *
 * Provides tool definitions and executors that let Claude query the
 * Blackbaud SKY API in real-time during conversations.
 */

const blackbaudClient = require('./blackbaudClient');

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use format)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'search_constituents',
    description: 'Search for donors/constituents in the Blackbaud database by name, email, or lookup ID. Use this when a user asks about a specific person, donor, or constituent. Returns matching constituent records with basic profile info.',
    input_schema: {
      type: 'object',
      properties: {
        search_text: {
          type: 'string',
          description: 'The name, email, or lookup ID to search for. Examples: "Torin Gunnell", "john.smith@email.com", "CON-12345"',
        },
      },
      required: ['search_text'],
    },
  },
  {
    name: 'get_constituent_profile',
    description: 'Get the full profile for a specific constituent by their Blackbaud constituent ID. Returns name, address, contact info, constituent codes, and custom fields. Use this after search_constituents to get details on a specific match.',
    input_schema: {
      type: 'object',
      properties: {
        constituent_id: {
          type: 'string',
          description: 'The Blackbaud constituent ID (numeric string). Obtained from search_constituents results.',
        },
      },
      required: ['constituent_id'],
    },
  },
  {
    name: 'get_donor_giving_history',
    description: 'Get the complete giving/gift history for a specific constituent. Returns all gifts with amounts, dates, funds, gift types, and appeals. Use this to summarize a donor\'s giving history, total lifetime giving, or find their most recent gifts.',
    input_schema: {
      type: 'object',
      properties: {
        constituent_id: {
          type: 'string',
          description: 'The Blackbaud constituent ID (numeric string).',
        },
      },
      required: ['constituent_id'],
    },
  },
  {
    name: 'search_gifts',
    description: 'Search for gifts in the Blackbaud database with optional filters. Use this for broad gift queries like "gifts over $10,000 this month" or "recent gifts to the annual fund". Returns matching gift records.',
    input_schema: {
      type: 'object',
      properties: {
        search_text: {
          type: 'string',
          description: 'Optional text to search for in gifts (donor name, fund name, etc). Can be empty string for unfiltered results.',
        },
        min_amount: {
          type: 'number',
          description: 'Optional minimum gift amount filter.',
        },
        max_amount: {
          type: 'number',
          description: 'Optional maximum gift amount filter.',
        },
        since_date: {
          type: 'string',
          description: 'Optional start date filter in YYYY-MM-DD format. Only return gifts on or after this date.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of gifts to return. Default 100, max 500.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_gift_details',
    description: 'Get full details for a specific gift by its Blackbaud gift ID. Returns amount, date, type, fund, splits, soft credits, and other details.',
    input_schema: {
      type: 'object',
      properties: {
        gift_id: {
          type: 'string',
          description: 'The Blackbaud gift ID (numeric string).',
        },
      },
      required: ['gift_id'],
    },
  },
  {
    name: 'list_campaigns',
    description: 'List all fundraising campaigns in Blackbaud with their goals, dates, and status. Use this to answer questions about campaign performance or find specific campaigns.',
    input_schema: {
      type: 'object',
      properties: {
        include_inactive: {
          type: 'boolean',
          description: 'Whether to include inactive/completed campaigns. Default false.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_funds',
    description: 'List all funds in Blackbaud. Use this to answer questions about available funds, fund descriptions, or to look up fund details.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of funds to return. Default 200.',
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

async function executeSearchConstituents(tenantId, input) {
  const searchText = input.search_text;
  if (!searchText || !searchText.trim()) {
    return { error: 'Search text is required' };
  }

  const trimmed = searchText.trim();
  console.log(`[BB Search] Searching for: "${trimmed}"`);

  // Strategy: try multiple search approaches since SKY API matching can be inconsistent
  const results = [];

  // 1. Try the dedicated search endpoint (GET)
  try {
    const data = await blackbaudClient.apiRequest(
      tenantId,
      `/constituent/v1/constituents/search?search_text=${encodeURIComponent(trimmed)}&limit=10`
    );
    if (data.value && data.value.length > 0) {
      console.log(`[BB Search] Dedicated search returned ${data.value.length} results`);
      results.push(...data.value);
    }
  } catch (err) {
    console.log(`[BB Search] Dedicated search endpoint failed: ${err.message}`);
  }

  // 2. If no results, try the list endpoint with search_text
  if (results.length === 0) {
    try {
      const data = await blackbaudClient.apiRequest(
        tenantId,
        `/constituent/v1/constituents?search_text=${encodeURIComponent(trimmed)}&limit=10`
      );
      if (data.value && data.value.length > 0) {
        console.log(`[BB Search] List endpoint returned ${data.value.length} results`);
        results.push(...data.value);
      }
    } catch (err) {
      console.log(`[BB Search] List endpoint failed: ${err.message}`);
    }
  }

  // 3. If still no results and input has multiple words, try last name only
  if (results.length === 0 && trimmed.includes(' ')) {
    const lastName = trimmed.split(/\s+/).pop();
    console.log(`[BB Search] No results for full name, trying last name: "${lastName}"`);
    try {
      const data = await blackbaudClient.apiRequest(
        tenantId,
        `/constituent/v1/constituents/search?search_text=${encodeURIComponent(lastName)}&limit=20`
      );
      if (data.value && data.value.length > 0) {
        console.log(`[BB Search] Last name search returned ${data.value.length} results`);
        results.push(...data.value);
      }
    } catch (err) {
      console.log(`[BB Search] Last name search failed: ${err.message}`);
    }
  }

  // Deduplicate by ID and format results
  const seen = new Set();
  const constituents = [];
  for (const c of results) {
    const id = String(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    constituents.push({
      id,
      name: c.name || formatName(c),
      lookup_id: c.lookup_id,
      type: c.type,
      email: c.email ? c.email.address : null,
      phone: c.phone ? c.phone.number : null,
      address: c.address ? formatAddress(c.address) : null,
      date_added: c.date_added,
      inactive: c.inactive || false,
    });
  }

  console.log(`[BB Search] Final: ${constituents.length} unique results for "${trimmed}"`);

  return {
    query: trimmed,
    results_count: constituents.length,
    constituents: constituents.slice(0, 15),
  };
}

async function executeGetConstituentProfile(tenantId, input) {
  const id = input.constituent_id;
  try {
    const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${id}`);

    // Also fetch constituent codes and relationships in parallel
    const [codesData, relationshipsData] = await Promise.allSettled([
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${id}/constituentcodes`),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${id}/relationships?limit=20`),
    ]);

    const codes = codesData.status === 'fulfilled'
      ? (codesData.value.value || []).map(c => c.description || c.lookup_id)
      : [];

    const relationships = relationshipsData.status === 'fulfilled'
      ? (relationshipsData.value.value || []).map(r => ({
          name: r.name || r.relation_id,
          type: r.type,
          reciprocal_type: r.reciprocal_type,
        }))
      : [];

    return {
      id: String(profile.id),
      name: profile.name || formatName(profile),
      lookup_id: profile.lookup_id,
      type: profile.type,
      email: profile.email ? profile.email.address : null,
      phone: profile.phone ? profile.phone.number : null,
      address: profile.address ? formatAddress(profile.address) : null,
      date_added: profile.date_added,
      gives_anonymously: profile.gives_anonymously || false,
      inactive: profile.inactive || false,
      first: profile.first,
      last: profile.last,
      middle: profile.middle,
      title: profile.title,
      suffix: profile.suffix,
      gender: profile.gender,
      birthdate: profile.birthdate ? profile.birthdate.d : null,
      age: profile.age,
      deceased: profile.deceased || false,
      marital_status: profile.marital_status,
      spouse: profile.spouse ? (profile.spouse.name || `${profile.spouse.first || ''} ${profile.spouse.last || ''}`.trim()) : null,
      constituent_codes: codes,
      relationships: relationships.slice(0, 10),
    };
  } catch (err) {
    return { error: `Failed to load constituent profile: ${err.message}` };
  }
}

async function executeGetDonorGivingHistory(tenantId, input) {
  const id = input.constituent_id;
  try {
    // Fetch all gifts for this constituent
    const gifts = await blackbaudClient.apiRequestAll(
      tenantId,
      `/gift/v1/gifts?constituent_id=${id}&limit=500&sort=date&direction=desc`,
      'value',
      10
    );

    // Get fund map for names
    let fundMap = {};
    try {
      const funds = await blackbaudClient.apiRequestAll(tenantId, '/fundraising/v1/funds?limit=500', 'value', 5);
      for (const f of funds) {
        fundMap[f.id] = f.description || f.lookup_id || String(f.id);
      }
    } catch { /* fund names are nice-to-have */ }

    const mappedGifts = gifts.map(g => {
      const fundId = g.gift_splits && g.gift_splits.length > 0
        ? g.gift_splits[0].fund_id
        : null;
      return {
        id: String(g.id),
        amount: g.amount ? g.amount.value : 0,
        date: g.date,
        type: g.type,
        lookup_id: g.lookup_id,
        fund: fundId ? (fundMap[fundId] || `Fund ${fundId}`) : 'Unknown',
        fund_id: fundId,
        appeal_id: g.gift_splits && g.gift_splits.length > 0 ? g.gift_splits[0].appeal_id : null,
        campaign_id: g.gift_splits && g.gift_splits.length > 0 ? g.gift_splits[0].campaign_id : null,
        is_recurring: g.is_recurring || false,
        receipt_amount: g.receipt_amount ? g.receipt_amount.value : null,
        acknowledgement_status: g.acknowledgement ? g.acknowledgement.status : null,
      };
    });

    // Compute summary stats
    let totalGiving = 0;
    let largestGift = 0;
    let earliestDate = null;
    let latestDate = null;
    const fundTotals = {};
    const yearTotals = {};
    const typeTotals = {};

    for (const g of mappedGifts) {
      totalGiving += g.amount;
      if (g.amount > largestGift) largestGift = g.amount;
      if (g.date) {
        if (!earliestDate || g.date < earliestDate) earliestDate = g.date;
        if (!latestDate || g.date > latestDate) latestDate = g.date;
        const year = g.date.substring(0, 4);
        yearTotals[year] = (yearTotals[year] || 0) + g.amount;
      }
      if (g.fund) {
        if (!fundTotals[g.fund]) fundTotals[g.fund] = { count: 0, total: 0 };
        fundTotals[g.fund].count++;
        fundTotals[g.fund].total += g.amount;
      }
      if (g.type) {
        typeTotals[g.type] = (typeTotals[g.type] || 0) + g.amount;
      }
    }

    // Sort funds by total descending
    const topFunds = Object.entries(fundTotals)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15)
      .map(([name, data]) => ({ fund: name, gifts: data.count, total: data.total }));

    return {
      constituent_id: id,
      summary: {
        total_gifts: mappedGifts.length,
        total_giving: totalGiving,
        average_gift: mappedGifts.length > 0 ? totalGiving / mappedGifts.length : 0,
        largest_gift: largestGift,
        first_gift_date: earliestDate,
        most_recent_gift_date: latestDate,
        giving_by_year: yearTotals,
        giving_by_type: typeTotals,
        top_funds: topFunds,
      },
      recent_gifts: mappedGifts.slice(0, 25), // Most recent 25
      all_gift_count: mappedGifts.length,
    };
  } catch (err) {
    return { error: `Failed to load giving history: ${err.message}` };
  }
}

async function executeSearchGifts(tenantId, input) {
  const limit = Math.min(input.limit || 100, 500);
  try {
    // Build search body
    const body = {
      search_text: input.search_text || '',
      limit,
    };

    if (input.since_date) {
      body.gift_date_range_filter = { gte: input.since_date };
    }
    if (input.min_amount || input.max_amount) {
      body.amount_range_filter = {};
      if (input.min_amount) body.amount_range_filter.gte = input.min_amount;
      if (input.max_amount) body.amount_range_filter.lte = input.max_amount;
    }

    const data = await blackbaudClient.apiRequest(tenantId, '/gift/v1/gifts/search', {
      method: 'POST',
      body,
    });

    // Get fund map
    let fundMap = {};
    try {
      const funds = await blackbaudClient.apiRequestAll(tenantId, '/fundraising/v1/funds?limit=500', 'value', 5);
      for (const f of funds) {
        fundMap[f.id] = f.description || f.lookup_id || String(f.id);
      }
    } catch { /* fund names are nice-to-have */ }

    const gifts = (data.value || []).map(g => {
      const fundId = g.gift_splits && g.gift_splits.length > 0
        ? g.gift_splits[0].fund_id : null;
      return {
        id: String(g.id),
        amount: g.amount ? g.amount.value : 0,
        date: g.date,
        type: g.type,
        constituent_id: g.constituent_id ? String(g.constituent_id) : null,
        lookup_id: g.lookup_id,
        fund: fundId ? (fundMap[fundId] || `Fund ${fundId}`) : 'Unknown',
      };
    });

    let totalAmount = 0;
    for (const g of gifts) totalAmount += g.amount;

    return {
      results_count: gifts.length,
      total_amount: totalAmount,
      average_amount: gifts.length > 0 ? totalAmount / gifts.length : 0,
      gifts: gifts.slice(0, 50), // Cap at 50 in response to keep context manageable
    };
  } catch (err) {
    // Fallback to list endpoint
    try {
      let url = `/gift/v1/gifts?limit=${limit}`;
      const data = await blackbaudClient.apiRequest(tenantId, url);
      const gifts = (data.value || []).map(g => ({
        id: String(g.id),
        amount: g.amount ? g.amount.value : 0,
        date: g.date,
        type: g.type,
        constituent_id: g.constituent_id ? String(g.constituent_id) : null,
      }));
      return { results_count: gifts.length, gifts: gifts.slice(0, 50) };
    } catch (fallbackErr) {
      return { error: `Gift search failed: ${fallbackErr.message}` };
    }
  }
}

async function executeGetGiftDetails(tenantId, input) {
  try {
    const gift = await blackbaudClient.apiRequest(tenantId, `/gift/v1/gifts/${input.gift_id}`);

    // Get fund map
    let fundMap = {};
    try {
      const funds = await blackbaudClient.apiRequestAll(tenantId, '/fundraising/v1/funds?limit=500', 'value', 5);
      for (const f of funds) {
        fundMap[f.id] = f.description || f.lookup_id || String(f.id);
      }
    } catch { /* fund names are nice-to-have */ }

    const splits = (gift.gift_splits || []).map(s => ({
      amount: s.amount ? s.amount.value : 0,
      fund: s.fund_id ? (fundMap[s.fund_id] || `Fund ${s.fund_id}`) : 'Unknown',
      appeal_id: s.appeal_id,
      campaign_id: s.campaign_id,
    }));

    return {
      id: String(gift.id),
      constituent_id: gift.constituent_id ? String(gift.constituent_id) : null,
      amount: gift.amount ? gift.amount.value : 0,
      date: gift.date,
      type: gift.type,
      lookup_id: gift.lookup_id,
      is_recurring: gift.is_recurring || false,
      receipt_amount: gift.receipt_amount ? gift.receipt_amount.value : null,
      splits,
      acknowledgement: gift.acknowledgement || null,
      batch_number: gift.batch_number,
      post_date: gift.post_date,
      post_status: gift.post_status,
    };
  } catch (err) {
    return { error: `Failed to load gift details: ${err.message}` };
  }
}

async function executeListCampaigns(tenantId, input) {
  try {
    const data = await blackbaudClient.apiRequest(tenantId, '/fundraising/v1/campaigns?limit=500');
    let campaigns = (data.value || []).map(c => ({
      id: String(c.id),
      description: c.description,
      lookup_id: c.lookup_id,
      goal: c.goal ? c.goal.value : null,
      start_date: c.start_date,
      end_date: c.end_date,
      inactive: c.inactive || false,
    }));

    if (!input.include_inactive) {
      campaigns = campaigns.filter(c => !c.inactive);
    }

    return {
      total: campaigns.length,
      campaigns,
    };
  } catch (err) {
    return { error: `Failed to load campaigns: ${err.message}` };
  }
}

async function executeListFunds(tenantId, input) {
  try {
    const limit = Math.min(input.limit || 200, 500);
    const data = await blackbaudClient.apiRequest(tenantId, `/fundraising/v1/funds?limit=${limit}`);
    const funds = (data.value || []).map(f => ({
      id: String(f.id),
      description: f.description,
      lookup_id: f.lookup_id,
      type: f.type,
      category: f.category,
      status: f.status,
      date_added: f.date_added,
      start_date: f.start_date,
      end_date: f.end_date,
      goal: f.goal ? f.goal.value : null,
    }));
    return { total: funds.length, funds };
  } catch (err) {
    return { error: `Failed to load funds: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Tool executor dispatch
// ---------------------------------------------------------------------------

const ALL_EXECUTORS = {
  search_constituents: executeSearchConstituents,
  get_constituent_profile: executeGetConstituentProfile,
  get_donor_giving_history: executeGetDonorGivingHistory,
  search_gifts: executeSearchGifts,
  get_gift_details: executeGetGiftDetails,
  list_campaigns: executeListCampaigns,
  list_funds: executeListFunds,
};

async function executeTool(tenantId, toolName, toolInput) {
  const executor = ALL_EXECUTORS[toolName];
  if (!executor) {
    return { error: `Unknown tool: ${toolName}` };
  }
  return executor(tenantId, toolInput);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatName(c) {
  const parts = [c.title, c.first, c.middle, c.last, c.suffix].filter(Boolean);
  return parts.join(' ') || 'Unknown';
}

function formatAddress(addr) {
  const lines = [
    addr.address_lines,
    [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
    addr.country,
  ].filter(Boolean);
  return lines.join(', ');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  TOOLS,
  executeTool,
};
