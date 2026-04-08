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

    // Check if crm_gifts table exists before attempting MV rebuild
    const [tables] = await sequelize.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = 'crm_gifts' LIMIT 1"
    );
    if (tables.length === 0) {
      console.log('[Rebuild MVs] Skipped — crm_gifts table does not exist yet.');
      return;
    }

    await dropMaterializedViews();
    await createMaterializedViews();

    console.log('[Rebuild MVs] Done — all materialized views created.');
  } catch (err) {
    // Log the FULL error so we can diagnose failures in Render build logs
    console.error('[Rebuild MVs] FAILED:', err.message);
    if (err.sql) console.error('[Rebuild MVs] SQL:', err.sql.substring(0, 500));
    console.error(err.stack);
    // Non-fatal — app will fall back to raw queries
  } finally {
    await sequelize.close();
  }
}

main();
