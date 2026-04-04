const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const {
  Snapshot, DepartmentSummary, GiftTypeBreakdown,
  SourceBreakdown, FundBreakdown, RawGift,
} = require('../models');
const blackbaudClient = require('./blackbaudClient');
const { TOOLS: BB_TOOLS, executeTool: executeToolFn } = require('./blackbaudTools');
const { getKnowledgeBaseInjection } = require('./knowledgeBaseRouter');
const {
  getDashboardData,
  getEnhancedDashboardData,
  getDepartmentData,
  getDepartmentEnhancedData,
  getCrossDepartmentData,
  getTrendsEnhanced,
  getProjection,
  getAvailableDates,
} = require('./snapshotService');

const DEPT_LABELS = {
  annual_giving: 'Annual Giving',
  direct_mail: 'Direct Mail',
  events: 'Events',
  major_gifts: 'Major Gifts',
  legacy_giving: 'Legacy Giving',
};

const DEPARTMENTS = Object.keys(DEPT_LABELS);

// Load the static system prompt from the markdown file
const PROMPT_FILE = path.join(__dirname, '..', '..', 'fund-raise-system-prompt.md');
let staticPromptCache = null;
let staticPromptMtime = 0;

function loadStaticPrompt() {
  try {
    const stat = fs.statSync(PROMPT_FILE);
    // Reload only if file has changed (supports live editing in dev)
    if (!staticPromptCache || stat.mtimeMs !== staticPromptMtime) {
      staticPromptCache = fs.readFileSync(PROMPT_FILE, 'utf-8');
      staticPromptMtime = stat.mtimeMs;
    }
  } catch (err) {
    console.error('[AI] Failed to load system prompt file:', err.message);
    if (!staticPromptCache) {
      staticPromptCache = 'You are Ask Fund-Raise, an AI assistant for fundraising analytics.';
    }
  }
  return staticPromptCache;
}

// In-memory cache for system prompts: keyed by tenantId
// Avoids re-querying all dashboard data on every message in a conversation
const contextCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedPrompt(tenantId) {
  const entry = contextCache.get(tenantId);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.prompt;
  }
  return null;
}

function setCachedPrompt(tenantId, prompt) {
  contextCache.set(tenantId, { prompt, timestamp: Date.now() });
}

function clearCache(tenantId) {
  if (tenantId) {
    contextCache.delete(tenantId);
  } else {
    contextCache.clear();
  }
}

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function getLatestSnapshot(tenantId) {
  const dates = await getAvailableDates(tenantId);
  if (!dates.length) return null;
  return Snapshot.findOne({ where: { tenantId, snapshotDate: dates[0] } });
}

