'use strict';

/**
 * Broaden the pledge / planned-gift exclusion filter.
 *
 * The previous EXCLUDE_PLEDGE_SQL only inspected the `gift_code` column.
 * RE NXT exports also (and often *only*) carry the canonical pledge
 * designation in the `gift_type` column, e.g. gift_type='Pledge' with
 * gift_code=NULL. Rows in that shape were silently passing through the
 * filter and being summed into cash revenue — inflating dashboard totals
 * by the full pledge commitment amount.
 *
 * This migration drops every materialized view so they're recreated on the
 * next app startup using the updated EXCLUDE_PLEDGE_SQL definition in
 * src/services/crmMaterializedViews.js, which now checks BOTH gift_code
 * and gift_type.
 *
 * No data is changed; only the cached aggregates are invalidated.
 */
module.exports = {
  async up(queryInterface) {
    const seq = queryInterface.sequelize;
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
      'mv_crm_department_totals', 'mv_crm_department_monthly',
      'mv_crm_department_donors', 'mv_crm_department_gift_types',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
    console.log('[Migration] Dropped materialized views — they will rebuild with the gift_type-aware pledge filter on next app start.');
  },

  async down(queryInterface) {
    const seq = queryInterface.sequelize;
    const mvs = [
      'mv_crm_fiscal_years', 'mv_crm_fundraiser_totals', 'mv_crm_gift_types',
      'mv_crm_appeal_totals', 'mv_crm_campaign_totals', 'mv_crm_fund_totals',
      'mv_crm_donor_totals', 'mv_crm_giving_by_month', 'mv_crm_alltime_overview',
      'mv_crm_fy_overview', 'mv_crm_gift_fy',
      'mv_crm_department_totals', 'mv_crm_department_monthly',
      'mv_crm_department_donors', 'mv_crm_department_gift_types',
    ];
    for (const mv of mvs) {
      await seq.query(`DROP MATERIALIZED VIEW IF EXISTS ${mv} CASCADE`);
    }
  },
};
