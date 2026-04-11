/**
 * CRM Materialized Views
 *
 * Pre-computes heavy aggregate queries into materialized views so the
 * CRM dashboard loads instantly even on a 0.1 CPU / 256MB RAM Postgres instance.
 *
 * Views are refreshed after each CRM import completes (~30-60s extra).
 * CONCURRENTLY refresh requires a unique index, so we add those too.
 */
const { sequelize } = require('../models');

// ---------------------------------------------------------------------------
// Pledge / planned-gift exclusion
// ---------------------------------------------------------------------------
// In Blackbaud RE NXT exports the `gift_code` column distinguishes between
// actual received payments (Cash, Check, Pay-Cash, Pay-Check, Credit Card …)
// and non-realized commitments (Pledge, MG Pledge, Planned Gift …).
//
// When both the commitment record AND the payment records are present in the
// export, counting the commitment inflates revenue (the full multi-year pledge
// amount is summed into one fiscal year). Even when only the commitment is
// present, counting the full pledge amount in the pledge year overstates
// realized revenue.
//
// This filter excludes pledge / planned-gift commitment rows from revenue
// aggregations while keeping actual payments (Pay-Cash, etc.) intact.
// ---------------------------------------------------------------------------
const EXCLUDE_PLEDGE_SQL = ` AND (gift_code IS NULL OR (LOWER(gift_code) NOT LIKE '%pledge%' AND LOWER(gift_code) NOT LIKE '%planned%gift%'))`;

// ---------------------------------------------------------------------------
// Fiscal-year SQL helpers
// ---------------------------------------------------------------------------
// Generates a SQL CASE expression that computes the fiscal year from a date
// column, using a configurable start month. When start month is January (1),
// fiscal year equals the calendar year; otherwise gifts from month M onward
// belong to the NEXT calendar year's FY.
// ---------------------------------------------------------------------------
function fyCaseSql(fyMonth, dateCol = 'gift_date') {
  const m = Number(fyMonth) || 4;
  if (m === 1) return `EXTRACT(YEAR FROM ${dateCol})`;
  return `CASE WHEN EXTRACT(MONTH FROM ${dateCol}) >= ${m} THEN EXTRACT(YEAR FROM ${dateCol}) + 1 ELSE EXTRACT(YEAR FROM ${dateCol}) END`;
}

// Fiscal-month ordinal: maps calendar month to position within the fiscal year
// (e.g. for April start: Apr=1, May=2, …, Mar=12)
function fyMonthSql(fyMonth, dateCol = 'gift_date') {
  const m = Number(fyMonth) || 4;
  if (m === 1) return `EXTRACT(MONTH FROM ${dateCol})::int`;
  return `CASE WHEN EXTRACT(MONTH FROM ${dateCol}) >= ${m} THEN EXTRACT(MONTH FROM ${dateCol}) - ${m - 1} ELSE EXTRACT(MONTH FROM ${dateCol}) + ${13 - m} END`;
}

const MV_NAMES = [
  'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
  'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
  'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
  'mv_crm_fy_overview', 'mv_crm_gift_fy',
  'mv_crm_department_totals', 'mv_crm_department_monthly',
  'mv_crm_department_donors', 'mv_crm_department_gift_types',
];

// Drop all MVs (reverse dependency order) so sequelize.sync({ alter: true }) can modify columns
async function dropMaterializedViews() {
  console.log('[CRM MV] Dropping materialized views for schema sync...');
  // Cancel any stuck queries from previous deploys that might block DROP
  try {
    await sequelize.query(`
      SELECT pg_cancel_backend(pid)
      FROM pg_stat_activity
      WHERE state = 'active' AND pid != pg_backend_pid()
        AND query ILIKE '%crm_gifts%' AND query NOT ILIKE '%pg_stat_activity%'
        AND NOW() - query_start > interval '30 seconds'
    `);
  } catch (e) { /* ignore if no permission */ }
  for (const name of MV_NAMES) {
    await sequelize.query(`DROP MATERIALIZED VIEW IF EXISTS ${name} CASCADE`);
  }
  console.log('[CRM MV] Materialized views dropped.');
}

