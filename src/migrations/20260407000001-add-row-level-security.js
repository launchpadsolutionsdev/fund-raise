'use strict';

/**
 * Enable PostgreSQL Row-Level Security on all tenant-scoped tables.
 *
 * Each table with a tenant_id column gets:
 *   1. RLS enabled
 *   2. FORCE RLS (so even the table owner is subject to policies)
 *   3. A policy that filters rows by current_setting('app.current_tenant_id')
 *
 * The application middleware sets app.current_tenant_id at the start of each
 * request using SET LOCAL inside a transaction. This ensures tenant isolation
 * even if application code forgets a WHERE tenant_id = ... clause.
 */

const TENANT_TABLES = [
  'actions',
  'blackbaud_tokens',
  'conversations',
  'crm_gifts',
  'crm_gift_fundraisers',
  'crm_gift_matches',
  'crm_gift_soft_credits',
  'crm_imports',
  'department_goals',
  'fundraiser_goals',
  'kudos',
  'milestones',
  'posts',
  'quick_notes',
  'snapshots',
  'tenant_data_configs',
  'users',
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const table of TENANT_TABLES) {
      await queryInterface.sequelize.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await queryInterface.sequelize.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);

      // Allow full access when tenant context is set and matches.
      // NULLIF guards against ''::int cast error when the setting reverts to empty string.
      await queryInterface.sequelize.query(`
        CREATE POLICY tenant_isolation_${table} ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
      `);

      // Allow access when no tenant context is set (NULL or empty).
      // Needed for: session store queries, Passport deserializeUser, login flow, health checks.
      await queryInterface.sequelize.query(`
        CREATE POLICY bypass_when_no_tenant_${table} ON ${table}
          USING (NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL)
      `);
    }
  },

  async down(queryInterface) {
    for (const table of TENANT_TABLES.reverse()) {
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS tenant_isolation_${table} ON ${table}`);
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS bypass_when_no_tenant_${table} ON ${table}`);
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  },
};
