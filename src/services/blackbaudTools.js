/**
 * Blackbaud Tools for Ask Fund-Raise AI
 *
 * Provides tool definitions and executors that let Claude query the
 * Blackbaud SKY API in real-time during conversations.
 */

const blackbaudClient = require('./blackbaudClient');
const { Snapshot, RawGift } = require('../models');
const { Sequelize } = require('sequelize');
const { getAvailableDates } = require('./snapshotService');

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

    console.log(`[Fundraiser Portfolio] Building portfolio for ${solicitorName} (${solicitorId})`);

    // STRATEGY: The Blackbaud SKY API has no reverse-lookup endpoint
    // (fundraiser_id → assigned constituents). The only working endpoint is:
    //   GET /constituent/v1/constituents/{donor_id}/fundraiserassignments
    // which returns fundraisers assigned TO a specific donor.
    //
    // To build a fundraiser's portfolio, we:
    // 1. Get top donors from the local snapshot data (RawGift table)
    // 2. Search each in Blackbaud to get their constituent ID
    // 3. Check their fundraiserassignments for our solicitor's ID
    // 4. For matches, pull their full giving history from Blackbaud

    // Step 1: Get top donors from local snapshot data
    const assignedDonors = [];
    let candidatesChecked = 0;
    let snapshotDonorCount = 0;

    try {
      const dates = await getAvailableDates(tenantId);
      if (dates.length > 0) {
        const snapshot = await Snapshot.findOne({ where: { tenantId, snapshotDate: dates[0] } });
        if (snapshot) {
          // Get top donors by total giving from the snapshot
          const topDonors = await RawGift.findAll({
            where: { snapshotId: snapshot.id },
            attributes: [
              'primaryAddressee',
              [Sequelize.fn('SUM', Sequelize.cast(Sequelize.col('split_amount'), 'FLOAT')), 'total'],
              [Sequelize.fn('COUNT', Sequelize.col('id')), 'gifts'],
            ],
            group: ['primaryAddressee'],
            order: [[Sequelize.literal('total'), 'DESC']],
            limit: 100, // Check top 100 donors by giving amount
            raw: true,
          });

          snapshotDonorCount = topDonors.length;
          console.log(`[Fundraiser Portfolio] Found ${snapshotDonorCount} unique donors in snapshot to check`);

          // Step 2-3: For each donor, search Blackbaud and check fundraiser assignments
          for (const donor of topDonors) {
            if (!donor.primaryAddressee) continue;
            candidatesChecked++;

            try {
              // Search for the donor in Blackbaud
              const searchData = await blackbaudClient.apiRequest(
                tenantId,
                `/constituent/v1/constituents/search?search_text=${encodeURIComponent(donor.primaryAddressee)}&limit=3`
              );
              const matches = searchData.value || [];
              if (matches.length === 0) continue;

              const constituentId = String(matches[0].id);

              // Check their fundraiser assignments
              const assignData = await blackbaudClient.apiRequest(
                tenantId,
                `/constituent/v1/constituents/${constituentId}/fundraiserassignments`
              );
              const assignments = assignData.value || [];

              // Check if our solicitor is assigned to this donor
              for (const a of assignments) {
                if (String(a.fundraiser_id) === solicitorId) {
                  assignedDonors.push({
                    constituent_id: constituentId,
                    name: matches[0].name || donor.primaryAddressee,
                    assignment_type: a.type || 'Unknown',
                    start_date: a.start || a.start_date || null,
                    end_date: a.end || a.end_date || null,
                    snapshot_total: parseFloat(donor.total) || 0,
                    snapshot_gifts: parseInt(donor.gifts) || 0,
                  });
                  console.log(`[Fundraiser Portfolio] MATCH: ${donor.primaryAddressee} → assigned to ${solicitorName}`);
                  break;
                }
              }
            } catch (err) {
              // Skip donors we can't look up — don't let one failure stop the search
              if (err.message && err.message.includes('Daily Blackbaud API limit')) {
                console.log(`[Fundraiser Portfolio] API limit reached after checking ${candidatesChecked} donors`);
                break;
              }
            }

            // Rate-limit check: stop if we've used too many API calls
            if (blackbaudClient.isDailyLimitReached()) {
              console.log(`[Fundraiser Portfolio] API limit reached after checking ${candidatesChecked} donors`);
              break;
            }
          }
        }
      }
    } catch (err) {
      console.log(`[Fundraiser Portfolio] Local snapshot query failed: ${err.message}`);
    }

    console.log(`[Fundraiser Portfolio] Checked ${candidatesChecked} donors, found ${assignedDonors.length} assigned to ${solicitorName}`);

    // Step 4: Pull full giving history from Blackbaud for each assigned donor
    let portfolioTotal = 0;
    let portfolioGiftCount = 0;
    let largestGift = 0;
    const yearTotals = {};
    const donorPerformance = [];

    for (const donor of assignedDonors) {
      try {
        const giftsData = await blackbaudClient.apiRequest(
          tenantId,
          `/gift/v1/gifts?constituent_id=${donor.constituent_id}&limit=500&sort=date&direction=desc`
        );
        const allGifts = giftsData.value || [];
        let gifts = allGifts;
        if (input.since_date) {
          gifts = allGifts.filter(g => g.date && g.date >= input.since_date);
        }

        let donorTotal = 0;
        let donorLargest = 0;
        for (const g of gifts) {
          const amt = g.amount ? g.amount.value : 0;
          donorTotal += amt;
          if (amt > donorLargest) donorLargest = amt;
          if (amt > largestGift) largestGift = amt;
          if (g.date) {
            const year = g.date.substring(0, 4);
            yearTotals[year] = (yearTotals[year] || 0) + amt;
          }
        }

        portfolioTotal += donorTotal;
        portfolioGiftCount += gifts.length;

        donorPerformance.push({
          name: donor.name,
          constituent_id: donor.constituent_id,
          assignment_type: donor.assignment_type,
          start_date: donor.start_date,
          gift_count: gifts.length,
          total_giving: donorTotal,
          largest_gift: donorLargest,
          most_recent_gift: gifts.length > 0 ? gifts[0].date : null,
        });
      } catch (err) {
        donorPerformance.push({
          name: donor.name,
          constituent_id: donor.constituent_id,
          assignment_type: donor.assignment_type,
          gift_count: donor.snapshot_gifts || 0,
          total_giving: donor.snapshot_total || 0,
          data_source: 'snapshot_only',
        });
      }
    }

    // Sort donors by total giving descending
    donorPerformance.sort((a, b) => (b.total_giving || 0) - (a.total_giving || 0));

    return {
      solicitor: {
        constituent_id: solicitorId,
        name: solicitorName,
      },
      date_filter: input.since_date || 'all time',
      portfolio_summary: {
        assigned_donors_count: assignedDonors.length,
        donors_with_giving_data: donorPerformance.filter(d => d.gift_count > 0).length,
        portfolio_total_giving: portfolioTotal,
        portfolio_gift_count: portfolioGiftCount,
        average_gift: portfolioGiftCount > 0 ? portfolioTotal / portfolioGiftCount : 0,
        largest_gift: largestGift,
        giving_by_year: yearTotals,
        candidates_checked: candidatesChecked,
        snapshot_donors_available: snapshotDonorCount,
      },
      donor_performance: donorPerformance,
      data_note: assignedDonors.length > 0
        ? `Portfolio built by checking the top ${candidatesChecked} donors (by giving amount) from the snapshot data against Blackbaud fundraiser assignments. ${assignedDonors.length} donor(s) are assigned to ${solicitorName}. Giving data pulled from Blackbaud for each.`
        : `Checked ${candidatesChecked} top donors from snapshot data against Blackbaud, but none had ${solicitorName} as their assigned fundraiser. This could mean: (1) the donors assigned to this fundraiser are not in the top ${candidatesChecked} by giving, (2) fundraiser assignments haven't been entered in RE NXT, or (3) the fundraiser manages donors not yet captured in the snapshot.`,
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
    // Confirmed working endpoint: GET /constituent/v1/constituents/{id}/fundraiserassignments
    // Returns: { count: N, value: [{ id, constituent_id, fundraiser_id, start, type }] }
    // This maps to the "Assigned fundraisers" section in the RE NXT web view.
    const [fundraiserAssignData, relData, profileData] = await Promise.allSettled([
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${constituentId}/fundraiserassignments`),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${constituentId}/relationships?limit=100`),
      blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${constituentId}`),
    ]);

    let constituentName = null;
    if (profileData.status === 'fulfilled') {
      constituentName = profileData.value.name || formatName(profileData.value);
    } else {
      constituentName = `Constituent ${constituentId}`;
    }

    // 1. Process fundraiser assignments (primary — confirmed working endpoint)
    const fundraiserAssignments = [];
    if (fundraiserAssignData.status === 'fulfilled') {
      const items = fundraiserAssignData.value.value || [];
      console.log(`[Constituent Solicitors] ${constituentName} (${constituentId}): ${items.length} fundraiser assignment(s) found`);
      for (const fa of items) {
        const fundraiserId = fa.fundraiser_id ? String(fa.fundraiser_id) : null;
        let fundraiserName = null;

        // Fetch fundraiser name
        if (fundraiserId) {
          try {
            const profile = await blackbaudClient.apiRequest(tenantId, `/constituent/v1/constituents/${fundraiserId}`);
            fundraiserName = profile.name || formatName(profile);
          } catch { fundraiserName = `Constituent ${fundraiserId}`; }
        }

        fundraiserAssignments.push({
          fundraiser_constituent_id: fundraiserId,
          name: fundraiserName,
          type: fa.type || 'Unknown',
          start_date: fa.start || fa.start_date || null,
          end_date: fa.end || fa.end_date || null,
          source: 'fundraiser_assignment',
        });
      }
    } else {
      console.log(`[Constituent Solicitors] fundraiserassignments endpoint failed for ${constituentId}: ${fundraiserAssignData.reason?.message || 'unknown'}`);
    }

    // 2. Process relationship records (secondary source)
    const solicitorRelationships = [];
    const allRelationships = relData.status === 'fulfilled' ? (relData.value.value || []) : [];

    for (const rel of allRelationships) {
      const relType = (rel.type || '').toLowerCase();
      const recipType = (rel.reciprocal_type || '').toLowerCase();
      if (recipType.includes('fundraiser') || recipType.includes('solicitor') ||
          recipType.includes('manager') || recipType.includes('officer') ||
          recipType.includes('staff') || recipType.includes('lead') ||
          relType.includes('donor') || relType.includes('prospect') ||
          relType.includes('assigned') || relType.includes('managed')) {
        solicitorRelationships.push({
          fundraiser_constituent_id: rel.relation_id ? String(rel.relation_id) : null,
          name: rel.name || 'Unknown',
          type: rel.type || 'Unknown',
          reciprocal_type: rel.reciprocal_type || null,
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
      note: totalFound === 0
        ? 'No solicitor/fundraiser found for this constituent. Check the "Assigned fundraisers" section on their record in RE NXT to verify.'
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
