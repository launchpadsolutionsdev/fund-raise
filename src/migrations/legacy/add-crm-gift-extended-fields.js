'use strict';

/**
 * Add extended contact, classification, and package fields to crm_gifts.
 *
 * Run with:  node -e "require('./src/migrations/add-crm-gift-extended-fields').up()"
 */

const { sequelize } = require('../models');

async function up() {
  const columns = [
    ['gift_type',              'VARCHAR(100)'],
    ['gift_reference',         'VARCHAR(255)'],
    ['payment_type',           'VARCHAR(100)'],
    ['constituent_country',    'VARCHAR(100)'],
    ['address_type',           'VARCHAR(100)'],
    ['address_do_not_mail',    'BOOLEAN'],
    ['phone_type',             'VARCHAR(100)'],
    ['phone_do_not_call',      'BOOLEAN'],
    ['email_type',             'VARCHAR(100)'],
    ['email_do_not_email',     'BOOLEAN'],
    ['constituent_lookup_id',  'VARCHAR(100)'],
    ['constituent_name',       'VARCHAR(500)'],
    ['primary_addressee',      'VARCHAR(500)'],
    ['constituent_code',       'VARCHAR(255)'],
    ['solicit_code',           'VARCHAR(255)'],
    ['campaign_category',      'VARCHAR(255)'],
    ['package_description',    'VARCHAR(500)'],
    ['package_id',             'VARCHAR(50)'],
  ];

  for (const [col, type] of columns) {
    await sequelize.query(`ALTER TABLE crm_gifts ADD COLUMN IF NOT EXISTS ${col} ${type};`);
  }

  // Widen department column to support AI-inferred department names
  await sequelize.query(`ALTER TABLE crm_gifts ALTER COLUMN department TYPE VARCHAR(50);`);

  console.log('Added extended CRM gift columns');
}

async function down() {
  const cols = [
    'gift_type', 'gift_reference', 'payment_type',
    'constituent_country', 'address_type', 'address_do_not_mail',
    'phone_type', 'phone_do_not_call', 'email_type', 'email_do_not_email',
    'constituent_lookup_id', 'constituent_name', 'primary_addressee',
    'constituent_code', 'solicit_code', 'campaign_category',
    'package_description', 'package_id',
  ];

  for (const col of cols) {
    await sequelize.query(`ALTER TABLE crm_gifts DROP COLUMN IF EXISTS ${col};`);
  }

  console.log('Removed extended CRM gift columns');
}

module.exports = { up, down };
