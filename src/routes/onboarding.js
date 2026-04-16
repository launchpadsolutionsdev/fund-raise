const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureAuth } = require('../middleware/auth');
const { Tenant, TenantDataConfig, CrmImport, CrmGift, sequelize } = require('../models');
const { Sequelize } = require('sequelize');

const TOTAL_STEPS = 5;

// Logo upload config (reuse same storage as profile route)
const logosDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'logos');
if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: logosDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, req.user.tenantId + ext);
  },
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
  },
});

// CRM upload config for onboarding
const crmUpload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 1024 * 1024 * 1024 } });

// ── Main wizard page ──
router.get('/onboarding', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('danger', 'Only admins can complete organization setup.');
    return req.session.save(() => res.redirect('/crm-dashboard'));
  }

  const tenant = await Tenant.findByPk(req.user.tenantId);
  if (!tenant) return res.status(404).render('error', { title: 'Not Found', message: 'Organization not found.' });

  // If already completed, redirect to dashboard
  if (tenant.onboardingCompleted) return res.redirect('/crm-dashboard');

  const step = parseInt(req.query.step, 10) || tenant.onboardingStep || 1;
  const clampedStep = Math.max(1, Math.min(TOTAL_STEPS, step));

  // Load data config for steps that need it
  let dataConfig = await TenantDataConfig.findOne({ where: { tenantId: tenant.id } });

  res.render('onboarding/wizard', {
    title: 'Organization Setup',
    tenant,
    step: clampedStep,
    totalSteps: TOTAL_STEPS,
    dataConfig: dataConfig ? dataConfig.toJSON() : null,
    layout: false,
  });
});

// ── Save step data ──
router.put('/api/onboarding/step/:step', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenant = await Tenant.findByPk(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const step = parseInt(req.params.step, 10);

    switch (step) {
      case 1:
        // Welcome — just advance step
        break;

      case 2: {
        // Organization Details
        const { name, missionStatement, ein, fiscalYearStart } = req.body;
        if (name && name.trim()) tenant.name = name.trim().substring(0, 255);
        if (typeof missionStatement !== 'undefined') tenant.missionStatement = (missionStatement || '').trim().substring(0, 500) || null;
        if (typeof ein !== 'undefined') tenant.ein = (ein || '').trim().substring(0, 20) || null;
        if (typeof fiscalYearStart !== 'undefined') {
          const fy = parseInt(fiscalYearStart, 10);
          tenant.fiscalYearStart = (fy >= 1 && fy <= 12) ? fy : 4;
        }
        break;
      }

      case 3: {
        // Contact & Address
        const { addressLine1, addressLine2, city, state, zip, phone, website } = req.body;
        if (typeof addressLine1 !== 'undefined') tenant.addressLine1 = (addressLine1 || '').trim().substring(0, 255) || null;
        if (typeof addressLine2 !== 'undefined') tenant.addressLine2 = (addressLine2 || '').trim().substring(0, 255) || null;
        if (typeof city !== 'undefined') tenant.city = (city || '').trim().substring(0, 100) || null;
        if (typeof state !== 'undefined') tenant.state = (state || '').trim().substring(0, 50) || null;
        if (typeof zip !== 'undefined') tenant.zip = (zip || '').trim().substring(0, 20) || null;
        if (typeof phone !== 'undefined') tenant.phone = (phone || '').trim().substring(0, 30) || null;
        if (typeof website !== 'undefined') tenant.website = (website || '').trim().substring(0, 255) || null;
        break;
      }

      case 4:
        // Branding — logo handled via separate upload endpoint
        break;

      case 5: {
        // Review & Complete org setup
        tenant.onboardingCompleted = true;
        tenant.onboardingStep = 5;
        req.session.onboardingCompleted = true;

        // Check if tenant has CRM data — if not, redirect to data onboarding
        const giftCount = await CrmGift.count({ where: { tenantId: tenant.id } });
        const hasData = giftCount > 0;

        await tenant.save();
        return res.json({
          success: true,
          step: 5,
          completed: true,
          redirectTo: hasData ? '/crm-dashboard' : '/data-onboarding',
        });
      }

      default:
        return res.status(400).json({ error: 'Invalid step' });
    }

    // Advance the onboarding step tracker
    const nextStep = Math.min(step + 1, TOTAL_STEPS);
    if (nextStep > (tenant.onboardingStep || 1)) {
      tenant.onboardingStep = nextStep;
    }

    await tenant.save();
    res.json({ success: true, step: nextStep, completed: tenant.onboardingCompleted });
  } catch (err) {
    console.error('[Onboarding]', err.message);
    res.status(500).json({ error: 'Failed to save onboarding data' });
  }
});

