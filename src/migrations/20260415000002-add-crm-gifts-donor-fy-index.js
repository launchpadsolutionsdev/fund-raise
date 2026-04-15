'use strict';

/**
 * NEUTRALISED.
 *
 * Original intent was to add the donor+FY composite index using CREATE INDEX
 * CONCURRENTLY. On the production instance this hung indefinitely (>15 min)
 * during a deploy because CONCURRENTLY does two full table scans and waits
 * for in-flight snapshots, which on a small CPU + sizeable crm_gifts table
 * is impractical for a deploy gate.
 *
 * Replaced with a no-op so sequelize-cli can mark this migration ID as
 * applied and move on to migration 20260415000003, which does the real work
 * with a regular (non-concurrent) CREATE INDEX. The brief table lock on a
 * small dataset is far preferable to a deploy that never completes.
 *
 * Migration 003 also drops any half-built index that may have been left
 * behind by an aborted CONCURRENTLY run, so this no-op is safe to apply
 * regardless of prior state.
 */
module.exports = {
  async up() {
    // Intentionally empty — see migration 20260415000003 for the real work.
  },

  async down() {
    // Nothing to undo.
  },
};
