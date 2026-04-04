/**
 * CRM Import Service
 *
 * Handles bulk import of CRM export data into PostgreSQL.
 * Strategy: delete existing tenant data, then bulk insert fresh.
 * This is correct for the weekly "select all → download → upload" workflow.
 */
const { sequelize, CrmImport, CrmGift, CrmGiftFundraiser, CrmGiftSoftCredit, CrmGiftMatch } = require('../models');
const { autoMapColumns, readCsvHeaders, streamParseCsv, parseCrmExcel } = require('./crmExcelParser');

// Batch size for INSERT statements. With 33 columns and long text values,
// each row is ~2-3KB. 25 rows ≈ 50-75KB per INSERT — well within PG limits.
const BATCH_SIZE = 25;

// ---------------------------------------------------------------------------
// Simple batch INSERT helpers (no upsert — we delete first, then insert)
// ---------------------------------------------------------------------------

async function insertGiftBatch(tenantId, gifts) {
  if (!gifts.length) return 0;
  const records = gifts.map(g => ({ tenantId, ...g }));
  await CrmGift.bulkCreate(records, { validate: false });
  return records.length;
}

async function insertFundraiserBatch(tenantId, fundraisers) {
  if (!fundraisers.length) return 0;
  // Deduplicate within batch by giftId + fundraiserName
  const seen = new Set();
  const unique = fundraisers.filter(fr => {
    const key = `${fr.giftId}|${fr.fundraiserName || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(fr => ({ tenantId, ...fr }));
  await CrmGiftFundraiser.bulkCreate(records, { validate: false });
  return records.length;
}

async function insertSoftCreditBatch(tenantId, softCredits) {
  if (!softCredits.length) return 0;
  const seen = new Set();
  const unique = softCredits.filter(sc => {
    const key = `${sc.giftId}|${sc.recipientId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(sc => ({ tenantId, ...sc }));
  await CrmGiftSoftCredit.bulkCreate(records, { validate: false });
  return records.length;
}

async function insertMatchBatch(tenantId, matches) {
  if (!matches.length) return 0;
  const seen = new Set();
  const unique = matches.filter(m => {
    const key = `${m.giftId}|${m.matchGiftId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(m => ({ tenantId, ...m }));
  await CrmGiftMatch.bulkCreate(records, { validate: false });
  return records.length;
}

// ---------------------------------------------------------------------------
// Main import: CSV (streaming) vs Excel (in-memory)
// ---------------------------------------------------------------------------

/**
 * Import a CRM export file into the database.
 * Deletes existing tenant data first, then inserts fresh.
 * CSV files are streamed row-by-row. Excel files are loaded in memory.
 */
async function importCrmFile(tenantId, userId, filePath, meta = {}) {
  const isCSV = /\.csv$/i.test(meta.fileName || filePath);

  const importLog = await CrmImport.create({
    tenantId,
    uploadedBy: userId,
    fileName: meta.fileName || 'unknown',
    fileSize: meta.fileSize || 0,
    status: 'processing',
  });

  try {
    // Step 1: Delete all existing CRM data for this tenant
    console.log(`[CRM IMPORT] Clearing existing data for tenant ${tenantId}...`);

    // Drop old unique constraints if they exist (left over from earlier deploys)
    const dropConstraints = [
      `DROP INDEX IF EXISTS "crm_gifts_tenant_id_gift_id"`,
      `DROP INDEX IF EXISTS "crm_gift_fundraisers_tenant_id_gift_id_fundraiser_name"`,
      `DROP INDEX IF EXISTS "crm_gift_soft_credits_tenant_id_gift_id_recipient_id"`,
      `DROP INDEX IF EXISTS "crm_gift_matches_tenant_id_gift_id_match_gift_id"`,
    ];
    for (const sql of dropConstraints) {
      try { await sequelize.query(sql); } catch (_) {}
    }

    await CrmGiftMatch.destroy({ where: { tenantId } });
    await CrmGiftSoftCredit.destroy({ where: { tenantId } });
    await CrmGiftFundraiser.destroy({ where: { tenantId } });
    await CrmGift.destroy({ where: { tenantId } });
    console.log(`[CRM IMPORT] Existing data cleared.`);

    // Step 2: Insert new data
    let stats;
    let giftsUpserted = 0;
    let fundraisersUpserted = 0;
    let softCreditsUpserted = 0;
    let matchesUpserted = 0;

    if (isCSV) {
      const headers = await readCsvHeaders(filePath);
      const { mapping, unmapped } = autoMapColumns(headers);

      const hasGiftId = Object.values(mapping).includes('giftId');
      if (!hasGiftId) {
        throw new Error('Could not find a "Gift ID" column. This is required to identify unique gifts.');
      }

      await importLog.update({ columnMapping: mapping });

      console.log(`[CRM IMPORT] Streaming CSV: ${meta.fileName} (${(meta.fileSize / 1024 / 1024).toFixed(1)} MB)`);
      if (unmapped.length) console.log(`[CRM IMPORT] Unmapped columns: ${unmapped.join(', ')}`);

      let lastProgressSave = Date.now();

      stats = await streamParseCsv(filePath, mapping, {
        batchSize: BATCH_SIZE,
        onGiftBatch: async (batch) => {
          giftsUpserted += await insertGiftBatch(tenantId, batch);
          if (Date.now() - lastProgressSave > 5000) {
            await importLog.update({ giftsUpserted, fundraisersUpserted, softCreditsUpserted, matchesUpserted });
            lastProgressSave = Date.now();
            console.log(`[CRM IMPORT] Progress: ${giftsUpserted} gifts, ${fundraisersUpserted} fundraisers`);
          }
        },
        onFundraiserBatch: async (batch) => { fundraisersUpserted += await insertFundraiserBatch(tenantId, batch); },
        onSoftCreditBatch: async (batch) => { softCreditsUpserted += await insertSoftCreditBatch(tenantId, batch); },
        onMatchBatch: async (batch) => { matchesUpserted += await insertMatchBatch(tenantId, batch); },
      });

    } else {
      console.log(`[CRM IMPORT] Loading Excel: ${meta.fileName}`);
      const parsed = parseCrmExcel(filePath);

      await importLog.update({ columnMapping: parsed.columnMapping, totalRows: parsed.stats.totalRows });

      const giftEntries = [...parsed.gifts.entries()];
      for (let i = 0; i < giftEntries.length; i += BATCH_SIZE) {
        const batch = giftEntries.slice(i, i + BATCH_SIZE).map(([giftId, data]) => ({ giftId, ...data }));
        giftsUpserted += await insertGiftBatch(tenantId, batch);
      }
      fundraisersUpserted += await insertFundraiserBatch(tenantId, parsed.fundraisers);
      softCreditsUpserted += await insertSoftCreditBatch(tenantId, parsed.softCredits);
      matchesUpserted += await insertMatchBatch(tenantId, parsed.matches);

      stats = parsed.stats;
    }

    await importLog.update({
      status: 'completed',
      totalRows: stats.totalRows,
      giftsUpserted,
      fundraisersUpserted,
      softCreditsUpserted,
      matchesUpserted,
      completedAt: new Date(),
    });

    console.log(`[CRM IMPORT] Completed: ${giftsUpserted} gifts, ${fundraisersUpserted} fundraisers, ${softCreditsUpserted} soft credits, ${matchesUpserted} matches`);
    return importLog;

  } catch (err) {
    const detail = err.errors ? err.errors.map(e => `${e.path}: ${e.message} (value: ${e.value})`).join('; ') : '';
    const fullMsg = detail ? `${err.message} — ${detail}` : err.message;
    console.error('[CRM IMPORT] Failed:', fullMsg);
    if (err.sql) console.error('[CRM IMPORT] SQL:', err.sql.substring(0, 500));
    await importLog.update({
      status: 'failed',
      errorMessage: fullMsg,
      completedAt: new Date(),
    });
    throw err;
  }
}

/**
 * Get import history for a tenant.
 */
async function getImportHistory(tenantId) {
  return CrmImport.findAll({
    where: { tenantId },
    order: [['uploadedAt', 'DESC']],
    limit: 20,
  });
}

/**
 * Get CRM data stats for a tenant.
 */
async function getCrmStats(tenantId) {
  const [giftCount, fundraiserCount, softCreditCount, matchCount] = await Promise.all([
    CrmGift.count({ where: { tenantId } }),
    CrmGiftFundraiser.count({ where: { tenantId } }),
    CrmGiftSoftCredit.count({ where: { tenantId } }),
    CrmGiftMatch.count({ where: { tenantId } }),
  ]);

  const latestImport = await CrmImport.findOne({
    where: { tenantId, status: 'completed' },
    order: [['completedAt', 'DESC']],
  });

  return {
    gifts: giftCount,
    fundraisers: fundraiserCount,
    softCredits: softCreditCount,
    matches: matchCount,
    lastImport: latestImport ? {
      date: latestImport.completedAt,
      fileName: latestImport.fileName,
      giftsUpserted: latestImport.giftsUpserted,
    } : null,
  };
}

module.exports = {
  importCrmFile,
  getImportHistory,
  getCrmStats,
};
