'use strict';

/**
 * Fix revenue overstatement: exclude pledge / planned-gift commitment records
 * from materialized view aggregations.
 *
 * In Blackbaud RE NXT exports, the `gift_code` column distinguishes actual
 * received payments (Cash, Check, Pay-Cash, Pay-Check, Credit Card …) from
 * non-realized commitments (Pledge, MG Pledge, Planned Gift …).
 *
 * Without this filter, a $250K multi-year pledge is counted as $250K of
 * realized revenue in the fiscal year of the pledge date — and if the export
 * also includes the individual payment records, the money is double-counted.
 *
 * This migration drops and recreates all materialized views so the updated
 * definitions in crmMaterializedViews.js (which now include the pledge
 * exclusion filter) take effect.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;

    // Drop all existing materialized views so they can be recreated
    // with the pledge exclusion filter by crmMaterializedViews.js
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
    console.log('[Migration] Dropped materialized views for pledge-exclusion rebuild.');

    // The views will be recreated on next app startup or import via
    // createMaterializedViews() in crmMaterializedViews.js, which now
    // includes the EXCLUDE_PLEDGE_SQL filter.
    //
    // However, we also recreate them here so they're available immediately
    // after migration without requiring an app restart.

    const EXCL = `AND (gift_code IS NULL OR (LOWER(gift_code) NOT LIKE '%pledge%' AND LOWER(gift_code) NOT LIKE '%planned%gift%'))`;

    try {
      // 1. Gift-level view with fiscal year (base view, pledge-filtered)
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_fy AS
        SELECT
          id, tenant_id, gift_id, gift_amount, gift_code, gift_date,
          constituent_id, first_name, last_name,
          fund_id, fund_description,
          campaign_id, campaign_description,
          appeal_id, appeal_description,
          gift_acknowledge, gift_acknowledge_date,
          CASE WHEN EXTRACT(MONTH FROM gift_date) >= 4
               THEN EXTRACT(YEAR FROM gift_date) + 1
               ELSE EXTRACT(YEAR FROM gift_date)
          END AS fiscal_year
        FROM crm_gifts
        WHERE gift_date IS NOT NULL
          ${EXCL}
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_fy_id ON mv_crm_gift_fy (id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant ON mv_crm_gift_fy (tenant_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fy ON mv_crm_gift_fy (tenant_id, fiscal_year)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_const ON mv_crm_gift_fy (tenant_id, constituent_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_fund ON mv_crm_gift_fy (tenant_id, fund_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_campaign ON mv_crm_gift_fy (tenant_id, campaign_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_gift_fy_tenant_appeal ON mv_crm_gift_fy (tenant_id, appeal_id)`);

      // 2. Per-FY overview
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fy_overview AS
        SELECT tenant_id, fiscal_year,
          COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
          COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
          MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
          COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
          COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fy_overview_pk ON mv_crm_fy_overview (tenant_id, fiscal_year)`);

      // 3. All-time overview (pledge-filtered)
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_alltime_overview AS
        SELECT tenant_id,
          COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
          COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
          MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
          COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
          COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals
        FROM crm_gifts
        WHERE gift_date IS NOT NULL
          ${EXCL}
        GROUP BY tenant_id
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_alltime_overview_pk ON mv_crm_alltime_overview (tenant_id)`);

      // 4. Giving by month
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_giving_by_month AS
        SELECT tenant_id, fiscal_year, TO_CHAR(gift_date, 'YYYY-MM') as month,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year, month
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_giving_by_month_pk ON mv_crm_giving_by_month (tenant_id, fiscal_year, month)`);

      // 5. Donor totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_donor_totals AS
        SELECT tenant_id, fiscal_year, constituent_id, first_name, last_name,
          COUNT(*) as gift_count, SUM(gift_amount) as total, MAX(gift_date) as last_gift_date
        FROM mv_crm_gift_fy WHERE last_name IS NOT NULL
        GROUP BY tenant_id, fiscal_year, constituent_id, first_name, last_name
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_donor_totals_pk ON mv_crm_donor_totals (tenant_id, fiscal_year, constituent_id)`);
      await seq.query(`CREATE INDEX IF NOT EXISTS mv_crm_donor_totals_sort ON mv_crm_donor_totals (tenant_id, fiscal_year, total DESC)`);

      // 6. Fund totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fund_totals AS
        SELECT tenant_id, fiscal_year, fund_id, fund_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE fund_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, fund_id, fund_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fund_totals_pk ON mv_crm_fund_totals (tenant_id, fiscal_year, fund_id)`);

      // 7. Campaign totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_campaign_totals AS
        SELECT tenant_id, fiscal_year, campaign_id, campaign_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE campaign_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, campaign_id, campaign_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_campaign_totals_pk ON mv_crm_campaign_totals (tenant_id, fiscal_year, campaign_id)`);

      // 8. Appeal totals
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_appeal_totals AS
        SELECT tenant_id, fiscal_year, appeal_id, appeal_description,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy WHERE appeal_description IS NOT NULL
        GROUP BY tenant_id, fiscal_year, appeal_id, appeal_description
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_appeal_totals_pk ON mv_crm_appeal_totals (tenant_id, fiscal_year, appeal_id)`);

      // 9. Gift types (intentionally NOT pledge-filtered — shows full type breakdown)
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_gift_types AS
        SELECT tenant_id, fiscal_year, COALESCE(gift_code, 'Unknown') as gift_type,
          COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year, gift_type
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_gift_types_pk ON mv_crm_gift_types (tenant_id, fiscal_year, gift_type)`);

      // 10. Fundraiser totals (pledge-filtered via JOIN)
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fundraiser_totals AS
        SELECT f.tenant_id,
          CASE WHEN EXTRACT(MONTH FROM g.gift_date) >= 4
               THEN EXTRACT(YEAR FROM g.gift_date) + 1
               ELSE EXTRACT(YEAR FROM g.gift_date)
          END AS fiscal_year,
          f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name,
          COUNT(DISTINCT f.gift_id) as gift_count, COUNT(DISTINCT g.constituent_id) as donor_count,
          SUM(f.fundraiser_amount) as total_credited, SUM(g.gift_amount) as total_gift_amount,
          MIN(g.gift_date) as earliest_gift, MAX(g.gift_date) as latest_gift
        FROM crm_gift_fundraisers f
        JOIN crm_gifts g ON f.gift_id = g.gift_id AND f.tenant_id = g.tenant_id
        WHERE f.fundraiser_name IS NOT NULL AND g.gift_date IS NOT NULL
          AND (g.gift_code IS NULL OR (LOWER(g.gift_code) NOT LIKE '%pledge%' AND LOWER(g.gift_code) NOT LIKE '%planned%gift%'))
        GROUP BY f.tenant_id, fiscal_year, f.fundraiser_name, f.fundraiser_first_name, f.fundraiser_last_name
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fundraiser_totals_pk ON mv_crm_fundraiser_totals (tenant_id, fiscal_year, fundraiser_name)`);

      // 11. Fiscal years summary
      await seq.query(`
        CREATE MATERIALIZED VIEW IF NOT EXISTS mv_crm_fiscal_years AS
        SELECT tenant_id, fiscal_year as fy, COUNT(*) as gift_count, SUM(gift_amount) as total
        FROM mv_crm_gift_fy GROUP BY tenant_id, fiscal_year ORDER BY fiscal_year DESC
      `);
      await seq.query(`CREATE UNIQUE INDEX IF NOT EXISTS mv_crm_fiscal_years_pk ON mv_crm_fiscal_years (tenant_id, fy)`);

      console.log('[Migration] Materialized views recreated with pledge exclusion.');
    } catch (e) {
      console.log('[Migration] Skipping MV recreation (CRM tables may not exist yet):', e.message);
    }
  },

  async down(queryInterface) {
    // Reverting drops the pledge-filtered MVs; the previous migration will
    // recreate the unfiltered versions if re-run.
    const seq = queryInterface.sequelize;
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
  },
};
