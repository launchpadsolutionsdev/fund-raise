'use strict';

/**
 * Fix RLS policies to handle empty-string cast safely.
 *
 * The original policies used:
 *   current_setting('app.current_tenant_id', true)::int
 *
 * When the setting is an empty string '' (e.g., after SET LOCAL reverts on a
 * pooled connection), ''::int throws a cast error, crashing queries in
 * deserializeUser and other pre-middleware code.
 *
 * Fix: wrap with NULLIF(..., '') so empty strings become NULL before the cast.
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
      // Drop old policies
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS tenant_isolation_${table} ON ${table}`);
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS bypass_when_no_tenant_${table} ON ${table}`);

      // Recreate with NULLIF guard
      await queryInterface.sequelize.query(`
        CREATE POLICY tenant_isolation_${table} ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::int)
      `);

      await queryInterface.sequelize.query(`
        CREATE POLICY bypass_when_no_tenant_${table} ON ${table}
          USING (NULLIF(current_setting('app.current_tenant_id', true), '') IS NULL)
      `);
    }
  },

  async down(queryInterface) {
    // Revert to original policies (without NULLIF)
    for (const table of TENANT_TABLES) {
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS tenant_isolation_${table} ON ${table}`);
      await queryInterface.sequelize.query(`DROP POLICY IF EXISTS bypass_when_no_tenant_${table} ON ${table}`);

      await queryInterface.sequelize.query(`
        CREATE POLICY tenant_isolation_${table} ON ${table}
          USING (tenant_id = current_setting('app.current_tenant_id', true)::int)
          WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::int)
      `);

      await queryInterface.sequelize.query(`
        CREATE POLICY bypass_when_no_tenant_${table} ON ${table}
          USING (current_setting('app.current_tenant_id', true) IS NULL OR
                 current_setting('app.current_tenant_id', true) = '')
      `);
    }
  },
};
