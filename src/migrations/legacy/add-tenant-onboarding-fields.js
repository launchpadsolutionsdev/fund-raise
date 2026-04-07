'use strict';

/**
 * Add onboarding tracking fields to the tenants table.
 *
 * Run with:  node -e "require('./src/migrations/add-tenant-onboarding-fields').up()"
 */

const { sequelize } = require('../models');

async function up() {
  const columns = [
    ['onboarding_completed', 'BOOLEAN DEFAULT FALSE'],
    ['onboarding_step',      'INTEGER DEFAULT 1'],
  ];

  for (const [col, type] of columns) {
    await sequelize.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ${col} ${type};`);
  }

  console.log('Added tenant onboarding columns');
}

async function down() {
  const cols = ['onboarding_completed', 'onboarding_step'];

  for (const col of cols) {
    await sequelize.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS ${col};`);
  }

  console.log('Removed tenant onboarding columns');
}

module.exports = { up, down };
