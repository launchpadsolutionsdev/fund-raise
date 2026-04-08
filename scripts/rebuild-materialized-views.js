#!/usr/bin/env node
/**
 * Rebuild materialized views with current definitions.
 *
 * Run after migrations during the build step so the pledge-exclusion
 * and per-tenant fiscal year logic takes effect before the app starts.
 * This avoids race conditions with health checks and incoming requests.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const { sequelize } = require('../src/models');
  const { dropMaterializedViews, createMaterializedViews } = require('../src/services/crmMaterializedViews');

  try {
    await sequelize.authenticate();
    console.log('[Rebuild MVs] Connected to database.');

    await dropMaterializedViews();
    await createMaterializedViews();

    console.log('[Rebuild MVs] Done.');
  } catch (err) {
    console.error('[Rebuild MVs] Failed:', err.message);
    // Non-fatal — CRM tables may not exist yet on first deploy
  } finally {
    await sequelize.close();
  }
}

main();
