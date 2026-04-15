'use strict';

/**
 * Adds a composite index on crm_gifts(tenant_id, constituent_id, gift_date)
 * for fast donor+FY rollups across every CRM analytics dashboard.
 *
 * History: migration 20260415000002 originally tried to do this with
 * CREATE INDEX CONCURRENTLY. On the production instance the build hung
 * past 20 minutes and was aborted. Postgres marks any half-built
 * CONCURRENTLY index as INVALID and leaves it in the catalog. This
 * migration cleans up that ghost index, then builds a fresh one using
 * a regular non-concurrent CREATE INDEX. On a small dataset the brief
 * AccessExclusiveLock during the build is acceptable (typically <1 min)
 * and reliably completes inside the deploy window.
 *
 * Defensive ordering:
 *   1. DROP any leftover INVALID/half-built indexes from the prior attempt
 *      (both possible names — the original migration's name and this one's).
 *   2. CREATE INDEX (no CONCURRENTLY) — runs in transaction, dependable.
 *   3. ANALYZE crm_gifts so the planner adopts the index immediately.
 */
module.exports = {
  async up(queryInterface) {
    // Step 1 — wipe any leftover indexes from prior failed attempts.
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_crm_gifts_tenant_constituent_date'
    );
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_crm_gifts_tenant_donor_date'
    );

    // Step 2 — create the index for real. No CONCURRENTLY, so the deploy
    // can rely on it completing.
    await queryInterface.sequelize.query(
      'CREATE INDEX idx_crm_gifts_tenant_donor_date ' +
      'ON crm_gifts (tenant_id, constituent_id, gift_date) ' +
      'WHERE constituent_id IS NOT NULL AND gift_date IS NOT NULL'
    );

    // Step 3 — refresh planner stats so the index is used on the next
    // query without waiting for autovacuum.
    await queryInterface.sequelize.query('ANALYZE crm_gifts');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX IF EXISTS idx_crm_gifts_tenant_donor_date'
    );
  },
};