// ── Logo upload during onboarding ──
router.post('/api/onboarding/logo', ensureAuth, logoUpload.single('logo'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const tenant = await Tenant.findByPk(req.user.tenantId);

    // Delete old logo if different
    if (tenant.logoPath && tenant.logoPath !== req.file.filename) {
      const oldPath = path.join(logosDir, tenant.logoPath);
      fs.unlink(oldPath, () => {});
    }

    tenant.logoPath = req.file.filename;
    await tenant.save();

    res.json({ logoSrc: '/uploads/logos/' + req.file.filename });
  } catch (err) {
    console.error('[Onboarding Logo]', err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// ── Skip onboarding ──
router.post('/api/onboarding/skip', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenant = await Tenant.findByPk(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    tenant.onboardingCompleted = true;
    await tenant.save();
    req.session.onboardingCompleted = true;

    // If no CRM data, redirect to data onboarding instead of dashboard
    const giftCount = await CrmGift.count({ where: { tenantId: tenant.id } });
    const redirectTo = giftCount > 0 ? '/crm-dashboard' : '/data-onboarding';
    res.json({ success: true, redirectTo });
  } catch (err) {
    console.error('[Onboarding Skip]', err.message);
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

// ── Data onboarding wizard page ──
router.get('/data-onboarding', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    req.flash('danger', 'Only admins can complete data setup.');
    return req.session.save(() => res.redirect('/crm-dashboard'));
  }

  const tenantId = req.user.tenantId;
  let dataConfig = await TenantDataConfig.findOne({ where: { tenantId } });

  // Create TenantDataConfig if it doesn't exist
  if (!dataConfig) {
    dataConfig = await TenantDataConfig.create({ tenantId });
  }

  // If already completed, redirect to dashboard
  if (dataConfig.onboardingCompletedAt) return res.redirect('/crm-dashboard');

  const dataStep = parseInt(req.query.step, 10) || dataConfig.onboardingStep || 1;
  const clampedStep = Math.max(1, Math.min(4, dataStep));

  res.render('onboarding/data-wizard', {
    title: 'Data Setup',
    dataConfig: dataConfig.toJSON(),
    dataStep: clampedStep,
    layout: false,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Data Onboarding Endpoints (Work Streams 2-5)
// ═══════════════════════════════════════════════════════════════════════════

// ── Save data privacy config ──
router.post('/api/onboarding/data-config', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenantId = req.user.tenantId;
    const {
      includeConstituentContact, includeCampaigns, includeAppeals,
      includeFunds, includeFundraiserCredits, includeSoftCredits,
      includeMatchingGifts, includeConstituentCodes, fiscalYearStartMonth,
    } = req.body;

    const [dataConfig] = await TenantDataConfig.upsert({
      tenantId,
      includeGiftCore: true,
      includeConstituentContact: includeConstituentContact !== false,
      includeCampaigns: includeCampaigns !== false,
      includeAppeals: includeAppeals !== false,
      includeFunds: includeFunds !== false,
      includeFundraiserCredits: includeFundraiserCredits !== false,
      includeSoftCredits: includeSoftCredits !== false,
      includeMatchingGifts: includeMatchingGifts !== false,
      includeConstituentCodes: includeConstituentCodes !== false,
      fiscalYearStartMonth: parseInt(fiscalYearStartMonth, 10) || 4,
    }, { returning: true });

    // Also update tenant fiscal year
    const fy = parseInt(fiscalYearStartMonth, 10);
    if (fy >= 1 && fy <= 12) {
      await Tenant.update({ fiscalYearStart: fy }, { where: { id: tenantId } });
    }

    res.json({ success: true, dataConfig });
  } catch (err) {
    console.error('[Onboarding DataConfig]', err.message);
    res.status(500).json({ error: 'Failed to save data configuration' });
  }
});

// ── Upload preview (reads headers, returns mapping) ──
router.post('/api/onboarding/upload-preview', ensureAuth, crmUpload.single('crm_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const { autoMapColumns, readCsvHeaders } = require('../services/crmExcelParser');
    const isCSV = /\.csv$/i.test(req.file.originalname);
    let headers;

    if (isCSV) {
      headers = await readCsvHeaders(req.file.path);
    } else {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(req.file.path, { sheetRows: 1 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      headers = (XLSX.utils.sheet_to_json(ws, { header: 1 })[0]) || [];
    }

    const { mapping, unmapped } = autoMapColumns(headers);
    const mappedFields = Object.values(mapping);

    const categories = {
      gift: mappedFields.filter(f => f.startsWith('gift') || ['systemRecordId', 'constituentId', 'firstName', 'lastName'].includes(f)).length,
      fund: mappedFields.filter(f => f.startsWith('fund')).length,
      campaign: mappedFields.filter(f => f.startsWith('campaign')).length,
      appeal: mappedFields.filter(f => f.startsWith('appeal')).length,
      fundraiser: mappedFields.filter(f => f.startsWith('fundraiser')).length,
      softCredit: mappedFields.filter(f => f.startsWith('softCredit') || f.startsWith('recipient')).length,
      match: mappedFields.filter(f => f.startsWith('match')).length,
    };

    // Store temp file in session
    req.session.onboardingTempFile = req.file.path;
    req.session.onboardingOrigName = req.file.originalname;
    req.session.onboardingFileSize = req.file.size;

    return res.json({
      status: 'preview',
      fileName: req.file.originalname,
      fileSize: req.file.size,
      totalColumns: headers.length,
      mappedColumns: Object.keys(mapping).length,
      unmappedColumns: unmapped,
      categories,
      hasGiftId: mappedFields.includes('giftId'),
    });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('[Onboarding Upload Preview]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Start import + AI inference ──
router.post('/api/onboarding/upload-process', ensureAuth, crmUpload.single('crm_file'), async (req, res) => {
  let filePath, fileName, fileSize;

  if (req.file) {
    filePath = req.file.path;
    fileName = req.file.originalname;
    fileSize = req.file.size;
  } else if (req.session.onboardingTempFile) {
    filePath = req.session.onboardingTempFile;
    fileName = req.session.onboardingOrigName;
    fileSize = req.session.onboardingFileSize;
    delete req.session.onboardingTempFile;
    delete req.session.onboardingOrigName;
    delete req.session.onboardingFileSize;
  } else {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Upload expired. Please upload the file again.' });
  }

  const tenantId = req.user.tenantId;
  const userId = req.user.id;

  // Ensure TenantDataConfig exists
  await TenantDataConfig.findOrCreate({
    where: { tenantId },
    defaults: { tenantId },
  });

  // Start import in background (with AI inference enabled)
  const { importCrmFile } = require('../services/crmImportService');
  const importPromise = importCrmFile(tenantId, userId, filePath, {
    fileName,
    fileSize,
    runInference: true,
  });

  // Wait briefly for the import log record to be created
  await new Promise(r => setTimeout(r, 500));

  const latestImport = await CrmImport.findOne({
    where: { tenantId, status: 'processing' },
    order: [['uploadedAt', 'DESC']],
  });

  // Clean up file after import finishes
  importPromise
    .then(() => console.log(`[Onboarding] Import completed: ${fileName}`))
    .catch(err => console.error(`[Onboarding] Import failed: ${err.message}`))
    .finally(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

  return res.json({
    status: 'processing',
    importId: latestImport ? latestImport.id : null,
    message: 'Import started. This will take a few minutes for large files.',
  });
});

// ── Poll import + inference status ──
router.get('/api/onboarding/status/:importId', ensureAuth, async (req, res) => {
  const tenantId = req.user.tenantId;
  const importLog = await CrmImport.findOne({
    where: { id: req.params.importId, tenantId },
  });

  if (!importLog) return res.status(404).json({ error: 'Import not found' });

  // Check if AI inference has completed
  let inferenceComplete = false;
  let detectedDepartments = null;
  if (importLog.status === 'completed') {
    const dataConfig = await TenantDataConfig.findOne({ where: { tenantId } });
    if (dataConfig && dataConfig.detectedDepartments) {
      inferenceComplete = true;
      detectedDepartments = dataConfig.detectedDepartments;
    } else if (dataConfig && importLog.completedAt) {
      // If import completed more than 2 minutes ago and still no inference,
      // assume inference failed — let the user proceed without departments
      const elapsed = Date.now() - new Date(importLog.completedAt).getTime();
      if (elapsed > 2 * 60 * 1000) {
        console.warn('[Onboarding Status] Inference timed out — proceeding without department detection');
        inferenceComplete = true;
        detectedDepartments = { departments: [], confidence: 0, dataStructureNotes: 'Department inference timed out. You can re-analyze from the review page.' };
      }
    }
  }

  res.json({
    status: importLog.status,
    totalRows: importLog.totalRows,
    giftsUpserted: importLog.giftsUpserted,
    fundraisersUpserted: importLog.fundraisersUpserted,
    softCreditsUpserted: importLog.softCreditsUpserted,
    matchesUpserted: importLog.matchesUpserted,
    errorMessage: importLog.errorMessage,
    completedAt: importLog.completedAt,
    inferenceComplete,
    detectedDepartments,
  });
});

// ── Get review data (import summary + data quality + departments) ──
router.get('/api/onboarding/review', ensureAuth, async (req, res) => {
  const tenantId = req.user.tenantId;

  try {
    const [dataConfig, latestImport] = await Promise.all([
      TenantDataConfig.findOne({ where: { tenantId } }),
      CrmImport.findOne({ where: { tenantId, status: 'completed' }, order: [['completedAt', 'DESC']] }),
    ]);

    // Import summary
    const importSummary = latestImport ? {
      giftsUpserted: latestImport.giftsUpserted,
      fundraisersUpserted: latestImport.fundraisersUpserted,
      softCreditsUpserted: latestImport.softCreditsUpserted,
      matchesUpserted: latestImport.matchesUpserted,
      totalColumns: latestImport.columnMapping ? Object.keys(latestImport.columnMapping).length : 0,
      mappedColumns: latestImport.columnMapping ? Object.keys(latestImport.columnMapping).length : 0,
      fileName: latestImport.fileName,
    } : {};

    // Date range
    const [dateRange] = await sequelize.query(
      `SELECT MIN(gift_date) AS min_date, MAX(gift_date) AS max_date FROM crm_gifts WHERE tenant_id = :tenantId`,
      { replacements: { tenantId }, type: Sequelize.QueryTypes.SELECT },
    );
    if (dateRange && dateRange.min_date) {
      importSummary.dateRange = `${dateRange.min_date} to ${dateRange.max_date}`;
    }

    // Data quality metrics
    const totalGifts = await CrmGift.count({ where: { tenantId } });
    const dataQuality = {};
    if (totalGifts > 0) {
      const [q] = await sequelize.query(`
        SELECT
          ROUND(100.0 * COUNT(CASE WHEN gift_amount IS NOT NULL AND gift_date IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0)) AS gift_completeness,
          ROUND(100.0 * COUNT(CASE WHEN fund_description IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0)) AS fund_coverage,
          ROUND(100.0 * COUNT(CASE WHEN campaign_description IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0)) AS campaign_coverage,
          ROUND(100.0 * COUNT(CASE WHEN appeal_description IS NOT NULL THEN 1 END) / NULLIF(COUNT(*), 0)) AS appeal_coverage
        FROM crm_gifts WHERE tenant_id = :tenantId
      `, { replacements: { tenantId }, type: Sequelize.QueryTypes.SELECT });
      dataQuality.giftCompleteness = q.gift_completeness;
      dataQuality.fundCoverage = q.fund_coverage;
      dataQuality.campaignCoverage = q.campaign_coverage;
      dataQuality.appealCoverage = q.appeal_coverage;
    }

    // Department stats
    const departmentStats = {};
    if (totalGifts > 0) {
      const deptRows = await sequelize.query(`
        SELECT department, COUNT(*) AS count, COALESCE(SUM(gift_amount), 0) AS total
        FROM crm_gifts WHERE tenant_id = :tenantId AND department IS NOT NULL
          AND (gift_code IS NULL OR (LOWER(gift_code) NOT LIKE '%pledge%' AND LOWER(gift_code) NOT LIKE '%planned%gift%'))
        GROUP BY department ORDER BY total DESC
      `, { replacements: { tenantId }, type: Sequelize.QueryTypes.SELECT });
      for (const row of deptRows) {
        departmentStats[row.department] = { count: parseInt(row.count), total: parseFloat(row.total) };
      }
    }

    res.json({
      importSummary,
      dataQuality,
      dataConfig: dataConfig ? dataConfig.toJSON() : null,
      detectedDepartments: dataConfig ? dataConfig.detectedDepartments : null,
      classificationRules: dataConfig ? dataConfig.departmentClassificationRules : null,
      departmentStats,
    });
  } catch (err) {
    console.error('[Onboarding Review]', err.message);
    res.status(500).json({ error: 'Failed to load review data' });
  }
});

// ── Finalize onboarding ──
router.post('/api/onboarding/confirm', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenantId = req.user.tenantId;

    // Mark data config as completed
    await TenantDataConfig.update({
      onboardingCompletedAt: new Date(),
    }, { where: { tenantId } });

    // Mark tenant as onboarded
    const tenant = await Tenant.findByPk(tenantId);
    tenant.onboardingCompleted = true;
    await tenant.save();
    req.session.onboardingCompleted = true;
    req.session._dataSetupComplete = true;
    req.session._featuresAt = null; // Force feature flag refresh

    // Refresh materialized views in background. Uses the advisory-locked
    // path so this refresh coordinates with the 30-min scheduler + any
    // concurrent post-upload refreshes instead of racing them.
    const { refreshMaterializedViewsLocked } = require('../services/scheduledJobs');
    refreshMaterializedViewsLocked({ source: 'onboarding' })
      .then(result => {
        if (result.ok) {
          console.log(`[Onboarding] MV refresh completed in ${(result.durationMs / 1000).toFixed(1)}s`);
        } else if (result.skipped) {
          console.log(`[Onboarding] MV refresh skipped (${result.reason}) — another worker handled it`);
        } else {
          console.error('[Onboarding] MV refresh failed:', result.error);
        }
      });

    // Warm dashboard cache
    const { clearCrmCache, getCrmOverview, getFiscalYears } = require('../services/crmDashboardService');
    clearCrmCache(tenantId);
    Promise.all([getCrmOverview(tenantId, null), getFiscalYears(tenantId)]).catch(() => {});

    res.json({ success: true, redirectTo: '/crm-dashboard' });
  } catch (err) {
    console.error('[Onboarding Confirm]', err.message);
    res.status(500).json({ error: 'Failed to finalize onboarding' });
  }
});

// ── Re-analyze data structure (callable from Settings) ──
router.post('/api/onboarding/re-analyze', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenantId = req.user.tenantId;
    const giftCount = await CrmGift.count({ where: { tenantId } });
    if (giftCount === 0) {
      return res.status(400).json({ error: 'No gift data found. Import data first.' });
    }

    // Ensure TenantDataConfig exists
    await TenantDataConfig.findOrCreate({
      where: { tenantId },
      defaults: { tenantId },
    });

    const { inferDepartmentStructure } = require('../services/departmentInferenceService');
    const result = await inferDepartmentStructure(tenantId);

    // Clear caches
    const { clearCrmCache } = require('../services/crmDashboardService');
    clearCrmCache(tenantId);

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Onboarding Re-analyze]', err.message);
    res.status(500).json({ error: err.message || 'Failed to analyze data structure' });
  }
});

// ── Manual department configuration (fallback when AI inference fails) ──
router.post('/api/onboarding/manual-departments', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const tenantId = req.user.tenantId;
    const { departments } = req.body;

    if (!departments || !Array.isArray(departments) || departments.length === 0) {
      return res.status(400).json({ error: 'At least one department is required.' });
    }

    // Validate and build classification rules from manual config
    const classificationRules = [];
    const deptNames = [];

    for (const dept of departments) {
      const name = (dept.name || '').trim();
      if (!name) continue;
      deptNames.push(name);

      if (dept.isDefault) {
        classificationRules.push({
          department: name,
          priority: 99,
          field: '*',
          matchType: 'default',
          pattern: '',
          caseSensitive: false,
          rationale: 'Default department for unclassified gifts',
        });
      } else if (dept.field && dept.pattern) {
        classificationRules.push({
          department: name,
          priority: classificationRules.length + 1,
          field: dept.field,
          matchType: dept.matchType || 'regex',
          pattern: dept.pattern,
          caseSensitive: false,
          rationale: dept.rationale || 'Manually configured rule',
        });
      }
    }

    // Ensure there's a default rule
    if (!classificationRules.some(r => r.matchType === 'default')) {
      const defaultDept = deptNames[deptNames.length - 1] || 'Annual Giving';
      classificationRules.push({
        department: defaultDept,
        priority: 99,
        field: '*',
        matchType: 'default',
        pattern: '',
        caseSensitive: false,
        rationale: 'Default department for unclassified gifts',
      });
    }

    // Save to TenantDataConfig
    const [dc] = await TenantDataConfig.findOrCreate({
      where: { tenantId },
      defaults: { tenantId },
    });

    await dc.update({
      detectedDepartments: {
        departments: deptNames,
        confidence: 1.0,
        inferredAt: new Date(),
        dataStructureNotes: 'Departments were manually configured by an administrator.',
        manuallyConfigured: true,
      },
      departmentClassificationRules: classificationRules,
    });

    // Reclassify gifts with new rules
    const { reclassifyGifts } = require('../services/departmentInferenceService');
    const updated = await reclassifyGifts(tenantId, classificationRules);

    // Clear caches
    const { clearCrmCache } = require('../services/crmDashboardService');
    clearCrmCache(tenantId);

    res.json({ success: true, departments: deptNames, giftsReclassified: updated });
  } catch (err) {
    console.error('[Manual Departments]', err.message);
    res.status(500).json({ error: err.message || 'Failed to save department configuration' });
  }
});

module.exports = router;