async function gatherContext(tenantId) {
  const snapshot = await getLatestSnapshot(tenantId);
  if (!snapshot) {
    return { hasData: false, snapshotDate: null, summary: 'No data has been uploaded yet.' };
  }

  const [
    dashboardData,
    enhancedData,
    crossDeptData,
    trendsData,
    projectionData,
  ] = await Promise.all([
    getDashboardData(snapshot),
    getEnhancedDashboardData(snapshot),
    getCrossDepartmentData(snapshot),
    getTrendsEnhanced(tenantId),
    getProjection(tenantId),
  ]);

  // Gather department-level data for all departments
  const deptDetails = {};
  for (const dept of DEPARTMENTS) {
    const [deptData, deptEnhanced] = await Promise.all([
      getDepartmentData(snapshot, dept),
      getDepartmentEnhancedData(snapshot, dept).catch(() => null),
    ]);

    if (deptData.summary) {
      const s = deptData.summary;
      deptDetails[dept] = {
        label: DEPT_LABELS[dept],
        totalGifts: s.totalGifts,
        totalAmount: parseFloat(s.totalAmount) || 0,
        goal: parseFloat(s.goal) || 0,
        pctToGoal: parseFloat(s.pctToGoal) || 0,
        giftTypes: deptData.giftTypes.map(g => ({
          type: g.giftType,
          amount: parseFloat(g.amount) || 0,
          pct: parseFloat(g.pctOfGifts) || 0,
        })),
        sources: deptData.sources.map(s => ({
          source: s.source,
          amount: parseFloat(s.amount) || 0,
          pct: parseFloat(s.pctOfGifts) || 0,
        })),
        topFunds: deptData.funds.slice(0, 10).map(f => ({
          name: f.fundName,
          amount: parseFloat(f.amount) || 0,
          totalCount: f.totalCount,
        })),
        rawGiftCount: deptData.rawCount,
      };

      // Add department-specific fields
      if (dept === 'events' && s.thirdPartyTotalAmount) {
        deptDetails[dept].thirdPartyAmount = parseFloat(s.thirdPartyTotalAmount) || 0;
        deptDetails[dept].thirdPartyGifts = s.thirdPartyTotalGifts;
        deptDetails[dept].thirdPartyGoal = parseFloat(s.thirdPartyGoal) || 0;
      }
      if (dept === 'legacy_giving') {
        deptDetails[dept].avgGift = parseFloat(s.avgGift) || 0;
        deptDetails[dept].newExpectancies = s.newExpectancies;
        deptDetails[dept].openEstates = s.openEstates;
      }

      // Add enhanced data
      if (deptEnhanced) {
        deptDetails[dept].topDonors = (deptEnhanced.topDonors || []).slice(0, 5).map(d => ({
          name: d.primaryAddressee,
          total: d.total,
          gifts: d.gifts,
        }));
        deptDetails[dept].topAppeals = (deptEnhanced.appealPerformance || []).slice(0, 5).map(a => ({
          appeal: a.appealId,
          total: a.total,
          donors: a.donors,
        }));
        if (deptEnhanced.channelTotals) {
          deptDetails[dept].channelMix = deptEnhanced.channelTotals;
        }
      }
    }
  }

  const context = {
    hasData: true,
    snapshotDate: snapshot.snapshotDate,
    overview: {
      totalRaised: dashboardData.totalRaised,
      totalGifts: dashboardData.totalGifts,
      combinedGoal: dashboardData.combinedGoal,
      overallPct: dashboardData.overallPct,
      gapToGoal: Math.max(0, dashboardData.combinedGoal - dashboardData.totalRaised),
    },
    enhanced: {
      donorCount: enhancedData.donorCount,
      largestGift: enhancedData.largestGift,
      giftDistribution: enhancedData.giftDistribution,
      topDonors: (enhancedData.topDonors || []).slice(0, 10),
      topAppeals: (enhancedData.topAppeals || []).slice(0, 10),
    },
    crossDepartment: {
      donorConcentration: crossDeptData.donorConcentration,
      crossDeptDonors: (crossDeptData.crossDeptDonors || []).slice(0, 10),
      topFunds: (crossDeptData.fundRankings || []).slice(0, 10),
    },
    departments: deptDetails,
    projection: projectionData,
    trendSummary: trendsData.length > 1 ? {
      snapshotCount: trendsData.length,
      firstDate: trendsData[0].date,
      lastDate: trendsData[trendsData.length - 1].date,
      firstTotal: trendsData[0].totalRaised,
      lastTotal: trendsData[trendsData.length - 1].totalRaised,
      growth: trendsData[trendsData.length - 1].totalRaised - trendsData[0].totalRaised,
    } : null,
  };

  return context;
}

