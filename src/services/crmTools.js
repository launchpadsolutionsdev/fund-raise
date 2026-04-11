/**
 * CRM Query Tools for Ask Fund-Raise
 *
 * Provides AI-callable tools that run SQL queries against the local
 * CRM gift data (imported from RE NXT). Completely separate from
 * the Blackbaud SKY API tools and snapshot data.
 */
const { sequelize, CrmGift, CrmGiftFundraiser, CrmGiftSoftCredit, CrmGiftMatch } = require('../models');
const { QueryTypes } = require('sequelize');
const { EXCLUDE_PLEDGE_SQL } = require('./crmMaterializedViews');
const EXCL = EXCLUDE_PLEDGE_SQL;

// ---------------------------------------------------------------------------
// Tool definitions (Claude API format)
// ---------------------------------------------------------------------------

const CRM_TOOLS = [
  {
    name: 'query_crm_gifts',
    description: `Run a SQL query against the organization's CRM gift data. Available tables:
- crm_gifts: Core gift records (gift_id, gift_amount, gift_code, gift_date, gift_status, gift_type, gift_payment_type, payment_type, gift_acknowledge, gift_acknowledge_date, gift_receipt_amount, gift_batch_number, gift_reference, gift_date_added, gift_date_last_changed, system_record_id, constituent_id, first_name, last_name, constituent_email, constituent_phone, constituent_address, constituent_city, constituent_state, constituent_zip, constituent_country, constituent_name, constituent_lookup_id, constituent_code, constituent_type, primary_addressee, address_type, address_do_not_mail, phone_type, phone_do_not_call, email_type, email_do_not_email, fund_category, fund_description, fund_id, fund_notes, campaign_id, campaign_description, campaign_category, campaign_notes, campaign_start_date, campaign_end_date, appeal_category, appeal_description, appeal_id, appeal_notes, appeal_start_date, appeal_end_date, package_description, package_id, department, solicit_code, tenant_id)
- crm_gift_fundraisers: Fundraiser attribution per gift (gift_id, fundraiser_name, fundraiser_first_name, fundraiser_last_name, fundraiser_amount, tenant_id)
- crm_gift_soft_credits: Soft credit recipients per gift (gift_id, soft_credit_amount, recipient_first_name, recipient_id, recipient_last_name, recipient_name, tenant_id)
- crm_gift_matches: Matching gifts (gift_id, match_gift_id, match_gift_code, match_gift_date, match_receipt_amount, match_receipt_date, match_acknowledge, match_acknowledge_date, match_constituent_code, match_is_anonymous, match_added_by, match_date_added, match_date_last_changed, tenant_id)

Always filter by tenant_id. Use JOINs on gift_id + tenant_id to connect tables. Use LIMIT to keep results manageable. Only SELECT queries are allowed.`,
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A SELECT query. Must include WHERE tenant_id = :tenantId. Use :tenantId as the parameter placeholder.',
        },
        description: {
          type: 'string',
          description: 'Brief description of what this query answers.',
        },
      },
      required: ['sql', 'description'],
    },
  },
  {
    name: 'get_crm_summary',
    description: 'Get a high-level summary of the CRM data: total gifts, total amount, date range, top funds, top campaigns, fundraiser count, etc. Use this as a starting point before writing specific queries.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

async function executeQueryCrmGifts(tenantId, input) {
  const { sql, description } = input;

  // Safety: only allow SELECT
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT')) {
    return { error: 'Only SELECT queries are allowed.' };
  }

  // Block dangerous keywords
  const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'COPY', 'PG_READ_FILE', 'PG_WRITE_FILE', 'LO_IMPORT', 'LO_EXPORT'];
  for (const kw of blocked) {
    // Check for keyword as a standalone word (not part of a column name)
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(sql)) {
      return { error: `${kw} statements are not allowed.` };
    }
  }

  // Block multiple statements (semicolons) to prevent statement injection
  if (sql.replace(/;[\s]*$/, '').includes(';')) {
    return { error: 'Multiple SQL statements are not allowed.' };
  }

  // Only allow queries against known CRM tables
  const allowedTables = ['crm_gifts', 'crm_gift_fundraisers', 'crm_gift_soft_credits', 'crm_gift_matches'];
  const fromMatches = sql.match(/\bFROM\s+(\w+)/gi) || [];
  const joinMatches = sql.match(/\bJOIN\s+(\w+)/gi) || [];
  const tableRefs = [...fromMatches, ...joinMatches].map(m => m.split(/\s+/).pop().toLowerCase());
  for (const table of tableRefs) {
    if (!allowedTables.includes(table)) {
      return { error: `Access to table "${table}" is not allowed. Only CRM tables are queryable.` };
    }
  }

  try {
    const results = await sequelize.query(sql, {
      replacements: { tenantId },
      type: QueryTypes.SELECT,
      raw: true,
    });

    // Limit result size to avoid blowing up context
    const limited = results.slice(0, 200);
    const truncated = results.length > 200;

    return {
      description,
      row_count: results.length,
      truncated,
      data: limited,
    };
  } catch (err) {
    return { error: `Query failed: ${err.message}` };
  }
}

