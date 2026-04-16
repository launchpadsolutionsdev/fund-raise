/**
 * Analytics Tools for Ask Fund-Raise
 *
 * Exposes pre-computed CRM dashboard analytics as AI-callable tools.
 * These wrap existing crmDashboardService functions so the AI can
 * access donor scoring, retention, lifecycle, anomaly detection,
 * and 20+ other analytics that previously only lived in the web dashboards.
 */
const crmDashboard = require('./crmDashboardService');
const { decorateDonorRows } = require('./donorDisplayName');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a dateRange object from a fiscal year number using the tenant's
 * configured fiscal year start month.
 */
async function buildDateRange(tenantId, fy) {
  if (!fy) return null;
  const year = Number(fy);
  if (isNaN(year)) return null;
  const fyMonth = await crmDashboard.getTenantFyMonth(tenantId);
  const m = String(fyMonth).padStart(2, '0');
  const offset = fyMonth === 1 ? 0 : 1;
  return {
    startDate: `${year - offset}-${m}-01`,
    endDate: `${year - offset + 1}-${m}-01`,
    fy: year,
    fyMonth,
  };
}

/**
 * Get the current fiscal year for a tenant.
 */
async function getCurrentFY(tenantId) {
  const fyMonth = await crmDashboard.getTenantFyMonth(tenantId);
  const now = new Date();
  const month = now.getMonth() + 1; // 1-indexed
  const year = now.getFullYear();
  // If we're past the FY start month, current FY = year + offset
  const offset = fyMonth === 1 ? 0 : 1;
  return month >= fyMonth ? year + offset : year + offset - 1;
}

/** Truncate large result sets for context efficiency. */
function truncate(arr, max = 100) {
  if (!Array.isArray(arr)) return arr;
  const truncated = arr.length > max;
  return { data: arr.slice(0, max), total: arr.length, truncated };
}

// ---------------------------------------------------------------------------
// Tool definitions (Claude API format)
// ---------------------------------------------------------------------------