// ---------------------------------------------------------------------------
// Create all materialized views (idempotent — safe to call on every startup)
// ---------------------------------------------------------------------------
async function createMaterializedViews() {
  console.log('[CRM MV] Creating materialized views...');

  // Set a long statement timeout for MV creation — these queries scan the entire table
  await sequelize.query(`SET statement_timeout = '300s'`);

  // 1. Gift-level view with fiscal year pre-computed (per-tenant FY start)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_fy AS
    SELECT
      g.id, g.tenant_id, g.gift_id, g.gift_amount, g.gift_code, g.gift_date,
      g.constituent_id, g.first_name, g.last_name,
      g.fund_id, g.fund_description,
      g.campaign_id, g.campaign_description,
      g.appeal_id, g.appeal_description,
      g.gift_acknowledge, g.gift_acknowledge_date,
      g.department,
      CASE WHEN COALESCE(t.fiscal_year_start, 4) > 1
                AND EXTRACT(MONTH FROM g.gift_date) >= COALESCE(t.fiscal_year_start, 4)
           THEN EXTRACT(YEAR FROM g.gift_date) + 1
           ELSE EXTRACT(YEAR FROM g.gift_date)
      END AS fiscal_year
    FROM crm_gifts g
    JOIN tenants t ON g.tenant_id = t.id
    WHERE g.gift_date IS NOT NULL
      ${EXCLUDE_PLEDGE_SQL.replace(/gift_code/g, 'g.gift_code')}
  `);

  // Unique index for CONCURRENTLY refresh
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_fy_id ON mv_crm_gift_fy (id)
  `);

  // Covering indexes for common query patterns
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant ON mv_crm_gift_fy (tenant_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fy ON mv_crm_gift_fy (tenant_id, fiscal_year)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_const ON mv_crm_gift_fy (tenant_id, constituent_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fund ON mv_crm_gift_fy (tenant_id, fund_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_campaign ON mv_crm_gift_fy (tenant_id, campaign_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_appeal ON mv_crm_gift_fy (tenant_id, appeal_id)`);

  // 2. Per-FY aggregate overview (one row per tenant per FY)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fy_overview AS
    SELECT
      tenant_id, fiscal_year,
      COUNT(*) as total_gifts,
      COALESCE(SUM(gift_amount), 0) as total_raised,
      COALESCE(AVG(gift_amount), 0) as avg_gift,
      COALESCE(MAX(gift_amount), 0) as largest_gift,
      MIN(gift_date) as earliest_date,
      MAX(gift_date) as latest_date,
      COUNT(DISTINCT constituent_id) as unique_donors,
      COUNT(DISTINCT fund_id) as unique_funds,
      COUNT(DISTINCT campaign_id) as unique_campaigns,
      COUNT(DISTINCT appeal_id) as unique_appeals
    FROM mv_crm_gift_fy
    GROUP BY tenant_id, fiscal_year
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fy_overview_pk ON mv_crm_fy_overview (tenant_id, fiscal_year)`);

  // 3. All-time aggregate overview (one row per tenant)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_alltime_overview AS
    SELECT
      tenant_id,
      COUNT(*) as total_gifts,
      COALESCE(SUM(gift_amount), 0) as total_raised,
      COALESCE(AVG(gift_amount), 0) as avg_gift,
      COALESCE(MAX(gift_amount), 0) as largest_gift,
      MIN(gift_date) as earliest_date,
      MAX(gift_date) as latest_date,
      COUNT(DISTINCT constituent_id) as unique_donors,
      COUNT(DISTINCT fund_id) as unique_funds,
      COUNT(DISTINCT campaign_id) as unique_campaigns,
      COUNT(DISTINCT appeal_id) as unique_appeals
    FROM crm_gifts
    WHERE gift_date IS NOT NULL
      ${EXCLUDE_PLEDGE_SQL}
    GROUP BY tenant_id
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_alltime_overview_pk ON mv_crm_alltime_overview (tenant_id)`);

  // 4. Giving by month (pre-aggregated)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_giving_by_month AS
    SELECT
      tenant_id, fiscal_year,
      TO_CHAR(gift_date, 'YYYY-MM') as month,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    GROUP BY tenant_id, fiscal_year, month
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_giving_by_month_pk ON mv_crm_giving_by_month (tenant_id, fiscal_year, month)`);

  // 5. Top donors (per tenant per FY)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_donor_totals AS
    SELECT
      tenant_id, fiscal_year,
      constituent_id, first_name, last_name,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total,
      MAX(gift_date) as last_gift_date
    FROM mv_crm_gift_fy
    WHERE last_name IS NOT NULL
    GROUP BY tenant_id, fiscal_year, constituent_id, first_name, last_name
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_donor_totals_pk ON mv_crm_donor_totals (tenant_id, fiscal_year, constituent_id)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS mv_crm_donor_totals_sort ON mv_crm_donor_totals (tenant_id, fiscal_year, total DESC)`);

  // 6. Top funds
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fund_totals AS
    SELECT
      tenant_id, fiscal_year,
      fund_id, fund_description,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    WHERE fund_description IS NOT NULL
    GROUP BY tenant_id, fiscal_year, fund_id, fund_description
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fund_totals_pk ON mv_crm_fund_totals (tenant_id, fiscal_year, fund_id)`);

  // 7. Top campaigns
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_campaign_totals AS
    SELECT
      tenant_id, fiscal_year,
      campaign_id, campaign_description,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    WHERE campaign_description IS NOT NULL
    GROUP BY tenant_id, fiscal_year, campaign_id, campaign_description
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_campaign_totals_pk ON mv_crm_campaign_totals (tenant_id, fiscal_year, campaign_id)`);

  // 8. Top appeals
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_appeal_totals AS
    SELECT
      tenant_id, fiscal_year,
      appeal_id, appeal_description,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    WHERE appeal_description IS NOT NULL
    GROUP BY tenant_id, fiscal_year, appeal_id, appeal_description
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_appeal_totals_pk ON mv_crm_appeal_totals (tenant_id, fiscal_year, appeal_id)`);

  // 9. Gifts by type — intentionally UNFILTERED so pledge/planned gift
  //    totals remain visible in the "Giving by Type" breakdown chart.
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_types AS
    SELECT
      g.tenant_id,
      CASE WHEN COALESCE(t.fiscal_year_start, 4) > 1
                AND EXTRACT(MONTH FROM g.gift_date) >= COALESCE(t.fiscal_year_start, 4)
           THEN EXTRACT(YEAR FROM g.gift_date) + 1
           ELSE EXTRACT(YEAR FROM g.gift_date)
      END AS fiscal_year,
      COALESCE(g.gift_code, 'Unknown') as gift_type,
      COUNT(*) as gift_count,
      SUM(g.gift_amount) as total
    FROM crm_gifts g
    JOIN tenants t ON g.tenant_id = t.id
    WHERE g.gift_date IS NOT NULL
    GROUP BY g.tenant_id, 2, COALESCE(g.gift_code, 'Unknown')
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_types_pk ON mv_crm_gift_types (tenant_id, fiscal_year, gift_type)`);

  // 10. Fundraiser leaderboard (pre-aggregated join, per-tenant FY)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fundraiser_totals AS
    SELECT
      f.tenant_id,
      CASE WHEN COALESCE(t.fiscal_year_start, 4) > 1
                AND EXTRACT(MONTH FROM g.gift_date) >= COALESCE(t.fiscal_year_start, 4)
           THEN EXTRACT(YEAR FROM g.gift_date) + 1
           ELSE EXTRACT(YEAR FROM g.gift_date)
      END AS fiscal_year,
      f.fundraiser_name,
      f.fundraiser_first_name,
      f.fundraiser_last_name,
      COUNT(DISTINCT f.gift_id) as gift_count,
      COUNT(DISTINCT g.constituent_id) as donor_count,
      SUM(f.fundraiser_amount) as total_credited,
      SUM(g.gift_amount) as total_gift_amount,
      MIN(g.gift_date) as earliest_gift,
      MAX(g.gift_date) as latest_gift
    FROM crm_gift_fundraisers f
    JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
    JOIN tenants t ON f.tenant_id = t.id
    WHERE f.fundraiser_name IS NOT NULL AND g.gift_date IS NOT NULL
      ${EXCLUDE_PLEDGE_SQL.replace(/gift_code/g, 'g.gift_code')}
    GROUP BY f.tenant_id, 2, f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fundraiser_totals_pk ON mv_crm_fundraiser_totals (tenant_id, fiscal_year, fundraiser_name)`);

  // 11. Fiscal year summary (for the FY picker)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fiscal_years AS
    SELECT
      tenant_id,
      fiscal_year as fy,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    GROUP BY tenant_id, fiscal_year
    ORDER BY fiscal_year DESC
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fiscal_years_pk ON mv_crm_fiscal_years (tenant_id, fy)`);

  // 12. Department-level summary (one row per tenant, department, FY)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_department_totals AS
    SELECT
      tenant_id, fiscal_year, department,
      COUNT(*) as gift_count,
      SUM(gift_amount) as total,
      AVG(gift_amount) as avg_gift,
      COUNT(DISTINCT constituent_id) as donor_count,
      TO_CHAR(MIN(gift_date), 'YYYY-MM-DD') as earliest_date,
      TO_CHAR(MAX(gift_date), 'YYYY-MM-DD') as latest_date
    FROM mv_crm_gift_fy
    WHERE department IS NOT NULL
    GROUP BY tenant_id, fiscal_year, department
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_dept_totals_pk ON mv_crm_department_totals (tenant_id, fiscal_year, department)`);

  // 13. Department monthly giving
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_department_monthly AS
    SELECT
      tenant_id, department, TO_CHAR(gift_date, 'YYYY-MM') as month,
      SUM(gift_amount) as total, COUNT(*) as gift_count
    FROM mv_crm_gift_fy
    WHERE department IS NOT NULL AND gift_date IS NOT NULL
    GROUP BY tenant_id, department, TO_CHAR(gift_date, 'YYYY-MM')
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_dept_monthly_pk ON mv_crm_department_monthly (tenant_id, department, month)`);

  // 14. Department top donors (top 10 per department per FY)
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_department_donors AS
    SELECT * FROM (
      SELECT
        tenant_id, fiscal_year, department, constituent_id,
        MIN(first_name) as first_name, MIN(last_name) as last_name,
        COUNT(*) as gift_count, SUM(gift_amount) as total,
        ROW_NUMBER() OVER (PARTITION BY tenant_id, fiscal_year, department ORDER BY SUM(gift_amount) DESC) as rn
      FROM mv_crm_gift_fy
      WHERE department IS NOT NULL
      GROUP BY tenant_id, fiscal_year, department, constituent_id
    ) ranked WHERE rn <= 10
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_dept_donors_pk ON mv_crm_department_donors (tenant_id, fiscal_year, department, rn)`);

  // 15. Department gift type breakdown
  await sequelize.query(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_department_gift_types AS
    SELECT
      tenant_id, fiscal_year, department,
      COALESCE(gift_code, 'Unknown') as gift_type,
      COUNT(*) as gift_count, SUM(gift_amount) as total
    FROM mv_crm_gift_fy
    WHERE department IS NOT NULL
    GROUP BY tenant_id, fiscal_year, department, COALESCE(gift_code, 'Unknown')
  `);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_dept_gift_types_pk ON mv_crm_department_gift_types (tenant_id, fiscal_year, department, gift_type)`);

  // Reset statement timeout to default
  await sequelize.query(`SET statement_timeout = '20s'`);

  console.log('[CRM MV] Materialized views created successfully.');
}

// ---------------------------------------------------------------------------
// Refresh all materialized views (called after CRM import)
// Uses CONCURRENTLY so reads aren't blocked during refresh.
// ---------------------------------------------------------------------------
async function refreshMaterializedViews() {
  console.log('[CRM MV] Refreshing materialized views...');
  const start = Date.now();

  // Must refresh the base gift view first since others depend on it
  await sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_gift_fy');

  // Then refresh all dependent views in parallel
  await Promise.all([
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_fy_overview'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_alltime_overview'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_giving_by_month'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_donor_totals'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_fund_totals'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_campaign_totals'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_appeal_totals'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_gift_types'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_fundraiser_totals'),
    sequelize.query('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_crm_fiscal_years'),
  ]);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[CRM MV] Refresh complete in ${elapsed}s`);
}

module.exports = { createMaterializedViews, refreshMaterializedViews, dropMaterializedViews, EXCLUDE_PLEDGE_SQL, fyCaseSql, fyMonthSql };
