const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureUploader } = require('../middleware/auth');
const { Snapshot, sequelize } = require('../models');
const { parseDepartmentFile } = require('../services/excelParser');
const { saveDepartmentData } = require('../services/snapshotService');
const audit = require('../services/auditService');

const upload = multer({
  dest: '/tmp/uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (['csv', 'xlsx', 'xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files (.csv, .xlsx, .xls) are accepted.'));
    }
  },
});

const DEPT_FIELDS = [
  { name: 'annual_giving', maxCount: 1 },
  { name: 'direct_mail', maxCount: 1 },
  { name: 'events', maxCount: 1 },
  { name: 'major_gifts', maxCount: 1 },
  { name: 'legacy_giving', maxCount: 1 },
];

router.get('/', ensureUploader, (req, res) => {
  res.render('upload/upload', { title: 'Upload Data' });
});

router.post('/process', ensureUploader, upload.fields(DEPT_FIELDS), async (req, res) => {
  const { snapshot_date, notes, overwrite } = req.body;
  if (!snapshot_date) return res.status(400).json({ error: 'Snapshot date is required' });

  const tenantId = req.user.tenantId;

  try {
    // Check existing
    const existing = await Snapshot.findOne({ where: { tenantId, snapshotDate: snapshot_date } });
    if (existing && overwrite !== 'true') {
      return res.status(409).json({
        error: 'snapshot_exists',
        message: `A snapshot already exists for ${snapshot_date}. Set overwrite=true to replace it.`,
      });
    }
    if (existing) {
      await existing.destroy();
    }

    // Create snapshot
    const snapshot = await Snapshot.create({
      tenantId,
      snapshotDate: snapshot_date,
      uploadedBy: req.user.id,
      notes: notes || '',
    });

    const results = {};
    const errors = {};

    for (const field of DEPT_FIELDS) {
      const files = req.files[field.name];
      if (!files || files.length === 0) continue;

      const file = files[0];
      try {
        const parsed = parseDepartmentFile(file.path, field.name);
        await saveDepartmentData(snapshot, field.name, parsed);
        results[field.name] = 'success';
      } catch (err) {
        errors[field.name] = err.message;
      } finally {
        // Cleanup temp file
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(207).json({ status: 'partial', results, errors });
    }
    await audit.log(req, 'upload_snapshot', 'data', {
      targetType: 'Snapshot', targetId: snapshot.id,
      description: `Uploaded department snapshot for ${snapshot.snapshotDate}`,
      metadata: { departments: Object.keys(results) },
    });
    return res.json({ status: 'success', results, snapshotId: snapshot.id });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
