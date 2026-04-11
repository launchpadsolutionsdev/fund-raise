/**
 * CRM Import Service
 *
 * Handles bulk import of CRM export data into PostgreSQL.
 * Strategy: UPSERT (INSERT ... ON CONFLICT ... DO UPDATE) within a
 * single transaction. If anything fails, the transaction rolls back
 * and existing data is untouched.
 *
 * After upsert completes, any gift IDs present in the database but
 * NOT in the import file are soft-flagged for cleanup (deleted within
 * the same transaction).
 */
const { sequelize, CrmImport, CrmGift, CrmGiftFundraiser, CrmGiftSoftCredit, CrmGiftMatch, TenantDataConfig } = require('../models');
const { autoMapColumns, readCsvHeaders, streamParseCsv, parseCrmExcel } = require('./crmExcelParser');
const {
  clearCrmCache, getCrmOverview, getFiscalYears, getGivingByMonth,
  getTopDonors, getTopFunds, getTopCampaigns, getTopAppeals,
  getDepartmentAnalytics, getDepartmentExtras,
} = require('./crmDashboardService');
const { refreshMaterializedViews } = require('./crmMaterializedViews');
const { classifyDepartment } = require('./crmDepartmentClassifier');
const emailService = require('./emailService');

// Batch size for INSERT statements. With 33 columns and long text values,
// each row is ~2-3KB. 25 rows ≈ 50-75KB per INSERT — well within PG limits.
const BATCH_SIZE = 25;

// Fields to update on conflict for each table
const GIFT_UPDATE_FIELDS = [
  'giftAmount', 'giftCode', 'giftDate', 'giftStatus', 'giftPaymentType',
  'giftAcknowledge', 'giftAcknowledgeDate', 'giftReceiptAmount', 'giftBatchNumber',
  'giftDateAdded', 'giftDateLastChanged', 'giftType', 'giftReference', 'paymentType',
  'systemRecordId', 'constituentId', 'firstName', 'lastName',
  'constituentEmail', 'constituentPhone', 'constituentAddress',
  'constituentCity', 'constituentState', 'constituentZip', 'constituentCountry',
  'addressType', 'addressDoNotMail', 'phoneType', 'phoneDoNotCall',
  'emailType', 'emailDoNotEmail', 'constituentLookupId', 'constituentName',
  'primaryAddressee', 'constituentCode', 'constituentType', 'solicitCode',
  'fundCategory', 'fundDescription', 'fundId', 'fundNotes',
  'campaignId', 'campaignDescription', 'campaignNotes', 'campaignStartDate', 'campaignEndDate',
  'campaignCategory', 'appealCategory', 'appealDescription', 'appealId', 'appealNotes',
  'appealStartDate', 'appealEndDate', 'packageDescription', 'packageId', 'department',
];

const FUNDRAISER_UPDATE_FIELDS = [
  'fundraiserFirstName', 'fundraiserLastName', 'fundraiserAmount',
];

const SOFT_CREDIT_UPDATE_FIELDS = [
  'softCreditAmount', 'recipientFirstName', 'recipientLastName', 'recipientName',
];

const MATCH_UPDATE_FIELDS = [
  'matchGiftCode', 'matchGiftDate', 'matchReceiptAmount', 'matchReceiptDate',
  'matchAcknowledge', 'matchAcknowledgeDate', 'matchConstituentCode',
  'matchIsAnonymous', 'matchAddedBy', 'matchDateAdded', 'matchDateLastChanged',
];

// ---------------------------------------------------------------------------
// Batch UPSERT helpers
// ---------------------------------------------------------------------------

async function upsertGiftBatch(tenantId, gifts, tenantRules, transaction) {
  if (!gifts.length) return 0;
  const { classifyDepartmentByTenantRules } = require('./departmentInferenceService');
  const records = gifts.map(g => ({
    tenantId,
    ...g,
    department: (tenantRules && tenantRules.length > 0)
      ? classifyDepartmentByTenantRules(g, tenantRules)
      : classifyDepartment(g),
  }));
  await CrmGift.bulkCreate(records, {
    validate: false,
    updateOnDuplicate: GIFT_UPDATE_FIELDS,
    conflictAttributes: ['tenantId', 'giftId'],
    transaction,
  });
  return records.length;
}

