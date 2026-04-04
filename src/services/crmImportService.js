/**
 * CRM Import Service
 *
 * Handles bulk upsert of parsed CRM export data into PostgreSQL.
 * Uses streaming for CSV files to stay under memory limits.
 * Commits in batches (no single giant transaction).
 */
const { sequelize, CrmImport, CrmGift, CrmGiftFundraiser, CrmGiftSoftCredit, CrmGiftMatch } = require('../models');
const { autoMapColumns, readCsvHeaders, streamParseCsv, parseCrmExcel } = require('./crmExcelParser');

const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Batch upsert helpers (no transaction — each batch is its own commit)
// ---------------------------------------------------------------------------

const GIFT_UPDATE_COLS = [
  'gift_amount', 'gift_code', 'gift_date', 'gift_status', 'gift_payment_type',
  'gift_acknowledge', 'gift_acknowledge_date', 'gift_receipt_amount', 'gift_batch_number',
  'gift_date_added', 'gift_date_last_changed',
  'system_record_id', 'constituent_id', 'first_name', 'last_name',
  'fund_category', 'fund_description', 'fund_id', 'fund_notes',
  'campaign_id', 'campaign_description', 'campaign_notes', 'campaign_start_date', 'campaign_end_date',
  'appeal_category', 'appeal_description', 'appeal_id', 'appeal_notes', 'appeal_start_date', 'appeal_end_date',
];

async function upsertGiftBatch(tenantId, gifts) {
  if (!gifts.length) return 0;
  const records = gifts.map(g => ({ tenantId, ...g }));
  await CrmGift.bulkCreate(records, { updateOnDuplicate: GIFT_UPDATE_COLS });
  return records.length;
}

async function upsertFundraiserBatch(tenantId, fundraisers) {
  if (!fundraisers.length) return 0;
  // Deduplicate within batch
  const seen = new Set();
  const unique = fundraisers.filter(fr => {
    const key = `${fr.giftId}|${fr.fundraiserName || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(fr => ({ tenantId, ...fr }));
  await CrmGiftFundraiser.bulkCreate(records, {
    updateOnDuplicate: ['fundraiser_first_name', 'fundraiser_last_name', 'fundraiser_amount'],
  });
  return records.length;
}

async function upsertSoftCreditBatch(tenantId, softCredits) {
  if (!softCredits.length) return 0;
  const seen = new Set();
  const unique = softCredits.filter(sc => {
    const key = `${sc.giftId}|${sc.recipientId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(sc => ({ tenantId, ...sc }));
  await CrmGiftSoftCredit.bulkCreate(records, {
    updateOnDuplicate: ['soft_credit_amount', 'recipient_first_name', 'recipient_last_name', 'recipient_name'],
  });
  return records.length;
}

async function upsertMatchBatch(tenantId, matches) {
  if (!matches.length) return 0;
  const seen = new Set();
  const unique = matches.filter(m => {
    const key = `${m.giftId}|${m.matchGiftId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(m => ({ tenantId, ...m }));
  await CrmGiftMatch.bulkCreate(records, {
    updateOnDuplicate: [
      'match_gift_code', 'match_gift_date', 'match_receipt_amount', 'match_receipt_date',
      'match_acknowledge', 'match_acknowledge_date', 'match_constituent_code',
      'match_is_anonymous', 'match_added_by', 'match_date_added', 'match_date_last_changed',
    ],
  });
  return records.length;
}

// ---------------------------------------------------------------------------
// Main import: CSV (streaming) vs Excel (in-memory)
// ---------------------------------------------------------------------------

/**
 * Import a CRM export file into the database.
 * CSV files are streamed row-by-row. Excel files are loaded in memory.
 *
 * @param {number} tenantId
 * @param {number} userId
 * @param {string} filePath
 * @param {object} meta - { fileName, fileSize }
 * @returns {CrmImport}
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
    let stats;
    let giftsUpserted = 0;
    let fundraisersUpserted = 0;
    let softCreditsUpserted = 0;
    let matchesUpserted = 0;

    if (isCSV) {
      // --- Streaming CSV import ---
      const headers = await readCsvHeaders(filePath);
      const { mapping, unmapped } = autoMapColumns(headers);

      const hasGiftId = Object.values(mapping).includes('giftId');
      if (!hasGiftId) {
        throw new Error('Could not find a "Gift ID" column. This is required to identify unique gifts.');
      }

      await importLog.update({ columnMapping: mapping });

      console.log(`[CRM IMPORT] Streaming CSV: ${meta.fileName} (${(meta.fileSize / 1024 / 1024).toFixed(1)} MB)`);
      if (unmapped.length) console.log(`[CRM IMPORT] Unmapped columns: ${unmapped.join(', ')}`);

      stats = await streamParseCsv(filePath, mapping, {
        batchSize: BATCH_SIZE,
        onGiftBatch: async (batch) => { giftsUpserted += await upsertGiftBatch(tenantId, batch); },
        onFundraiserBatch: async (batch) => { fundraisersUpserted += await upsertFundraiserBatch(tenantId, batch); },
        onSoftCreditBatch: async (batch) => { softCreditsUpserted += await upsertSoftCreditBatch(tenantId, batch); },
        onMatchBatch: async (batch) => { matchesUpserted += await upsertMatchBatch(tenantId, batch); },
      });

    } else {
      // --- In-memory Excel import ---
      console.log(`[CRM IMPORT] Loading Excel: ${meta.fileName}`);
      const parsed = parseCrmExcel(filePath);

      await importLog.update({ columnMapping: parsed.columnMapping, totalRows: parsed.stats.totalRows });

      // Process gifts in batches
      const giftEntries = [...parsed.gifts.entries()];
      for (let i = 0; i < giftEntries.length; i += BATCH_SIZE) {
        const batch = giftEntries.slice(i, i + BATCH_SIZE).map(([giftId, data]) => ({ giftId, ...data }));
        giftsUpserted += await upsertGiftBatch(tenantId, batch);
      }
      fundraisersUpserted += await upsertFundraiserBatch(tenantId, parsed.fundraisers);
      softCreditsUpserted += await upsertSoftCreditBatch(tenantId, parsed.softCredits);
      matchesUpserted += await upsertMatchBatch(tenantId, parsed.matches);

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
    console.error('[CRM IMPORT] Failed:', err.message);
    await importLog.update({
      status: 'failed',
      errorMessage: err.message,
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
