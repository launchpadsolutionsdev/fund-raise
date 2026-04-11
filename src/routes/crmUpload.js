const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const { ensureUploader } = require('../middleware/auth');
const { autoMapColumns, readCsvHeaders } = require('../services/crmExcelParser');
const audit = require('../services/auditService');
const { importCrmFile, getImportHistory, getCrmStats, getImportProgress } = require('../services/crmImportService');
const { CrmImport } = require('../models');

// 1GB limit for large RE NXT exports, with file type validation
const ALLOWED_MIMES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/octet-stream', // some systems send this for csv/xlsx
];

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (['csv', 'xlsx', 'xls'].includes(ext) || ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are accepted.'));
    }
  },
});

// ---------------------------------------------------------------------------
// GET /crm-upload — Upload page
// ---------------------------------------------------------------------------
router.get('/', ensureUploader, async (req, res) => {
  const tenantId = req.user.tenantId;
  const [history, stats] = await Promise.all([
    getImportHistory(tenantId),
    getCrmStats(tenantId),
  ]);
  res.render('upload/crm-upload', { title: 'CRM Data Import', history, stats });
});

// ---------------------------------------------------------------------------
// POST /crm-upload/preview — Preview column mapping (reads only headers)
// ---------------------------------------------------------------------------
router.post('/preview', ensureUploader, upload.single('crm_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
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

    // Build recommendations for missing optional data categories
    const recommendations = [];
    const hasContact = mappedFields.some(f => ['constituentEmail', 'constituentPhone', 'constituentAddress', 'constituentCity', 'constituentState', 'constituentZip'].includes(f));
    const hasConstituentType = mappedFields.includes('constituentType');

    if (!hasContact) {
      recommendations.push({
        icon: 'geo-alt', label: 'Contact Info',
        desc: 'Unlocks Geographic Analytics, donor profiles with email, phone & address',
        fields: ['Email Addresses\\Email Address', 'Phone Numbers\\Number', 'Addresses\\Address', 'Addresses\\City', 'Addresses\\State', 'Addresses\\ZIP'],
      });
    }
    if (!hasConstituentType) {
      recommendations.push({
        icon: 'people', label: 'Constituent Type',
        desc: 'See Individual vs Business vs Foundation giving breakdowns',
        fields: ['Constituent Type'],
      });
    }
    if (categories.campaign === 0) {
      recommendations.push({
        icon: 'megaphone', label: 'Campaigns',
        desc: 'Powers Campaign Analytics and cross-campaign comparisons',
        fields: ['Campaign ID', 'Campaign Description', 'Campaign Category'],
      });
    }
    if (categories.appeal === 0) {
      recommendations.push({
        icon: 'envelope-open', label: 'Appeals',
        desc: 'Track appeal performance and solicitation effectiveness',
        fields: ['Appeal ID', 'Appeal Description', 'Appeal Category'],
      });
    }
    if (categories.fund === 0) {
      recommendations.push({
        icon: 'bank', label: 'Funds',
        desc: 'Powers Fund Health dashboard and designated giving analysis',
        fields: ['Fund ID', 'Fund Description', 'Fund Category'],
      });
    }
    if (categories.fundraiser === 0) {
      recommendations.push({
        icon: 'person-badge', label: 'Fundraiser Credits',
        desc: 'Track gift officer assignments and fundraiser performance',
        fields: ['Fundraiser Name', 'Fundraiser Amount'],
      });
    }
    if (categories.softCredit === 0) {
      recommendations.push({
        icon: 'arrow-left-right', label: 'Soft Credits',
        desc: 'Track soft credit allocations and household giving',
        fields: ['Soft Credit Amount', 'Soft Credit Recipient Name'],
      });
    }
    if (categories.match === 0) {
      recommendations.push({
        icon: 'arrow-repeat', label: 'Matching Gifts',
        desc: 'Track corporate matching gift programs',
        fields: ['Match Gift ID', 'Match Receipt Amount'],
      });
    }

    // Keep temp file for the import step
    req.session.crmUploadTempFile = req.file.path;
    req.session.crmUploadOrigName = req.file.originalname;
    req.session.crmUploadFileSize = req.file.size;

    return res.json({
      status: 'preview',
      fileName: req.file.originalname,
      fileSize: req.file.size,
      totalColumns: headers.length,
      mappedColumns: Object.keys(mapping).length,
      unmappedColumns: unmapped,
      categories,
      recommendations,
      hasGiftId: mappedFields.includes('giftId'),
    });

  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('[CRM UPLOAD] Preview error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /crm-upload/process — Start import (returns immediately, runs in background)
// ---------------------------------------------------------------------------
router.post('/process', ensureUploader, upload.single('crm_file'), async (req, res) => {
  let filePath, fileName, fileSize;

  if (req.file) {
    filePath = req.file.path;
    fileName = req.file.originalname;
    fileSize = req.file.size;
  } else if (req.session.crmUploadTempFile) {
    filePath = req.session.crmUploadTempFile;
    fileName = req.session.crmUploadOrigName;
    fileSize = req.session.crmUploadFileSize;
    delete req.session.crmUploadTempFile;
    delete req.session.crmUploadOrigName;
    delete req.session.crmUploadFileSize;
  } else {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Upload expired. Please upload the file again.' });
  }

  const tenantId = req.user.tenantId;
  const userId = req.user.id;

  // Respond immediately — import runs in background
  console.log(`[CRM UPLOAD] Starting background import: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  // Start the import but don't await it
  const importPromise = importCrmFile(tenantId, userId, filePath, { fileName, fileSize });

  // Give it a moment to create the import log record
  await new Promise(r => setTimeout(r, 500));

  // Get the latest import log to return the ID
  const latestImport = await CrmImport.findOne({
    where: { tenantId, status: 'processing' },
    order: [['uploadedAt', 'DESC']],
  });

  // Clean up file when import finishes (success or failure)
  importPromise
    .then(() => console.log(`[CRM UPLOAD] Background import completed: ${fileName}`))
    .catch(err => console.error(`[CRM UPLOAD] Background import failed: ${err.message}`))
    .finally(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

  await audit.log(req, 'crm_import', 'data', {
    targetType: 'CrmImport', targetId: latestImport ? latestImport.id : null,
    description: `Started CRM import: ${fileName}`,
    metadata: { filename: fileName },
  });

  return res.json({
    status: 'processing',
    importId: latestImport ? latestImport.id : null,
    message: 'Import started. This will take a few minutes for large files.',
  });
});

// ---------------------------------------------------------------------------
// GET /crm-upload/status/:id — Poll import status
// ---------------------------------------------------------------------------
router.get('/status/:id', ensureUploader, async (req, res) => {
  const importId = parseInt(req.params.id, 10);
  const importLog = await CrmImport.findOne({
    where: { id: importId, tenantId: req.user.tenantId },
  });

  if (!importLog) return res.status(404).json({ error: 'Import not found' });

  // Check in-memory progress first (bypasses transaction isolation)
  const liveProgress = getImportProgress(importId);

  res.json({
    status: importLog.status,
    totalRows: importLog.totalRows,
    giftsUpserted: (liveProgress && liveProgress.giftsUpserted) || importLog.giftsUpserted,
    fundraisersUpserted: (liveProgress && liveProgress.fundraisersUpserted) || importLog.fundraisersUpserted,
    softCreditsUpserted: (liveProgress && liveProgress.softCreditsUpserted) || importLog.softCreditsUpserted,
    matchesUpserted: (liveProgress && liveProgress.matchesUpserted) || importLog.matchesUpserted,
    errorMessage: importLog.errorMessage,
    completedAt: importLog.completedAt,
  });
});

// ---------------------------------------------------------------------------
// POST /crm-upload/cancel/:id — Mark an import as failed/cancelled
// ---------------------------------------------------------------------------
router.post('/cancel/:id', ensureUploader, async (req, res) => {
  try {
    const importLog = await CrmImport.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!importLog) return res.status(404).json({ error: 'Import not found' });
    if (importLog.status !== 'processing') return res.json({ status: importLog.status });

    await importLog.update({ status: 'failed', errorMessage: 'Cancelled by user' });
    res.json({ success: true, status: 'failed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /crm-upload/history
// ---------------------------------------------------------------------------
router.get('/history', ensureUploader, async (req, res) => {
  const history = await getImportHistory(req.user.tenantId);
  res.json(history);
});

// ---------------------------------------------------------------------------
// GET /crm-upload/stats
// ---------------------------------------------------------------------------
router.get('/stats', ensureUploader, async (req, res) => {
  const stats = await getCrmStats(req.user.tenantId);
  res.json(stats);
});

// ---------------------------------------------------------------------------
// POST /crm-upload/rebuild-views — Rebuild materialized views
// ---------------------------------------------------------------------------
router.post('/rebuild-views', ensureUploader, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  res.json({ success: true, message: 'Materialized view rebuild started. Dashboard will load faster once complete.' });
  const { dropMaterializedViews, createMaterializedViews } = require('../services/crmMaterializedViews');
  const { clearCrmCache } = require('../services/crmDashboardService');
  console.log('[CRM MV] Manual rebuild triggered by admin');
  dropMaterializedViews()
    .then(() => createMaterializedViews())
    .then(() => {
      clearCrmCache(req.user.tenantId);
      console.log('[CRM MV] Manual rebuild completed successfully.');
    })
    .catch(err => console.error('[CRM MV] Manual rebuild failed:', err.message));
});

module.exports = router;