async function executeGetCrmSummary(tenantId) {
  try {
    const [totals] = await sequelize.query(`
      SELECT
        COUNT(*) as total_gifts,
        COALESCE(SUM(gift_amount), 0) as total_amount,
        MIN(gift_date) as earliest_gift,
        MAX(gift_date) as latest_gift,
        COUNT(DISTINCT constituent_id) as unique_donors,
        COUNT(DISTINCT fund_id) as unique_funds,
        COUNT(DISTINCT campaign_id) as unique_campaigns,
        COUNT(DISTINCT appeal_id) as unique_appeals
      FROM crm_gifts WHERE tenant_id = :tenantId ${EXCL}
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const topFunds = await sequelize.query(`
      SELECT fund_description, fund_id, COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND fund_description IS NOT NULL ${EXCL}
      GROUP BY fund_description, fund_id ORDER BY total DESC LIMIT 10
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const topCampaigns = await sequelize.query(`
      SELECT campaign_description, campaign_id, COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND campaign_description IS NOT NULL ${EXCL}
      GROUP BY campaign_description, campaign_id ORDER BY total DESC LIMIT 10
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const topAppeals = await sequelize.query(`
      SELECT appeal_description, appeal_id, COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND appeal_description IS NOT NULL ${EXCL}
      GROUP BY appeal_description, appeal_id ORDER BY total DESC LIMIT 10
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const fundraiserCount = await sequelize.query(`
      SELECT COUNT(DISTINCT fundraiser_name) as count
      FROM crm_gift_fundraisers WHERE tenant_id = :tenantId
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const topFundraisers = await sequelize.query(`
      SELECT fundraiser_name, COUNT(*) as gift_count, SUM(fundraiser_amount) as total
      FROM crm_gift_fundraisers WHERE tenant_id = :tenantId AND fundraiser_name IS NOT NULL
      GROUP BY fundraiser_name ORDER BY total DESC LIMIT 10
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    const giftsByYear = await sequelize.query(`
      SELECT EXTRACT(YEAR FROM gift_date) as year, COUNT(*) as gift_count, SUM(gift_amount) as total
      FROM crm_gifts WHERE tenant_id = :tenantId AND gift_date IS NOT NULL ${EXCL}
      GROUP BY year ORDER BY year DESC LIMIT 10
    `, { replacements: { tenantId }, type: QueryTypes.SELECT });

    return {
      overview: totals,
      top_funds: topFunds,
      top_campaigns: topCampaigns,
      top_appeals: topAppeals,
      fundraiser_count: fundraiserCount[0]?.count || 0,
      top_fundraisers: topFundraisers,
      gifts_by_year: giftsByYear,
    };
  } catch (err) {
    return { error: `Summary failed: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function executeCrmTool(tenantId, toolName, input) {
  switch (toolName) {
    case 'query_crm_gifts':
      return executeQueryCrmGifts(tenantId, input);
    case 'get_crm_summary':
      return executeGetCrmSummary(tenantId);
    default:
      return { error: `Unknown CRM tool: ${toolName}` };
  }
}

module.exports = {
  CRM_TOOLS,
  executeCrmTool,
};
