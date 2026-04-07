'use strict';

/**
 * Create the tenant_data_configs table for onboarding data privacy and AI inference.
 *
 * Run with:  node -e "require('./src/migrations/add-tenant-data-config').up()"
 */

const { sequelize } = require('../models');

async function up() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS tenant_data_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

      include_gift_core BOOLEAN DEFAULT TRUE,
      include_constituent_contact BOOLEAN DEFAULT TRUE,
      include_campaigns BOOLEAN DEFAULT TRUE,
      include_appeals BOOLEAN DEFAULT TRUE,
      include_funds BOOLEAN DEFAULT TRUE,
      include_fundraiser_credits BOOLEAN DEFAULT TRUE,
      include_soft_credits BOOLEAN DEFAULT TRUE,
      include_matching_gifts BOOLEAN DEFAULT TRUE,
      include_constituent_codes BOOLEAN DEFAULT TRUE,

      fiscal_year_start_month INTEGER DEFAULT 4,

      detected_departments JSONB,
      department_classification_rules JSONB,

      onboarding_step INTEGER DEFAULT 1,
      onboarding_completed_at TIMESTAMPTZ,

      query_instructions JSONB,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log('Created tenant_data_configs table');
}

async function down() {
  await sequelize.query('DROP TABLE IF EXISTS tenant_data_configs;');
  console.log('Dropped tenant_data_configs table');
}

module.exports = { up, down };
