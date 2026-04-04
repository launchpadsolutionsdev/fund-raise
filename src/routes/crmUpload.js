const router = require('express').Router();
const multer = require('multer');
const fs = require('fs');
const { ensureUploader } = require('../middleware/auth');
const { parseCrmExport, autoMapColumns } = require('../services/crmExcelParser');
const { importCrmData, getImportHistory, getCrmStats } = require('../services/crmImportService');

// 300MB limit for large RE NXT exports
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 300 * 1024 * 1024 } });

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
// POST /crm-upload/preview — Preview column mapping before import
// ---------------------------------------------------------------------------
router.post('/preview', ensureUploader, upload.single('crm_file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path, { sheetRows: 1 });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const headers = XLSX.utils.sheet_to_json(ws, { header: 1 })[0] || [];

    const { mapping, unmapped } = autoMapColumns(headers);

    // Count mapped fields by category
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

    // Store temp file path in session for the actual import
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
      hasGiftId: mappedFields.includes('giftId'),
    });

  } catch (err) {
    // Cleanup on error
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    console.error('[CRM UPLOAD] Preview error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /crm-upload/process — Run the full import
// ---------------------------------------------------------------------------
router.post('/process', ensureUploader, upload.single('crm_file'), async (req, res) => {
  // Accept either a fresh upload or the previewed file from session
  let filePath, fileName, fileSize;

  if (req.file) {
    filePath = req.file.path;
    fileName = req.file.originalname;
    fileSize = req.file.size;
  } else if (req.session.crmUploadTempFile) {
    filePath = req.session.crmUploadTempFile;
    fileName = req.session.crmUploadOrigName;
    fileSize = req.session.crmUploadFileSize;
    // Clear session
    delete req.session.crmUploadTempFile;
    delete req.session.crmUploadOrigName;
    delete req.session.crmUploadFileSize;
  } else {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Verify file still exists
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Upload expired. Please upload the file again.' });
  }

  const tenantId = req.user.tenantId;
  const userId = req.user.id;

  try {
    console.log(`[CRM UPLOAD] Parsing ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)...`);
    const parsed = parseCrmExport(filePath);

    console.log(`[CRM UPLOAD] Parsed: ${parsed.stats.uniqueGifts} unique gifts from ${parsed.stats.totalRows} rows`);

    if (parsed.unmappedColumns.length > 0) {
      console.log(`[CRM UPLOAD] Unmapped columns: ${parsed.unmappedColumns.join(', ')}`);
    }

    const importLog = await importCrmData(tenantId, userId, parsed, { fileName, fileSize });

    return res.json({
      status: 'success',
      importId: importLog.id,
      stats: {
        totalRows: parsed.stats.totalRows,
        uniqueGifts: parsed.stats.uniqueGifts,
        giftsUpserted: importLog.giftsUpserted,
        fundraisersUpserted: importLog.fundraisersUpserted,
        softCreditsUpserted: importLog.softCreditsUpserted,
        matchesUpserted: importLog.matchesUpserted,
      },
      unmappedColumns: parsed.unmappedColumns,
    });

  } catch (err) {
    console.error('[CRM UPLOAD] Import error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(filePath); } catch (_) {}
  }
});

// ---------------------------------------------------------------------------
// GET /crm-upload/history — Import history API
// ---------------------------------------------------------------------------
router.get('/history', ensureUploader, async (req, res) => {
  const history = await getImportHistory(req.user.tenantId);
  res.json(history);
});

// ---------------------------------------------------------------------------
// GET /crm-upload/stats — CRM data stats API
// ---------------------------------------------------------------------------
router.get('/stats', ensureUploader, async (req, res) => {
  const stats = await getCrmStats(req.user.tenantId);
  res.json(stats);
});

module.exports = router;
