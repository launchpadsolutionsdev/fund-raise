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
  {
    name: 'get_fundraiser_portfolio',
    description: 'Get a solicitor/fundraiser\'s performance portfolio. Given a person\'s name or constituent ID, this tool finds all donors assigned to them (via relationships) and all gifts they\'re credited for (via soft credits), then computes a performance summary: total gifts secured, total amount raised, average gift, top donors in their portfolio, and giving by fund/year. Use this when asked about a fundraiser\'s performance, solicitor metrics, or "how many gifts did [person] secure?"',
    input_schema: {
      type: 'object',
      properties: {
        search_text: {
          type: 'string',
          description: 'The solicitor/fundraiser\'s name to search for. Use this OR constituent_id.',
        },
        constituent_id: {
          type: 'string',
          description: 'The Blackbaud constituent ID of the solicitor/fundraiser. Use this if you already know the ID.',
        },
        since_date: {
          type: 'string',
          description: 'Optional start date filter (YYYY-MM-DD) for gift analysis. E.g., fiscal year start date. If omitted, returns all-time data.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_gift_soft_credits',
    description: 'Get soft credits for a specific gift, showing who is credited as solicitor, fundraiser, or other soft credit types. Use this to see solicitor attribution on individual gifts.',
    input_schema: {
      type: 'object',
      properties: {
        gift_id: {
          type: 'string',
          description: 'The Blackbaud gift ID to look up soft credits for.',
        },
      },
      required: ['gift_id'],
    },
  },
  {
    name: 'get_constituent_solicitors',
    description: 'Find the assigned solicitor(s)/fundraiser(s) for a specific donor/constituent. Returns relationships where the constituent has a fundraiser or solicitor assigned. Also checks for soft credits on their recent gifts to identify who solicited them. Use this when asked "who is the fundraiser for [donor]?" or "who manages [donor]\'s relationship?"',
    input_schema: {
      type: 'object',
      properties: {
        constituent_id: {
          type: 'string',
          description: 'The Blackbaud constituent ID of the donor/constituent.',
        },
      },
      required: ['constituent_id'],
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
// Solicitor / Fundraiser Performance Tools
// ---------------------------------------------------------------------------

async function executeGetFundraiserPortfolio(tenantId, input) {
  try {
    let solicitorId = input.constituent_id;
    let solicitorName = null;

    // If no ID provided, search by name first
    if (!solicitorId && input.search_text) {
      const searchResult = await executeSearchConstituents(tenantId, { search_text: input.search_text });
      if (searchResult.error) return searchResult;
      if (searchResult.results_count === 0) {
        return { error: `No constituent found matching "${input.search_text}". Try a different name or spelling.` };
      }
      solicitorId = searchResult.constituents[0].id;
      solicitorName = searchResult.constituents[0].name;
    } else if (!solicitorId) {
      return { error: 'Please provide either search_text (name) or constituent_id for the solicitor.' };
    }

    // Get solicitor's profile if we don't have the name yet
    if (!solicitorName) {
      try {
        const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${solicitorId}`);
        solicitorName = profile.name || formatName(profile);
      } catch { solicitorName = `Constituent ${solicitorId}`; }
    }

    // Fetch from THREE data sources in parallel:
    // 1. Dedicated fundraiser assignment endpoint (the "Assigned fundraisers" section in RE NXT)
    // 2. Relationship records (fallback for fundraiser-type relationships)
    // 3. Soft credits (gifts the solicitor is credited for securing)
    const [fundraiserAssignmentsData, relationshipsData, softCreditsData] = await Promise.allSettled([
      blackbaudClient.apiRequestAll(
        tenantId,
        `/fundraising/v1/fundraisers/${solicitorId}/constituents?limit=500`,
        'value',
        10
      ),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${solicitorId}/relationships?limit=500`),
      blackbaudClient.apiRequestAll(
        tenantId,
        `/gift/v1/gifts/softcredits?constituent_id=${solicitorId}&limit=500`,
        'value',
        10
      ),
    ]);

    // 1. Process dedicated fundraiser assignments (primary source — maps to "Assigned fundraisers" in RE NXT)
    const fundraiserAssignments = [];
    if (fundraiserAssignmentsData.status === 'fulfilled' && Array.isArray(fundraiserAssignmentsData.value)) {
      for (const assignment of fundraiserAssignmentsData.value) {
        fundraiserAssignments.push({
          constituent_id: assignment.constituent_id ? String(assignment.constituent_id) : (assignment.id ? String(assignment.id) : null),
          name: assignment.name || assignment.constituent_name || null,
          fundraiser_type: assignment.type || 'Unknown',
          start_date: assignment.start_date || assignment.start || null,
          end_date: assignment.end_date || assignment.end || null,
          amount: assignment.amount ? (assignment.amount.value || assignment.amount) : null,
          campaign_id: assignment.campaign_id || null,
          fund_id: assignment.fund_id || null,
        });
      }
    }

    // Fetch names for assignments that don't have them
    for (const assignment of fundraiserAssignments) {
      if (!assignment.name && assignment.constituent_id) {
        try {
          const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${assignment.constituent_id}`);
          assignment.name = profile.name || formatName(profile);
        } catch { assignment.name = `Constituent ${assignment.constituent_id}`; }
      }
    }

    // 2. Process relationships — find donors assigned via relationship records (secondary source)
    const relationshipDonors = [];
    if (relationshipsData.status === 'fulfilled' && relationshipsData.value.value) {
      for (const rel of relationshipsData.value.value) {
        const relType = (rel.type || '').toLowerCase();
        const recipType = (rel.reciprocal_type || '').toLowerCase();
        if (relType.includes('fundraiser') || relType.includes('solicitor') ||
            relType.includes('manager') || relType.includes('officer') ||
            recipType.includes('donor') || recipType.includes('prospect') ||
            recipType.includes('assigned')) {
          relationshipDonors.push({
            constituent_id: rel.relation_id ? String(rel.relation_id) : null,
            name: rel.name || 'Unknown',
            relationship_type: rel.type,
            reciprocal_type: rel.reciprocal_type,
            start_date: rel.start_date || null,
          });
        }
      }
    }

    // Merge assigned donors from both sources (deduplicate by constituent_id)
    const seenDonorIds = new Set();
    const allAssignedDonors = [];

    for (const a of fundraiserAssignments) {
      if (a.constituent_id) seenDonorIds.add(a.constituent_id);
      allAssignedDonors.push({
        constituent_id: a.constituent_id,
        name: a.name,
        assignment_type: a.fundraiser_type,
        start_date: a.start_date,
        end_date: a.end_date,
        source: 'fundraiser_assignment',
      });
    }
    for (const r of relationshipDonors) {
      if (r.constituent_id && !seenDonorIds.has(r.constituent_id)) {
        seenDonorIds.add(r.constituent_id);
        allAssignedDonors.push({
          constituent_id: r.constituent_id,
          name: r.name,
          assignment_type: r.relationship_type,
          start_date: r.start_date,
          end_date: null,
          source: 'relationship',
        });
      }
    }

    // 3. Process soft credits — gifts the solicitor is credited for securing
    const softCredits = [];
    if (softCreditsData.status === 'fulfilled' && Array.isArray(softCreditsData.value)) {
      for (const sc of softCreditsData.value) {
        softCredits.push({
          gift_id: sc.gift_id ? String(sc.gift_id) : null,
          amount: sc.amount ? sc.amount.value : 0,
          date: sc.date || sc.gift_date || null,
          type: sc.soft_credit_type || sc.type || 'Unknown',
          donor_constituent_id: sc.constituent_id ? String(sc.constituent_id) : null,
        });
      }
    }

    // Apply date filter if provided
    let filteredCredits = softCredits;
    if (input.since_date) {
      filteredCredits = softCredits.filter(sc => sc.date && sc.date >= input.since_date);
    }

    // Compute performance summary from soft credits
    let totalAmountSecured = 0;
    let largestGift = 0;
    const yearTotals = {};
    const donorGifts = {};

    for (const sc of filteredCredits) {
      totalAmountSecured += sc.amount;
      if (sc.amount > largestGift) largestGift = sc.amount;
      if (sc.date) {
        const year = sc.date.substring(0, 4);
        yearTotals[year] = (yearTotals[year] || 0) + sc.amount;
      }
      if (sc.donor_constituent_id) {
        if (!donorGifts[sc.donor_constituent_id]) donorGifts[sc.donor_constituent_id] = { count: 0, total: 0 };
        donorGifts[sc.donor_constituent_id].count++;
        donorGifts[sc.donor_constituent_id].total += sc.amount;
      }
    }

    // Get top donors from soft credits with names
    const donorIds = Object.keys(donorGifts);
    const topDonorsByAmount = donorIds.sort((a, b) => donorGifts[b].total - donorGifts[a].total).slice(0, 10);
    const topDonorsWithNames = [];
    for (const donorId of topDonorsByAmount) {
      try {
        const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${donorId}`);
        topDonorsWithNames.push({
          constituent_id: donorId,
          name: profile.name || formatName(profile),
          gifts_count: donorGifts[donorId].count,
          total_secured: donorGifts[donorId].total,
        });
      } catch {
        topDonorsWithNames.push({
          constituent_id: donorId,
          name: `Constituent ${donorId}`,
          gifts_count: donorGifts[donorId].count,
          total_secured: donorGifts[donorId].total,
        });
      }
    }

    // If no soft credits found but we have assigned donors, pull their giving as portfolio proxy
    let assignedDonorGiving = null;
    if (filteredCredits.length === 0 && allAssignedDonors.length > 0) {
      assignedDonorGiving = {
        note: 'No solicitor soft credits found on gift records. Showing giving history for assigned donors as a portfolio proxy.',
        donors: [],
      };
      for (const donor of allAssignedDonors.slice(0, 10)) {
        if (!donor.constituent_id) continue;
        try {
          const giftsData = await blackbaudClient.apiRequest(
            tenantId,
            `/gift/v1/gifts?constituent_id=${donor.constituent_id}&limit=100&sort=date&direction=desc`
          );
          const gifts = (giftsData.value || []);
          let filtered = gifts;
          if (input.since_date) {
            filtered = gifts.filter(g => g.date && g.date >= input.since_date);
          }
          let donorTotal = 0;
          for (const g of filtered) donorTotal += (g.amount ? g.amount.value : 0);
          assignedDonorGiving.donors.push({
            name: donor.name,
            constituent_id: donor.constituent_id,
            assignment_type: donor.assignment_type,
            gift_count: filtered.length,
            total_amount: donorTotal,
          });
        } catch { /* skip donors we can't look up */ }
      }
      // Compute totals for the proxy portfolio
      let proxyTotal = 0;
      let proxyGifts = 0;
      for (const d of assignedDonorGiving.donors) {
        proxyTotal += d.total_amount;
        proxyGifts += d.gift_count;
      }
      assignedDonorGiving.portfolio_total = proxyTotal;
      assignedDonorGiving.portfolio_gift_count = proxyGifts;
    }

    return {
      solicitor: {
        constituent_id: solicitorId,
        name: solicitorName,
      },
      date_filter: input.since_date || 'all time',
      portfolio_summary: {
        assigned_donors_count: allAssignedDonors.length,
        fundraiser_assignments_count: fundraiserAssignments.length,
        relationship_assignments_count: relationshipDonors.length,
        soft_credits_count: filteredCredits.length,
        total_amount_secured_via_soft_credits: totalAmountSecured,
        average_gift_secured: filteredCredits.length > 0 ? totalAmountSecured / filteredCredits.length : 0,
        largest_gift_secured: largestGift,
        unique_donors_credited: donorIds.length,
        giving_by_year: yearTotals,
      },
      assigned_donors: allAssignedDonors.slice(0, 25),
      top_donors_by_gifts_secured: topDonorsWithNames,
      assigned_donor_giving: assignedDonorGiving,
      data_sources_checked: {
        fundraiser_assignments: fundraiserAssignmentsData.status === 'fulfilled' ? 'success' : `failed: ${fundraiserAssignmentsData.reason?.message || 'unknown'}`,
        relationships: relationshipsData.status === 'fulfilled' ? 'success' : `failed: ${relationshipsData.reason?.message || 'unknown'}`,
        soft_credits: softCreditsData.status === 'fulfilled' ? 'success' : `failed: ${softCreditsData.reason?.message || 'unknown'}`,
      },
      data_note: 'Portfolio data comes from three sources: (1) Fundraiser assignments on constituent records (the "Assigned fundraisers" section in RE NXT), (2) Fundraiser-type relationships, and (3) Solicitor soft credits on gift records. If soft credits are sparse, the assigned donor giving totals serve as a portfolio proxy.',
    };
  } catch (err) {
    return { error: `Failed to load fundraiser portfolio: ${err.message}` };
  }
}

async function executeGetGiftSoftCredits(tenantId, input) {
  try {
    const giftId = input.gift_id;
    const data = await blackbaudClient.apiRequest(tenantId, `/gift/v1/gifts/${giftId}/softcredits`);

    const softCredits = (data.value || []).map(sc => ({
      id: sc.id ? String(sc.id) : null,
      constituent_id: sc.constituent_id ? String(sc.constituent_id) : null,
      amount: sc.amount ? sc.amount.value : 0,
      type: sc.soft_credit_type || sc.type || 'Unknown',
    }));

    // Fetch names for soft credit recipients
    for (const sc of softCredits) {
      if (sc.constituent_id) {
        try {
          const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${sc.constituent_id}`);
          sc.name = profile.name || formatName(profile);
        } catch { sc.name = `Constituent ${sc.constituent_id}`; }
      }
    }

    // Also get the gift details for context
    let giftContext = null;
    try {
      const gift = await blackbaudClient.apiRequest(tenantId, `/gift/v1/gifts/${giftId}`);
      giftContext = {
        amount: gift.amount ? gift.amount.value : 0,
        date: gift.date,
        type: gift.type,
        constituent_id: gift.constituent_id ? String(gift.constituent_id) : null,
      };
    } catch { /* gift context is nice-to-have */ }

    return {
      gift_id: giftId,
      gift: giftContext,
      soft_credits_count: softCredits.length,
      soft_credits: softCredits,
      note: softCredits.length === 0
        ? 'No soft credits found on this gift. The solicitor may not have been attributed, or this organization may track solicitors differently (e.g., via the Fundraiser field on the gift record).'
        : null,
    };
  } catch (err) {
    return { error: `Failed to load gift soft credits: ${err.message}` };
  }
}

async function executeGetConstituentSolicitors(tenantId, input) {
  const constituentId = input.constituent_id;
  try {
    // Fetch from THREE sources in parallel:
    // 1. Dedicated fundraiser assignment endpoint (the "Assigned fundraisers" section in RE NXT)
    // 2. Relationship records (fundraiser-type relationships)
    // 3. Soft credits on recent gifts (solicitor attribution)
    const [fundraiserData, relData, profileData] = await Promise.allSettled([
      blackbaudClient.apiRequest(tenantId, `/fundraising/v1/constituents/${constituentId}/fundraisers`),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${constituentId}/relationships?limit=100`),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${constituentId}`),
    ]);

    let constituentName = null;
    if (profileData.status === 'fulfilled') {
      constituentName = profileData.value.name || formatName(profileData.value);
    } else {
      constituentName = `Constituent ${constituentId}`;
    }

    // 1. Process dedicated fundraiser assignments (primary — "Assigned fundraisers" in RE NXT)
    const fundraiserAssignments = [];
    if (fundraiserData.status === 'fulfilled') {
      const items = fundraiserData.value.value || (Array.isArray(fundraiserData.value) ? fundraiserData.value : []);
      for (const fa of items) {
        const fundraiserId = fa.fundraiser_id ? String(fa.fundraiser_id) : (fa.constituent_id ? String(fa.constituent_id) : null);
        let fundraiserName = fa.name || fa.fundraiser_name || null;

        // Fetch fundraiser name if not provided
        if (!fundraiserName && fundraiserId) {
          try {
            const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${fundraiserId}`);
            fundraiserName = profile.name || formatName(profile);
          } catch { fundraiserName = `Constituent ${fundraiserId}`; }
        }

        fundraiserAssignments.push({
          fundraiser_constituent_id: fundraiserId,
          name: fundraiserName,
          type: fa.type || 'Unknown',
          start_date: fa.start_date || fa.start || null,
          end_date: fa.end_date || fa.end || null,
          source: 'fundraiser_assignment',
        });
      }
    }

    // 2. Process relationship records (secondary source)
    const solicitorRelationships = [];
    const allRelationships = relData.status === 'fulfilled' ? (relData.value.value || []) : [];

    for (const rel of allRelationships) {
      const relType = (rel.type || '').toLowerCase();
      const recipType = (rel.reciprocal_type || '').toLowerCase();
      if (recipType.includes('fundraiser') || recipType.includes('solicitor') ||
          recipType.includes('manager') || recipType.includes('officer') ||
          relType.includes('donor') || relType.includes('prospect') ||
          relType.includes('assigned')) {
        solicitorRelationships.push({
          fundraiser_constituent_id: rel.relation_id ? String(rel.relation_id) : null,
          name: rel.name || 'Unknown',
          type: rel.reciprocal_type || rel.type,
          start_date: rel.start_date || null,
          source: 'relationship',
        });
      }
    }

    // 3. Check soft credits on recent gifts for solicitor attribution
    const softCreditSolicitors = [];
    try {
      const giftsData = await blackbaudClient.apiRequest(
        tenantId,
        `/gift/v1/gifts?constituent_id=${constituentId}&limit=10&sort=date&direction=desc`
      );
      const recentGifts = (giftsData.value || []).slice(0, 5);

      for (const gift of recentGifts) {
        try {
          const scData = await blackbaudClient.apiRequest(tenantId, `/gift/v1/gifts/${gift.id}/softcredits`);
          for (const sc of (scData.value || [])) {
            const scType = (sc.soft_credit_type || sc.type || '').toLowerCase();
            if (scType.includes('solicitor') || scType.includes('fundraiser')) {
              let scName = null;
              if (sc.constituent_id) {
                try {
                  const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${sc.constituent_id}`);
                  scName = profile.name || formatName(profile);
                } catch { scName = `Constituent ${sc.constituent_id}`; }
              }
              softCreditSolicitors.push({
                fundraiser_constituent_id: sc.constituent_id ? String(sc.constituent_id) : null,
                name: scName,
                soft_credit_type: sc.soft_credit_type || sc.type,
                gift_id: String(gift.id),
                gift_date: gift.date,
                gift_amount: gift.amount ? gift.amount.value : 0,
              });
            }
          }
        } catch { /* skip individual gift soft credit failures */ }
      }
    } catch { /* soft credit check is best-effort */ }

    const totalFound = fundraiserAssignments.length + solicitorRelationships.length + softCreditSolicitors.length;

    return {
      constituent: {
        id: constituentId,
        name: constituentName,
      },
      fundraiser_assignments: fundraiserAssignments,
      solicitor_relationships: solicitorRelationships,
      solicitors_from_gift_soft_credits: softCreditSolicitors,
      data_sources_checked: {
        fundraiser_assignments: fundraiserData.status === 'fulfilled' ? 'success' : `failed: ${fundraiserData.reason?.message || 'unknown'}`,
        relationships: relData.status === 'fulfilled' ? 'success' : `failed: ${relData.reason?.message || 'unknown'}`,
        soft_credits: 'checked',
      },
      note: totalFound === 0
        ? 'No solicitor/fundraiser found for this constituent from any source. This could mean: (1) no fundraiser has been assigned yet in the "Assigned fundraisers" section, (2) no fundraiser relationship exists, or (3) no solicitor soft credits exist on their gifts.'
        : null,
    };
  } catch (err) {
    return { error: `Failed to load solicitor information: ${err.message}` };
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
  get_fundraiser_portfolio: executeGetFundraiserPortfolio,
  get_gift_soft_credits: executeGetGiftSoftCredits,
  get_constituent_solicitors: executeGetConstituentSolicitors,
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