const ANALYTICS_TOOLS = [
  // ---- Donor Intelligence ----
  {
    name: 'get_donor_scoring',
    description: 'Get donor scoring and segmentation using RFM analysis (Recency, Frequency, Monetary). Returns donors ranked by engagement score with segment classification. Use to answer "Who are our best donors?", "Who should we cultivate?", "Which donors are at risk?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze (e.g. 2026). Omit for all-time.' },
        segment: { type: 'string', description: 'Filter by segment: "champion", "loyal", "potential", "new", "at_risk", "lapsed"' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_donor_retention',
    description: 'Get donor retention rates across fiscal years. Shows how many donors from each year gave again the following year. Use to answer "What is our donor retention rate?", "Are we keeping our donors?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Current fiscal year for analysis (e.g. 2026). Defaults to current FY.' },
      },
    },
  },
  {
    name: 'get_retention_drilldown',
    description: 'Deep dive into retention data — shows retained, lapsed, and new donors by fiscal year with names and amounts.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Current fiscal year for analysis.' },
      },
    },
  },
  {
    name: 'get_lybunt_sybunt',
    description: 'Get LYBUNT (Last Year But Unfortunately Not This Year) and SYBUNT (Some Years But Unfortunately Not This Year) donor lists. Critical for donor re-engagement and lapsed donor outreach. Use when asked about lapsed donors, donors who stopped giving, or re-engagement targets.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Current fiscal year.' },
        category: { type: 'string', description: 'Filter: "lybunt" or "sybunt"' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_donor_lifecycle',
    description: 'Get donor lifecycle stage analysis. Classifies donors as New, Growing, Stable, Declining, At-Risk, Lapsed, or Recovered. Use for "What does our donor pipeline look like?" or "How many donors are at risk?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_donor_upgrade_downgrade',
    description: 'Analyze which donors increased (upgraded) or decreased (downgraded) their giving year-over-year. Shows movement between giving levels.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Current fiscal year for comparison.' },
        category: { type: 'string', description: 'Filter: "upgrade" or "downgrade"' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_first_time_donor_conversion',
    description: 'Track first-time donor acquisition and conversion to repeat giving. Shows how many new donors were acquired and what percentage gave again. National benchmark is ~19%.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_new_donors',
    description: 'Get a list of brand new donors — donors whose very first gift to the organization was during the specified fiscal year. They had ZERO giving history before that fiscal year. Returns donor names, first gift date, total given in the FY, number of gifts, and payment method. Use this when asked about new donor acquisition, brand new donors, or first-time donors list.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 200)' },
      },
    },
  },
  {
    name: 'get_household_giving',
    description: 'Analyze giving at the household level by consolidating related donors (spouses, family members) using soft credit data. Use when asked about household giving or family-level analysis.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },

  // ---- Fund & Campaign Intelligence ----
  {
    name: 'get_campaign_comparison',
    description: 'Side-by-side comparison of all campaigns: total raised, donor count, average gift, gift count. Use for "Which campaign is performing best?" or "Compare our campaigns."',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_appeal_comparison',
    description: 'Side-by-side comparison of all appeals: total raised, donor count, average gift, response metrics.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_appeal_detail',
    description: 'Deep dive into a specific appeal: donors, gifts, funds, performance over time.',
    input_schema: {
      type: 'object',
      properties: {
        appealId: { type: 'string', description: 'The appeal ID to look up.' },
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
      required: ['appealId'],
    },
  },
  {
    name: 'get_fund_health',
    description: 'Fund health report: ranks all funds by revenue, growth trend, donor count, and risk level. Use for "Which funds are growing?", "Which funds need attention?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },

  // ---- Performance & Trends ----
  {
    name: 'get_year_over_year',
    description: 'Full year-over-year comparison across all metrics: total raised, donors, average gift, retention, by fiscal year.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_gift_trends',
    description: 'Gift trend analysis: giving patterns over time, gift type distribution changes, seasonal patterns.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_giving_pyramid',
    description: 'Gift pyramid analysis: distribution of donors and revenue across giving levels ($1-99, $100-499, $500-999, $1000-4999, $5000+, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_fundraiser_leaderboard',
    description: 'Fundraiser performance leaderboard: ranks fundraisers by total credited amount, gift count, donor count, and goal progress.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },

  // ---- Giving Analysis ----
  {
    name: 'get_recurring_donors',
    description: 'Recurring donor analysis: count, total annualized value, average recurring gift, retention of recurring donors, frequency patterns.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
        pattern: { type: 'string', description: 'Filter by pattern: "monthly", "quarterly", "annual"' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },
  {
    name: 'get_matching_gifts',
    description: 'Matching gift analysis: total matched revenue, match rates, top matching companies, unrealized matching opportunities.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_soft_credits',
    description: 'Soft credit analysis: who receives credit for gifts, total soft credit amounts, top soft credit recipients.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_payment_methods',
    description: 'Payment method breakdown: distribution across check, credit card, ACH/EFT, cash, stock, wire, etc. Shows trends in payment preferences.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_acknowledgment_tracker',
    description: 'Acknowledgment status tracking: which gifts have been acknowledged, which are overdue, average time to acknowledge. Use for "Are our thank-you letters up to date?" or "Which gifts need acknowledgment?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
        page: { type: 'number', description: 'Page number (default 1)' },
        limit: { type: 'number', description: 'Results per page (default 50, max 100)' },
      },
    },
  },

  // ---- Department Analytics ----
  {
    name: 'get_department_analytics',
    description: 'Comprehensive department-level analytics: per-department raised, donors, average gift, top funds, campaigns, appeals, retention.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_department_detail',
    description: 'Deep dive into a specific department: full breakdown of funds, campaigns, appeals, donors, trends.',
    input_schema: {
      type: 'object',
      properties: {
        department: { type: 'string', description: 'Department name (e.g. "Annual Giving", "Major Gifts", "Events", "Direct Mail", "Legacy Giving")' },
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
      required: ['department'],
    },
  },

  // ---- AI & Anomaly Detection ----
  {
    name: 'get_anomaly_detection',
    description: 'Detect anomalies in giving data: unusual gift amounts, unexpected spikes or drops, statistical outliers, seasonal deviations. Use for "Is anything unusual in our data?" or "Are there any data quality issues?"',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_ai_recommendations',
    description: 'Get AI-generated actionable recommendations: thank-you follow-ups, re-engagement targets, upgrade candidates, recurring giving prospects, year-end push strategy.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
  {
    name: 'get_proactive_insights',
    description: 'Get auto-generated proactive insights: at-risk donors, milestone alerts, performance warnings, positive trends to celebrate.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },

  // ---- Data Quality & Geographic ----
  {
    name: 'get_data_quality_report',
    description: 'Data quality assessment: missing fields, incomplete records, potential duplicates, data integrity issues. Use when asked "How is our data quality?" or "Are there problems with our data?"',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_geographic_analytics',
    description: 'Geographic giving analysis: where donors are located, giving by city/state/postal code, local vs distance split, postal code area (FSA) analysis, average gift by city, top donors per city, and new donor acquisition trends by city. Returns state breakdown, top 30 cities, top 30 postal codes, concentration stats, local vs distance comparison, donor growth trends, top donors by city, and postal prefix heatmap data.',
    input_schema: {
      type: 'object',
      properties: {
        fiscalYear: { type: 'number', description: 'Fiscal year to analyze.' },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor — routes tool calls to the appropriate service function
// ---------------------------------------------------------------------------

const EXECUTORS = {
  // Donor Intelligence
  get_donor_scoring: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100), segment: input.segment };
    const result = await crmDashboard.getDonorScoring(tenantId, dateRange, opts);
    if (result.donors) result.donors = truncate(result.donors, 100);
    return result;
  },

  get_donor_retention: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    return crmDashboard.getDonorRetention(tenantId, fy);
  },

  get_retention_drilldown: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    const result = await crmDashboard.getRetentionDrilldown(tenantId, fy);
    // Truncate individual donor lists within drilldown
    if (result && result.years) {
      for (const year of result.years) {
        if (year.retained) year.retained = truncate(year.retained, 50);
        if (year.lapsed) year.lapsed = truncate(year.lapsed, 50);
        if (year.new_donors) year.new_donors = truncate(year.new_donors, 50);
      }
    }
    return result;
  },

  get_lybunt_sybunt: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100), category: input.category };
    return crmDashboard.getLybuntSybunt(tenantId, fy, opts);
  },

  get_donor_lifecycle: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getDonorLifecycleAnalysis(tenantId, dateRange);
  },

  get_donor_upgrade_downgrade: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100), category: input.category };
    return crmDashboard.getDonorUpgradeDowngrade(tenantId, fy, opts);
  },

  get_first_time_donor_conversion: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100) };
    return crmDashboard.getFirstTimeDonorConversion(tenantId, dateRange, opts);
  },

  get_new_donors: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 200, 200) };
    return crmDashboard.getNewDonors(tenantId, dateRange, opts);
  },

  get_household_giving: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getHouseholdGiving(tenantId, dateRange);
  },

  // Fund & Campaign Intelligence
  get_campaign_comparison: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getCampaignComparison(tenantId, dateRange);
  },

  get_appeal_comparison: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getAppealComparison(tenantId, dateRange);
  },

  get_appeal_detail: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getAppealDetail(tenantId, input.appealId, dateRange);
  },

  get_fund_health: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getFundHealthReport(tenantId, dateRange);
  },

  // Performance & Trends
  get_year_over_year: async (tenantId) => {
    return crmDashboard.getYearOverYearComparison(tenantId);
  },

  get_gift_trends: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100) };
    return crmDashboard.getGiftTrendAnalysis(tenantId, dateRange, opts);
  },

  get_giving_pyramid: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getGivingPyramid(tenantId, dateRange);
  },

  get_fundraiser_leaderboard: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getFundraiserLeaderboard(tenantId, dateRange);
  },

  // Giving Analysis
  get_recurring_donors: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100), pattern: input.pattern };
    return crmDashboard.getRecurringDonorAnalysis(tenantId, dateRange, opts);
  },

  get_matching_gifts: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getMatchingGiftAnalysis(tenantId, dateRange);
  },

  get_soft_credits: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getSoftCreditAnalysis(tenantId, dateRange);
  },

  get_payment_methods: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getPaymentMethodAnalysis(tenantId, dateRange);
  },

  get_acknowledgment_tracker: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    const opts = { page: input.page || 1, limit: Math.min(input.limit || 50, 100) };
    return crmDashboard.getAcknowledgmentTracker(tenantId, dateRange, opts);
  },

  // Department Analytics
  get_department_analytics: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getDepartmentAnalytics(tenantId, dateRange);
  },

  get_department_detail: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getDepartmentDetail(tenantId, input.department, dateRange);
  },

  // AI & Anomaly Detection
  get_anomaly_detection: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getAnomalyDetection(tenantId, dateRange);
  },

  get_ai_recommendations: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    return crmDashboard.getAIRecommendations(tenantId, fy);
  },

  get_proactive_insights: async (tenantId, input) => {
    const fy = input.fiscalYear || await getCurrentFY(tenantId);
    return crmDashboard.getProactiveInsights(tenantId, fy);
  },

  // Data Quality & Geographic
  get_data_quality_report: async (tenantId) => {
    return crmDashboard.getDataQualityReport(tenantId);
  },

  get_geographic_analytics: async (tenantId, input) => {
    const dateRange = await buildDateRange(tenantId, input.fiscalYear);
    return crmDashboard.getGeographicAnalytics(tenantId, dateRange);
  },
};

// All tool names for dispatch checking
const ANALYTICS_TOOL_NAMES = ANALYTICS_TOOLS.map(t => t.name);

async function executeAnalyticsTool(tenantId, toolName, input) {
  const executor = EXECUTORS[toolName];
  if (!executor) return { error: `Unknown analytics tool: ${toolName}` };
  try {
    const result = await executor(tenantId, input || {});
    // Stamp display_name on every donor-shaped row so the LLM never has to
    // render "Anonymous" / "Unknown" when only the constituent_id is known.
    // Mutates result in place; safe on nested shapes produced by any of the
    // 30+ analytics tools.
    return decorateDonorRows(result);
  } catch (err) {
    console.error(`[Analytics Tool] ${toolName} error:`, err.message);
    return { error: `Analytics query failed: ${err.message}` };
  }
}

module.exports = { ANALYTICS_TOOLS, ANALYTICS_TOOL_NAMES, executeAnalyticsTool };
