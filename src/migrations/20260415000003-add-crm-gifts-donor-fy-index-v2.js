'use strict';

/**
 * Adds a composite index on crm_gifts(tenant_id, constituent_id, gift_date)
 * for fast donor+FY rollups across every CRM analytics dashboard.
 *
 * Why a second migration: the previous attempt
 *   20260415000002-add-crm-gifts-donor-fy-index.js
 * used CREATE INDEX CONCURRENTLY, which Postgres refuses to run inside a
 * transaction. sequelize-cli wraps every migration in a transaction by
 * default and the `useTransaction: false` opt-out used in v7+ is silently
 * ignored on the v6 CLI installed here. Net effect: the index was never
 * built but the migration row was somehow recorded in SequelizeMeta, so
 * subsequent deploys say "schema up to date" while the slow queries
 * continue.
 *
 * This migration uses a regular CREATE INDEX (no CONCURRENTLY) which is
 * fully transaction-safe. On a small instance and a non-production
 * workload, the brief AccessExclusiveLock during the build (typically
 * <30s) is acceptable and dramatically beats leaving the dashboard
 * unusable. We also analyse the table afterwards so the planner picks up
 * the new index immediately.
 */
module.exports = {
  async up(queryInterface) {
    // Belt-and-braces: drop the previous attempt's index if it somehow
    // exists from a recovery path.
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_crm_gifts_tenant_constituent_date'
    );

    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_donor_date ' +
      'ON crm_gifts (tenant_id, constituent_id, gift_date) ' +
      'WHERE constituent_id IS NOT NULL AND gift_date IS NOT NULL'
    );

    // Refresh planner stats so the new index is used straight away on
    // subsequent queries.
    await queryInterface.sequelize.query('ANALYZE crm_gifts');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_crm_gifts_tenant_donor_date'
    );
  },
};
