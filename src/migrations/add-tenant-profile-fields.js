'use strict';

/**
 * Add organization profile fields to the tenants table.
 *
 * Run with:  node -e "require('./src/migrations/add-tenant-profile-fields').up()"
 */

const { sequelize } = require('../models');

async function up() {
  const qi = sequelize.getQueryInterface();

  const columns = [
    ['logo_path',         'VARCHAR(255)'],
    ['mission_statement', 'TEXT'],
    ['address_line1',     'VARCHAR(255)'],
    ['address_line2',     'VARCHAR(255)'],
    ['city',              'VARCHAR(100)'],
    ['state',             'VARCHAR(50)'],
    ['zip',               'VARCHAR(20)'],
    ['phone',             'VARCHAR(30)'],
    ['website',           'VARCHAR(255)'],
    ['ein',               'VARCHAR(20)'],
    ['fiscal_year_start', 'INTEGER DEFAULT 4'],
  ];

  for (const [col, type] of columns) {
    await sequelize.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ${col} ${type};`);
  }

  console.log('✓ Added tenant profile columns');
}

async function down() {
  const cols = [
    'logo_path', 'mission_statement', 'address_line1', 'address_line2',
    'city', 'state', 'zip', 'phone', 'website', 'ein', 'fiscal_year_start',
  ];

  for (const col of cols) {
    await sequelize.query(`ALTER TABLE tenants DROP COLUMN IF EXISTS ${col};`);
  }

  console.log('✓ Removed tenant profile columns');
}

module.exports = { up, down };