async function upsertFundraiserBatch(tenantId, fundraisers, transaction) {
  if (!fundraisers.length) return 0;
  const seen = new Set();
  const unique = fundraisers.filter(fr => {
    const key = `${fr.giftId}|${fr.fundraiserName || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const records = unique.map(fr => ({ tenantId, ...fr }));
  await CrmGiftFundraiser.bulkCreate(records, {
    validate: false,
    updateOnDuplicate: FUNDRAISER_UPDATE_FIELDS,
    conflictAttributes: ['tenantId', 'giftId', 'fundraiserName'],
    transaction,
  });
  return records.length;
}

async function upsertSoftCreditBatch(tenantId, softCredits, transaction) {
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
    validate: false,
    updateOnDuplicate: SOFT_CREDIT_UPDATE_FIELDS,
    conflictAttributes: ['tenantId', 'giftId', 'recipientId'],
    transaction,
  });
  return records.length;
}

async function upsertMatchBatch(tenantId, matches, transaction) {
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
    validate: false,
    updateOnDuplicate: MATCH_UPDATE_FIELDS,
    conflictAttributes: ['tenantId', 'giftId', 'matchGiftId'],
    transaction,
  });
  return records.length;
}

// ---------------------------------------------------------------------------
// Main import: CSV (streaming) vs Excel (in-memory)
// ---------------------------------------------------------------------------

/**
 * Import a CRM export file into the database.
 * Uses UPSERT within a single transaction — existing data is preserved
 * until the import succeeds, and the tenant never sees zero data.
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
    // Load tenant-specific classification rules (if any)
    let tenantRules = null;
    try {
      const dataConfig = await TenantDataConfig.findOne({ where: { tenantId } });
      if (dataConfig && dataConfig.departmentClassificationRules) {
        tenantRules = dataConfig.departmentClassificationRules;
        console.log(`[CRM IMPORT] Using tenant-specific classification rules (${tenantRules.length} rules)`);
      }
    } catch (_) {
      // No TenantDataConfig — will use default classifier
    }

    // Track all gift IDs seen in the import for stale-record cleanup
    const importedGiftIds = new Set();

    // Run the entire import in a single transaction
    await sequelize.transaction(async (transaction) => {
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

        await importLog.update({ columnMapping: mapping }, { transaction });

        console.log(`[CRM IMPORT] Streaming CSV: ${meta.fileName} (${(meta.fileSize / 1024 / 1024).toFixed(1)} MB)`);
        if (unmapped.length) console.log(`[CRM IMPORT] Unmapped columns: ${unmapped.join(', ')}`);

        let lastProgressSave = Date.now();

        stats = await streamParseCsv(filePath, mapping, {
          batchSize: BATCH_SIZE,
          onGiftBatch: async (batch) => {
            batch.forEach(g => { if (g.giftId) importedGiftIds.add(g.giftId); });
            giftsUpserted += await upsertGiftBatch(tenantId, batch, tenantRules, transaction);
            if (Date.now() - lastProgressSave > 5000) {
              await importLog.update({ giftsUpserted, fundraisersUpserted, softCreditsUpserted, matchesUpserted }, { transaction });
              lastProgressSave = Date.now();
              console.log(`[CRM IMPORT] Progress: ${giftsUpserted} gifts, ${fundraisersUpserted} fundraisers`);
            }
          },
          onFundraiserBatch: async (batch) => { fundraisersUpserted += await upsertFundraiserBatch(tenantId, batch, transaction); },
          onSoftCreditBatch: async (batch) => { softCreditsUpserted += await upsertSoftCreditBatch(tenantId, batch, transaction); },
          onMatchBatch: async (batch) => { matchesUpserted += await upsertMatchBatch(tenantId, batch, transaction); },
        });

      } else {
        console.log(`[CRM IMPORT] Loading Excel: ${meta.fileName}`);
        const parsed = parseCrmExcel(filePath);

        await importLog.update({ columnMapping: parsed.columnMapping, totalRows: parsed.stats.totalRows }, { transaction });

        const giftEntries = [...parsed.gifts.entries()];
        for (let i = 0; i < giftEntries.length; i += BATCH_SIZE) {
          const batch = giftEntries.slice(i, i + BATCH_SIZE).map(([giftId, data]) => ({ giftId, ...data }));
          batch.forEach(g => { if (g.giftId) importedGiftIds.add(g.giftId); });
          giftsUpserted += await upsertGiftBatch(tenantId, batch, tenantRules, transaction);
        }
        fundraisersUpserted += await upsertFundraiserBatch(tenantId, parsed.fundraisers, transaction);
        softCreditsUpserted += await upsertSoftCreditBatch(tenantId, parsed.softCredits, transaction);
        matchesUpserted += await upsertMatchBatch(tenantId, parsed.matches, transaction);

        stats = parsed.stats;
      }

      // Clean up records that were in the database but NOT in the new import
      // (i.e., deleted in Blackbaud since last import)
      if (importedGiftIds.size > 0) {
        const { Op } = require('sequelize');
        const staleGiftIds = importedGiftIds.size > 0
          ? await CrmGift.findAll({
              where: { tenantId, giftId: { [Op.notIn]: [...importedGiftIds] } },
              attributes: ['giftId'],
              transaction,
              raw: true,
            })
          : [];

        if (staleGiftIds.length > 0) {
          const staleIds = staleGiftIds.map(g => g.giftId);
          console.log(`[CRM IMPORT] Removing ${staleIds.length} stale gift(s) no longer in source...`);
          await CrmGiftMatch.destroy({ where: { tenantId, giftId: staleIds }, transaction });
          await CrmGiftSoftCredit.destroy({ where: { tenantId, giftId: staleIds }, transaction });
          await CrmGiftFundraiser.destroy({ where: { tenantId, giftId: staleIds }, transaction });
          await CrmGift.destroy({ where: { tenantId, giftId: staleIds }, transaction });
        }
      }

      await importLog.update({
        status: 'completed',
        totalRows: stats.totalRows,
        giftsUpserted,
        fundraisersUpserted,
        softCreditsUpserted,
        matchesUpserted,
        completedAt: new Date(),
      }, { transaction });

      console.log(`[CRM IMPORT] Completed: ${giftsUpserted} gifts, ${fundraisersUpserted} fundraisers, ${softCreditsUpserted} soft credits, ${matchesUpserted} matches`);
    });
    // --- Transaction committed successfully ---

    // Invalidate dashboard cache so fresh data shows immediately
    clearCrmCache(tenantId);

    // Refresh materialized views with new data (runs in background, non-blocking)
    console.log('[CRM IMPORT] Refreshing materialized views...');
    refreshMaterializedViews().catch(err => {
      console.error('[CRM IMPORT] MV refresh failed (dashboard may show stale data):', err.message);
    });

    // If no tenant rules existed, run AI inference to detect departments
    if (!tenantRules || meta.runInference) {
      try {
        const dataConfig = await TenantDataConfig.findOne({ where: { tenantId } });
        if (dataConfig) {
          console.log('[CRM IMPORT] Running AI department inference...');
          const { inferDepartmentStructure } = require('./departmentInferenceService');
          const inferenceResult = await inferDepartmentStructure(tenantId);
          console.log(`[CRM IMPORT] Department inference complete: ${inferenceResult.departments.join(', ')} (confidence: ${inferenceResult.confidence})`);
          clearCrmCache(tenantId);
        }
      } catch (inferErr) {
        console.error('[CRM IMPORT] Department inference failed (non-fatal):', inferErr.message);
      }
    }

    // Warm dashboard cache so the first user visit is instant
    console.log('[CRM IMPORT] Warming dashboard cache...');
    Promise.all([
      getCrmOverview(tenantId, null),
      getFiscalYears(tenantId),
      getGivingByMonth(tenantId, null),
      getTopDonors(tenantId, null),
      getTopFunds(tenantId, null),
      getTopCampaigns(tenantId, null),
      getTopAppeals(tenantId, null),
      getDepartmentAnalytics(tenantId, null),
      getDepartmentExtras(tenantId, null),
    ]).then(() => {
      console.log('[CRM IMPORT] Cache warmed successfully.');
    }).catch(err => {
      console.error('[CRM IMPORT] Cache warming failed (non-fatal):', err.message);
    });

    // Notify the uploader via email
    try {
      const { User, Tenant } = require('../models');
      const [uploader, tenant] = await Promise.all([
        User.findByPk(userId, { attributes: ['email', 'name'] }),
        Tenant.findByPk(tenantId, { attributes: ['name'] }),
      ]);
      if (uploader && tenant) {
        const elapsed = importLog.completedAt && importLog.createdAt
          ? Math.round((new Date(importLog.completedAt) - new Date(importLog.createdAt)) / 1000)
          : null;
        const duration = elapsed ? (elapsed < 60 ? elapsed + 's' : Math.round(elapsed / 60) + 'm') : null;
        emailService.sendImportComplete({
          to: uploader.email,
          userName: uploader.name || uploader.email,
          orgName: tenant.name,
          giftCount: giftsUpserted,
          duration,
        }).catch(err => console.error('[EMAIL] Failed to send import-complete:', err.message));
      }
    } catch (emailErr) {
      console.error('[EMAIL] Import notification error:', emailErr.message);
    }

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
