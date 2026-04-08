'use strict';

/**
 * Fix revenue overstatement and per-tenant fiscal year support.
 *
 * 1. Pledge exclusion: filters out pledge/planned-gift commitment records
 *    from revenue aggregations so only actual payments are counted.
 *
 * 2. Per-tenant fiscal year: materialized views now JOIN with the tenants
 *    table to use each tenant's configured fiscal_year_start month instead
 *    of hardcoding April (month 4).
 *
 * This migration drops all materialized views so the updated definitions
 * in crmMaterializedViews.js take effect when the app starts.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;

    // Drop all existing materialized views — they will be recreated on app
    // startup by createMaterializedViews() with pledge exclusion and
    // per-tenant fiscal year support.
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
    console.log('[Migration] Dropped materialized views for pledge-exclusion + per-tenant FY rebuild.');
  },

  async down(queryInterface) {
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
