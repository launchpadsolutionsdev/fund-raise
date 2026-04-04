/**
 * CRM Import Service
 *
 * Handles bulk upsert of parsed CRM export data into PostgreSQL.
 * Uses batch processing to handle large files (600K+ gifts).
 */
const { sequelize, CrmImport, CrmGift, CrmGiftFundraiser, CrmGiftSoftCredit, CrmGiftMatch } = require('../models');

const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Batch upsert helpers
// ---------------------------------------------------------------------------

async function batchUpsertGifts(tenantId, giftsMap, transaction) {
  const entries = [...giftsMap.entries()];
  let upserted = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const records = batch.map(([giftId, data]) => ({
      tenantId,
      giftId,
      ...data,
    }));

    await CrmGift.bulkCreate(records, {
      updateOnDuplicate: [
        'gift_amount', 'gift_code', 'gift_date', 'gift_status', 'gift_payment_type',
        'gift_acknowledge', 'gift_acknowledge_date', 'gift_receipt_amount', 'gift_batch_number',
        'gift_date_added', 'gift_date_last_changed',
        'system_record_id', 'constituent_id', 'first_name', 'last_name',
        'fund_category', 'fund_description', 'fund_id', 'fund_notes',
        'campaign_id', 'campaign_description', 'campaign_notes', 'campaign_start_date', 'campaign_end_date',
        'appeal_category', 'appeal_description', 'appeal_id', 'appeal_notes', 'appeal_start_date', 'appeal_end_date',
      ],
      transaction,
    });

    upserted += batch.length;

    if (i % 5000 === 0 && i > 0) {
      console.log(`[CRM IMPORT] Gifts: ${upserted}/${entries.length}`);
    }
  }

  return upserted;
}

async function batchUpsertFundraisers(tenantId, fundraisers, transaction) {
  if (!fundraisers.length) return 0;

  // Deduplicate by giftId + fundraiserName
  const seen = new Set();
  const unique = [];
  for (const fr of fundraisers) {
    const key = `${fr.giftId}|${fr.fundraiserName || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(fr);
    }
  }

  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE).map(fr => ({ tenantId, ...fr }));

    await CrmGiftFundraiser.bulkCreate(batch, {
      updateOnDuplicate: [
        'fundraiser_first_name', 'fundraiser_last_name', 'fundraiser_amount',
      ],
      transaction,
    });

    upserted += batch.length;
  }

  return upserted;
}

async function batchUpsertSoftCredits(tenantId, softCredits, transaction) {
  if (!softCredits.length) return 0;

  // Deduplicate by giftId + recipientId
  const seen = new Set();
  const unique = [];
  for (const sc of softCredits) {
    const key = `${sc.giftId}|${sc.recipientId || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sc);
    }
  }

  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE).map(sc => ({ tenantId, ...sc }));

    await CrmGiftSoftCredit.bulkCreate(batch, {
      updateOnDuplicate: [
        'soft_credit_amount', 'recipient_first_name', 'recipient_last_name', 'recipient_name',
      ],
      transaction,
    });

    upserted += batch.length;
  }

  return upserted;
}

async function batchUpsertMatches(tenantId, matches, transaction) {
  if (!matches.length) return 0;

  // Deduplicate by giftId + matchGiftId
  const seen = new Set();
  const unique = [];
  for (const m of matches) {
    const key = `${m.giftId}|${m.matchGiftId || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(m);
    }
  }

  let upserted = 0;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE).map(m => ({ tenantId, ...m }));

    await CrmGiftMatch.bulkCreate(batch, {
      updateOnDuplicate: [
        'match_gift_code', 'match_gift_date', 'match_receipt_amount', 'match_receipt_date',
        'match_acknowledge', 'match_acknowledge_date', 'match_constituent_code',
        'match_is_anonymous', 'match_added_by', 'match_date_added', 'match_date_last_changed',
      ],
      transaction,
    });

    upserted += batch.length;
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

/**
 * Import parsed CRM data into the database.
 *
 * @param {number} tenantId
 * @param {number} userId
 * @param {object} parsed - Output from parseCrmExport()
 * @param {object} meta - { fileName, fileSize }
 * @returns {CrmImport} The import log record
 */
async function importCrmData(tenantId, userId, parsed, meta = {}) {
  // Create import log
  const importLog = await CrmImport.create({
    tenantId,
    uploadedBy: userId,
    fileName: meta.fileName || 'unknown',
    fileSize: meta.fileSize || 0,
    status: 'processing',
    totalRows: parsed.stats.totalRows,
    columnMapping: parsed.columnMapping,
  });

  const transaction = await sequelize.transaction();

  try {
    console.log(`[CRM IMPORT] Starting import: ${parsed.stats.uniqueGifts} gifts, ${parsed.stats.fundraiserRows} fundraisers, ${parsed.stats.softCreditRows} soft credits, ${parsed.stats.matchRows} matches`);

    const giftsUpserted = await batchUpsertGifts(tenantId, parsed.gifts, transaction);
    const fundraisersUpserted = await batchUpsertFundraisers(tenantId, parsed.fundraisers, transaction);
    const softCreditsUpserted = await batchUpsertSoftCredits(tenantId, parsed.softCredits, transaction);
    const matchesUpserted = await batchUpsertMatches(tenantId, parsed.matches, transaction);

    await transaction.commit();

    await importLog.update({
      status: 'completed',
      giftsUpserted,
      fundraisersUpserted,
      softCreditsUpserted,
      matchesUpserted,
      completedAt: new Date(),
    });

    console.log(`[CRM IMPORT] Completed: ${giftsUpserted} gifts, ${fundraisersUpserted} fundraisers, ${softCreditsUpserted} soft credits, ${matchesUpserted} matches`);

    return importLog;

  } catch (err) {
    await transaction.rollback();
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
  importCrmData,
  getImportHistory,
  getCrmStats,
};
