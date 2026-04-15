'use strict';

/**
 * Adds a composite index on crm_gifts(tenant_id, constituent_id, gift_date).
 *
 * Production logs show that aggregations grouped by donor+fy (the LYBUNT/
 * SYBUNT analyses, both legacy and V2, plus the donor lifecycle and retention
 * dashboards) were hitting full sequential scans on the small Postgres
 * instance, taking 11-15s per query. The existing indexes on
 *   (tenant_id, gift_date)
 *   (tenant_id, constituent_id)
 * separately are useful for date-range or single-donor lookups, but neither
 * lets the planner avoid a sort when grouping by (constituent_id, gift_date).
 *
 * The composite covers both predicate AND grouping, enabling index-only scans
 * and dramatically reducing CPU on the per-donor-per-FY rollups that all the
 * lapsed-donor analytics depend on.
 *
 * Built CONCURRENTLY so this can run on a live database without blocking
 * writes. CONCURRENTLY cannot run inside a transaction, hence the explicit
 * non-transactional migration helper.
 */
module.exports = {
  // sequelize-cli will not wrap this in a transaction
  useTransaction: false,

  async up(queryInterface) {
    // Use IF NOT EXISTS in case the index was added out-of-band on a previous
    // recovery attempt. CONCURRENTLY makes the build safe under live writes.
    await queryInterface.sequelize.query(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_gifts_tenant_constituent_date ' +
      'ON crm_gifts (tenant_id, constituent_id, gift_date) ' +
      'WHERE constituent_id IS NOT NULL AND gift_date IS NOT NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'DROP INDEX CONCURRENTLY IF EXISTS idx_crm_gifts_tenant_constituent_date'
    );
  },
};