function fmt(n) {
  return (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildDataContext(context) {
  const lines = [];
  lines.push(`# Live Data Context (Snapshot: ${context.snapshotDate})`);
  lines.push('');

  // Overview
  lines.push('## Organization Overview');
  lines.push(`- Total Raised: $${fmt(context.overview.totalRaised)}`);
  lines.push(`- Combined Goal: $${fmt(context.overview.combinedGoal)}`);
  lines.push(`- Gap to Goal: $${fmt(context.overview.gapToGoal)}`);
  lines.push(`- Overall Progress: ${context.overview.overallPct.toFixed(1)}%`);
  lines.push(`- Total Gifts: ${context.overview.totalGifts.toLocaleString()}`);
  lines.push(`- Unique Donors: ${context.enhanced.donorCount.toLocaleString()}`);
  if (context.enhanced.largestGift) {
    const lg = context.enhanced.largestGift;
    lines.push(`- Largest Gift: $${fmt(lg.amount)} from ${lg.donor} (${DEPT_LABELS[lg.department] || lg.department})`);
  }
  lines.push('');

  // Donor Concentration
  const dc = context.crossDepartment.donorConcentration;
  lines.push('## Donor Concentration');
  lines.push(`- Top 10% of donors contribute: ${dc.top10_pct ? parseFloat(dc.top10_pct).toFixed(1) : 'N/A'}% of revenue`);
  lines.push(`- Top 20% of donors contribute: ${dc.top20_pct ? parseFloat(dc.top20_pct).toFixed(1) : 'N/A'}% of revenue`);
  lines.push(`- Total unique donors: ${dc.total_donors || 'N/A'}`);
  lines.push('');

  // Top Donors
  if (context.enhanced.topDonors && context.enhanced.topDonors.length) {
    lines.push('## Top 10 Donors (Organization-Wide)');
    context.enhanced.topDonors.forEach((d, i) => {
      lines.push(`${i + 1}. ${d.primaryAddressee}: $${fmt(d.total)} (${d.gifts} gifts)`);
    });
    lines.push('');
  }

  // Top Appeals
  if (context.enhanced.topAppeals && context.enhanced.topAppeals.length) {
    lines.push('## Top Appeals/Campaigns');
    context.enhanced.topAppeals.forEach((a, i) => {
      lines.push(`${i + 1}. ${a.appealId}: $${fmt(a.total)} (${a.donors} donors, ${a.gifts} gifts)`);
    });
    lines.push('');
  }

  // Gift Size Distribution
  if (context.enhanced.giftDistribution && context.enhanced.giftDistribution.length) {
    lines.push('## Gift Size Distribution');
    context.enhanced.giftDistribution.forEach(b => {
      lines.push(`- ${b.bucket}: ${b.count} gifts totaling $${fmt(b.total)}`);
    });
    lines.push('');
  }

  // Cross-Department Donors
  if (context.crossDepartment.crossDeptDonors && context.crossDepartment.crossDeptDonors.length) {
    lines.push('## Cross-Department Donors (giving to 2+ departments)');
    context.crossDepartment.crossDeptDonors.forEach((d, i) => {
      lines.push(`${i + 1}. ${d.primaryAddressee}: $${fmt(d.total)} across ${d.dept_count} departments (${d.departments.join(', ')})`);
    });
    lines.push('');
  }

  // Projection
  if (context.projection) {
    const p = context.projection;
    lines.push('## Year-End Projection');
    lines.push(`- Current Total: $${fmt(p.currentTotal)}`);
    lines.push(`- Projected Year-End: $${fmt(p.projectedTotal)} (${p.projectedPct.toFixed(1)}% of goal)`);
    lines.push(`- Daily Run Rate: $${fmt(p.dailyRate)}/day`);
    lines.push(`- Required Daily to Meet Goal: $${fmt(p.requiredDaily)}/day`);
    lines.push(`- Days Remaining: ${p.daysRemaining}`);
    lines.push(`- On Track: ${p.onTrack ? 'Yes' : 'No'}`);
    lines.push('');
  }

  // Trends
  if (context.trendSummary) {
    const t = context.trendSummary;
    lines.push('## Trend Summary');
    lines.push(`- Tracking ${t.snapshotCount} snapshots from ${t.firstDate} to ${t.lastDate}`);
    lines.push(`- Growth over period: $${fmt(t.growth)}`);
    lines.push('');
  }

  // Department Details
  lines.push('## Department Details');
  lines.push('');

  for (const [slug, dept] of Object.entries(context.departments)) {
    if (!dept) continue;
    lines.push(`### ${dept.label}`);
    lines.push(`- Total Raised: $${fmt(dept.totalAmount)}`);
    lines.push(`- Goal: $${fmt(dept.goal)}`);
    lines.push(`- Progress: ${dept.pctToGoal.toFixed(1)}%`);
    lines.push(`- Total Gifts: ${dept.totalGifts.toLocaleString()}`);
    lines.push(`- Individual Gift Records: ${dept.rawGiftCount.toLocaleString()}`);

    if (dept.thirdPartyAmount) {
      lines.push(`- Third-Party Events Revenue: $${fmt(dept.thirdPartyAmount)} (Goal: $${fmt(dept.thirdPartyGoal)})`);
    }
    if (dept.avgGift) {
      lines.push(`- Average Gift: $${fmt(dept.avgGift)}`);
    }
    if (dept.newExpectancies != null) {
      lines.push(`- New Expectancies: ${dept.newExpectancies}`);
    }
    if (dept.openEstates != null) {
      lines.push(`- Open Estates: ${dept.openEstates}`);
    }
    if (dept.channelMix) {
      const cm = dept.channelMix;
      lines.push(`- Channel Mix: One-time: ${cm.onetime}, Recurring: ${cm.recurring} (${cm.recurringRate.toFixed(1)}%), Online: ${cm.online} (${cm.onlineRate.toFixed(1)}%), Mailed: ${cm.mailed}`);
    }
    if (dept.giftTypes && dept.giftTypes.length) {
      lines.push(`- Gift Types: ${dept.giftTypes.map(g => `${g.type}: $${fmt(g.amount)} (${g.pct.toFixed(1)}%)`).join(', ')}`);
    }
    if (dept.sources && dept.sources.length) {
      lines.push(`- Sources: ${dept.sources.map(s => `${s.source}: $${fmt(s.amount)} (${s.pct.toFixed(1)}%)`).join(', ')}`);
    }
    if (dept.topDonors && dept.topDonors.length) {
      lines.push(`- Top Donors: ${dept.topDonors.map(d => `${d.name}: $${fmt(d.total)}`).join(', ')}`);
    }
    if (dept.topAppeals && dept.topAppeals.length) {
      lines.push(`- Top Appeals: ${dept.topAppeals.map(a => `${a.appeal}: $${fmt(a.total)} (${a.donors} donors)`).join(', ')}`);
    }
    if (dept.topFunds && dept.topFunds.length) {
      lines.push(`- Top Funds: ${dept.topFunds.map(f => `${f.name}: $${fmt(f.amount)} (${f.totalCount} gifts)`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildSystemPrompt(context, bbConnected, knowledgeBaseText) {
  const staticPrompt = loadStaticPrompt();

  let prompt;
  if (!context.hasData) {
    prompt = staticPrompt + '\n\n---\n\n**DATA STATUS:** No fundraising data has been uploaded yet. Let the user know they need to upload data first via the Upload Data page before you can answer data questions.'
      + (bbConnected ? '\n\n**BLACKBAUD STATUS:** Blackbaud is connected. You can still use tools to search the CRM database even though no snapshot data has been uploaded.' : '');
  } else {
    const dataContext = buildDataContext(context);
    const bbStatus = bbConnected
      ? '\n\n**BLACKBAUD STATUS:** Blackbaud CRM is connected. You have access to live database tools for looking up specific donors, gifts, campaigns, and funds. Use them when the user asks about specific people or records not in the snapshot data above.'
      : '\n\n**BLACKBAUD STATUS:** Blackbaud CRM is not connected for this organization. You can only answer from the snapshot data above. If a user asks to look up a specific donor in the database, let them know Blackbaud is not connected and suggest they visit the Blackbaud settings page.';
    prompt = staticPrompt + '\n\n---\n\n' + dataContext + bbStatus;
  }

  // Conditionally append RE NXT knowledge base
  if (knowledgeBaseText) {
    prompt += knowledgeBaseText;
  }

  return prompt;
}

async function getSystemPrompt(tenantId, knowledgeBaseText) {
  // Base prompt (data context) is cached; KB injection varies per message
  let basePrompt = getCachedPrompt(tenantId);
  if (!basePrompt) {
    const context = await gatherContext(tenantId);
    const bbConnected = blackbaudClient.isConfigured()
      ? await blackbaudClient.getConnectionStatus(tenantId).then(s => s.connected).catch(() => false)
      : false;
    basePrompt = buildSystemPrompt(context, bbConnected);
    setCachedPrompt(tenantId, basePrompt);
  }
  // Append KB only when needed (kept outside cache so routing works per-message)
  if (knowledgeBaseText) {
    return basePrompt + knowledgeBaseText;
  }
  return basePrompt;
}

// Log token usage for cost monitoring
function logTokenUsage(response) {
  if (response && response.usage) {
    const u = response.usage;
    console.log(`[Ask Fund-Raise] Tokens — input: ${u.input_tokens}, output: ${u.output_tokens}, cache_read: ${u.cache_read_input_tokens || 0}, cache_creation: ${u.cache_creation_input_tokens || 0}`);
  }
}

async function chat(tenantId, messages, options = {}) {
  const client = getClient();
  const deepDive = options.deepDive || false;
  const conversation = options.conversation || null;
  const hasImage = options.hasImage || false;

  // Keyword routing: determine if RE NXT knowledge base is needed
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const lastUserText = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : (Array.isArray(lastUserMsg?.content) ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
  const { inject: kbNeeded, knowledgeBaseText } = getKnowledgeBaseInjection(lastUserText, conversation, hasImage);

  const systemPrompt = await getSystemPrompt(tenantId, knowledgeBaseText);

  if (kbNeeded) {
    console.log('[Ask Fund-Raise] RE NXT knowledge base injected for this message');
  }

  // Assemble tools based on mode
  const tools = [];

  if (deepDive) {
    const bbConnected = blackbaudClient.isConfigured()
      ? await blackbaudClient.getConnectionStatus(tenantId).then(s => s.connected).catch(() => false)
      : false;

    if (bbConnected) {
      tools.push(...BB_TOOLS);
    }
    tools.push({ type: 'web_search_20250305', name: 'web_search' });
  }

  const anthropicMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Non-streaming fallback (used internally for tool rounds)
  async function createMessage(msgs, opts = {}) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: msgs,
      ...(tools.length > 0 ? { tools } : {}),
      ...opts,
    });
    logTokenUsage(response);
    return response;
  }

  // If deep dive is off, do a simple single-turn call (no tools, no streaming needed here — streaming handled by chatStream)
  if (tools.length === 0) {
    const response = await createMessage(anthropicMessages);
    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');
    return { reply: text, citations: [], kbInjected: kbNeeded };
  }

  // Agentic tool-use loop (Deep Dive mode)
  const MAX_TOOL_ROUNDS = 10;
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    const response = await createMessage(anthropicMessages);

    if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
      const citations = extractCitations(response.content);
      return { reply: text, citations, kbInjected: kbNeeded };
    }

    anthropicMessages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name !== 'web_search') {
        console.log(`[AI Tool] Executing ${block.name} (round ${round})`);
        try {
          const result = await executeToolFn(tenantId, block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          console.error(`[AI Tool] ${block.name} error:`, err.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: err.message }),
            is_error: true,
          });
        }
      }
    }

    if (toolResults.length === 0) {
      const text = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');
      const citations = extractCitations(response.content);
      return { reply: text, citations, kbInjected: kbNeeded };
    }

    anthropicMessages.push({ role: 'user', content: toolResults });
  }

  return { reply: 'I was unable to complete the lookup — too many steps were needed. Please try a more specific question.', citations: [], kbInjected: kbNeeded };
}

// Extract citations from Anthropic web search results
function extractCitations(contentBlocks) {
  const citations = [];
  const seen = new Set();
  for (const block of contentBlocks) {
    if (block.type === 'text' && block.citations) {
      for (const cite of block.citations) {
        if (cite.type === 'web_search_result_location' && cite.url && !seen.has(cite.url)) {
          seen.add(cite.url);
          citations.push({ title: cite.title || cite.url, url: cite.url });
        }
      }
    }
  }
  return citations;
}

// Streaming chat — writes SSE events to an Express response
async function chatStream(tenantId, messages, options = {}, res) {
  const client = getClient();
  const deepDive = options.deepDive || false;
  const conversation = options.conversation || null;
  const hasImage = options.hasImage || false;

  // Keyword routing: determine if RE NXT knowledge base is needed
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const lastUserText = typeof lastUserMsg?.content === 'string'
    ? lastUserMsg.content
    : (Array.isArray(lastUserMsg?.content) ? lastUserMsg.content.filter(b => b.type === 'text').map(b => b.text).join(' ') : '');
  const { inject: kbNeeded, knowledgeBaseText } = getKnowledgeBaseInjection(lastUserText, conversation, hasImage);

  const systemPrompt = await getSystemPrompt(tenantId, knowledgeBaseText);
  const systemBlock = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];

  if (kbNeeded) {
    console.log('[Ask Fund-Raise] RE NXT knowledge base injected for this message (stream)');
  }

  const tools = [];
  if (deepDive) {
    const bbConnected = blackbaudClient.isConfigured()
      ? await blackbaudClient.getConnectionStatus(tenantId).then(s => s.connected).catch(() => false)
      : false;
    if (bbConnected) tools.push(...BB_TOOLS);
    tools.push({ type: 'web_search_20250305', name: 'web_search' });
  }

  const anthropicMessages = messages.map(m => ({ role: m.role, content: m.content }));

  function sendSSE(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Simple streaming (no tools)
  if (tools.length === 0) {
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemBlock,
      messages: anthropicMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        sendSSE('delta', { text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    logTokenUsage(finalMessage);
    const fullText = finalMessage.content.filter(b => b.type === 'text').map(b => b.text).join('');
    sendSSE('done', { text: fullText, citations: [] });
    return { reply: fullText, citations: [], kbInjected: kbNeeded };
  }

  // Deep Dive streaming with agentic loop
  const MAX_TOOL_ROUNDS = 10;
  let round = 0;

  while (round < MAX_TOOL_ROUNDS) {
    round++;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemBlock,
      messages: anthropicMessages,
      tools,
    });
    logTokenUsage(response);

    if (response.stop_reason === 'end_turn' || response.stop_reason !== 'tool_use') {
      // Final response — stream it out
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const citations = extractCitations(response.content);
      // Send it as a single flush since agentic rounds are non-streaming
      sendSSE('delta', { text });
      sendSSE('done', { text, citations });
      return { reply: text, citations, kbInjected: kbNeeded };
    }

    // Tool use round — notify client
    const toolNames = response.content.filter(b => b.type === 'tool_use').map(b => b.name);
    sendSSE('tool_use', { tools: toolNames, round });

    anthropicMessages.push({ role: 'assistant', content: response.content });

    const toolResults = [];
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name !== 'web_search') {
        console.log(`[AI Tool] Executing ${block.name} (round ${round})`);
        try {
          const result = await executeToolFn(tenantId, block.name, block.input);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          console.error(`[AI Tool] ${block.name} error:`, err.message);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: err.message }), is_error: true });
        }
      }
    }

    if (toolResults.length === 0) {
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const citations = extractCitations(response.content);
      sendSSE('delta', { text });
      sendSSE('done', { text, citations });
      return { reply: text, citations, kbInjected: kbNeeded };
    }

    anthropicMessages.push({ role: 'user', content: toolResults });
  }

  const fallback = 'I was unable to complete the lookup — too many steps were needed. Please try a more specific question.';
  sendSSE('done', { text: fallback, citations: [] });
  return { reply: fallback, citations: [], kbInjected: kbNeeded };
}

// Generate a short title from the first user message
async function generateTitle(tenantId, firstMessage) {
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 30,
      system: 'Generate a very short title (3-6 words, no quotes) summarizing this fundraising question.',
      messages: [{ role: 'user', content: firstMessage }],
    });
    const title = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .replace(/^["']|["']$/g, '')
      .substring(0, 100);
    return title || 'New conversation';
  } catch {
    // Fallback: truncate the message
    return firstMessage.substring(0, 50) + (firstMessage.length > 50 ? '...' : '');
  }
}

module.exports = { chat, chatStream, generateTitle, clearCache };
