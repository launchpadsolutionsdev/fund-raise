#!/usr/bin/env node

/**
 * Widen VARCHAR(50) columns to VARCHAR(255) in CRM tables.
 * Runs as part of the build process to ensure columns are wide enough
 * for RE NXT data regardless of migration state.
 */

const { Sequelize } = require('sequelize');
require('dotenv').config();

async function widenColumns() {
  let dbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/foundation_dashboard';
  if (dbUrl.startsWith('postgres://')) {
    dbUrl = dbUrl.replace('postgres://', 'postgresql://');
  }

  const opts = { dialect: 'postgres', logging: false };
  if (process.env.NODE_ENV === 'production') {
    opts.dialectOptions = { ssl: { require: true, rejectUnauthorized: false } };
  }

  const sequelize = new Sequelize(dbUrl, opts);

  const alterations = [
    'ALTER TABLE crm_gifts ALTER COLUMN gift_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN gift_status TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN system_record_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN constituent_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN constituent_phone TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN fund_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN campaign_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN appeal_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN package_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gifts ALTER COLUMN department TYPE VARCHAR(255)',
    'ALTER TABLE crm_gift_fundraisers ALTER COLUMN gift_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gift_soft_credits ALTER COLUMN gift_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gift_soft_credits ALTER COLUMN recipient_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gift_matches ALTER COLUMN gift_id TYPE VARCHAR(255)',
    'ALTER TABLE crm_gift_matches ALTER COLUMN match_gift_id TYPE VARCHAR(255)',
  ];

  try {
    await sequelize.authenticate();
    let changed = 0;
    for (const sql of alterations) {
      try {
        await sequelize.query(sql);
        changed++;
      } catch (err) {
        // Column might not exist yet or already be the right type
        if (!err.message.includes('does not exist')) {
          console.warn('[Widen] Skipped:', err.message);
        }
      }
    }
    console.log(`[Widen] Done — ${changed} columns widened to VARCHAR(255).`);
    await sequelize.close();
  } catch (err) {
    console.error('[Widen] Error:', err.message);
    await sequelize.close();
    process.exit(1);
  }
}

widenColumns();
