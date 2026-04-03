const Anthropic = require('@anthropic-ai/sdk');
const {
  Snapshot, DepartmentSummary, GiftTypeBreakdown,
  SourceBreakdown, FundBreakdown, RawGift,
} = require('../models');
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

function buildSystemPrompt(context) {
  if (!context.hasData) {
    return `You are "Ask Fund-Raise", the AI assistant for Fund-Raise, a philanthropy dashboard for the Thunder Bay Regional Health Sciences Foundation (TBRHSF). No fundraising data has been uploaded yet. Let the user know they need to upload data first via the Upload Data page.`;
  }

  return `You are "Ask Fund-Raise", the AI assistant built into Fund-Raise, the philanthropy dashboard for the Thunder Bay Regional Health Sciences Foundation (TBRHSF).

You have access to the organization's fundraising data as of the latest snapshot date: ${context.snapshotDate}.

## Your Role
- Answer questions about fundraising performance, donor trends, department progress, and campaign effectiveness.
- Provide data-driven insights and actionable recommendations.
- Compare departments, identify strengths and areas for improvement.
- Help users understand their data without needing to navigate multiple dashboards.

## Formatting Guidelines
- Use clear, concise language appropriate for fundraising professionals.
- Format currency values with $ and commas (e.g., $1,234,567).
- Format percentages to one decimal place (e.g., 78.5%).
- Use markdown for structure when helpful (bold for emphasis, lists for comparisons).
- Keep responses focused and actionable. Don't overwhelm with every data point unless asked.

## Current Data (Snapshot: ${context.snapshotDate})

### Organization Overview
- Total Raised: $${context.overview.totalRaised.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Combined Goal: $${context.overview.combinedGoal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Gap to Goal: $${context.overview.gapToGoal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
- Overall Progress: ${context.overview.overallPct.toFixed(1)}%
- Total Gifts: ${context.overview.totalGifts.toLocaleString()}
- Unique Donors: ${context.enhanced.donorCount.toLocaleString()}
${context.enhanced.largestGift ? `- Largest Gift: $${context.enhanced.largestGift.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} from ${context.enhanced.largestGift.donor} (${DEPT_LABELS[context.enhanced.largestGift.department] || context.enhanced.largestGift.department})` : ''}

### Donor Concentration
- Top 10% of donors contribute: ${context.crossDepartment.donorConcentration.top10_pct ? parseFloat(context.crossDepartment.donorConcentration.top10_pct).toFixed(1) : 'N/A'}% of revenue
- Top 20% of donors contribute: ${context.crossDepartment.donorConcentration.top20_pct ? parseFloat(context.crossDepartment.donorConcentration.top20_pct).toFixed(1) : 'N/A'}% of revenue
- Total unique donors: ${context.crossDepartment.donorConcentration.total_donors || 'N/A'}

### Top 10 Donors (Organization-Wide)
${(context.enhanced.topDonors || []).map((d, i) => `${i + 1}. ${d.primaryAddressee}: $${d.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${d.gifts} gifts)`).join('\n')}

### Top Appeals/Campaigns
${(context.enhanced.topAppeals || []).map((a, i) => `${i + 1}. ${a.appealId}: $${a.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${a.donors} donors, ${a.gifts} gifts)`).join('\n')}

### Gift Size Distribution
${(context.enhanced.giftDistribution || []).map(b => `- ${b.bucket}: ${b.count} gifts totaling $${b.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join('\n')}

### Cross-Department Donors (giving to 2+ departments)
${(context.crossDepartment.crossDeptDonors || []).map((d, i) => `${i + 1}. ${d.primaryAddressee}: $${d.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} across ${d.dept_count} departments (${d.departments.join(', ')})`).join('\n')}

${context.projection ? `### Year-End Projection
- Current Total: $${context.projection.currentTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- Projected Year-End: $${context.projection.projectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${context.projection.projectedPct.toFixed(1)}% of goal)
- Daily Run Rate: $${context.projection.dailyRate.toLocaleString('en-US', { minimumFractionDigits: 2 })}/day
- Required Daily to Meet Goal: $${context.projection.requiredDaily.toLocaleString('en-US', { minimumFractionDigits: 2 })}/day
- Days Remaining: ${context.projection.daysRemaining}
- On Track: ${context.projection.onTrack ? 'Yes' : 'No'}` : ''}

${context.trendSummary ? `### Trend Summary
- Tracking ${context.trendSummary.snapshotCount} snapshots from ${context.trendSummary.firstDate} to ${context.trendSummary.lastDate}
- Growth over period: $${context.trendSummary.growth.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}

### Department Details

${Object.entries(context.departments).map(([slug, dept]) => {
  if (!dept) return '';
  let section = `#### ${dept.label}
- Total Raised: $${dept.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- Goal: $${dept.goal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
- Progress: ${dept.pctToGoal.toFixed(1)}%
- Total Gifts: ${dept.totalGifts.toLocaleString()}
- Individual Gift Records: ${dept.rawGiftCount.toLocaleString()}`;

  if (dept.thirdPartyAmount) {
    section += `\n- Third-Party Events Revenue: $${dept.thirdPartyAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (Goal: $${dept.thirdPartyGoal.toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
  }
  if (dept.avgGift) {
    section += `\n- Average Gift: $${dept.avgGift.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }
  if (dept.newExpectancies != null) {
    section += `\n- New Expectancies: ${dept.newExpectancies}`;
  }
  if (dept.openEstates != null) {
    section += `\n- Open Estates: ${dept.openEstates}`;
  }
  if (dept.channelMix) {
    section += `\n- Channel Mix: One-time: ${dept.channelMix.onetime}, Recurring: ${dept.channelMix.recurring} (${dept.channelMix.recurringRate.toFixed(1)}%), Online: ${dept.channelMix.online} (${dept.channelMix.onlineRate.toFixed(1)}%), Mailed: ${dept.channelMix.mailed}`;
  }

  if (dept.giftTypes && dept.giftTypes.length) {
    section += `\n- Gift Types: ${dept.giftTypes.map(g => `${g.type}: $${g.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${g.pct.toFixed(1)}%)`).join(', ')}`;
  }
  if (dept.sources && dept.sources.length) {
    section += `\n- Sources: ${dept.sources.map(s => `${s.source}: $${s.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${s.pct.toFixed(1)}%)`).join(', ')}`;
  }
  if (dept.topDonors && dept.topDonors.length) {
    section += `\n- Top Donors: ${dept.topDonors.map(d => `${d.name}: $${d.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join(', ')}`;
  }
  if (dept.topAppeals && dept.topAppeals.length) {
    section += `\n- Top Appeals: ${dept.topAppeals.map(a => `${a.appeal}: $${a.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${a.donors} donors)`).join(', ')}`;
  }
  if (dept.topFunds && dept.topFunds.length) {
    section += `\n- Top Funds: ${dept.topFunds.map(f => `${f.name}: $${f.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${f.totalCount} gifts)`).join(', ')}`;
  }

  return section;
}).filter(Boolean).join('\n\n')}

## Important Notes
- Only reference data that is actually available above. If data is missing or N/A, acknowledge it.
- When asked about something not in the data, say so honestly.
- You are an assistant for fundraising professionals — be helpful, insightful, and action-oriented.`;
}

async function getSystemPrompt(tenantId) {
  let prompt = getCachedPrompt(tenantId);
  if (!prompt) {
    const context = await gatherContext(tenantId);
    prompt = buildSystemPrompt(context);
    setCachedPrompt(tenantId, prompt);
  }
  return prompt;
}

async function chat(tenantId, messages) {
  const client = getClient();
  const systemPrompt = await getSystemPrompt(tenantId);

  // Convert messages to Anthropic format
  const anthropicMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: anthropicMessages,
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return { reply: text };
}

// Generate a short title from the first user message
async function generateTitle(tenantId, firstMessage) {
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

module.exports = { chat, generateTitle, clearCache };
