const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureAuth } = require('../middleware/auth');
const { Tenant } = require('../models');

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

  res.render('onboarding/wizard', {
    title: 'Organization Setup',
    tenant,
    step: clampedStep,
    totalSteps: TOTAL_STEPS,
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

      case 5:
        // Review & Complete
        tenant.onboardingCompleted = true;
        req.session.onboardingCompleted = true;
        break;

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
    res.json({ success: true });
  } catch (err) {
    console.error('[Onboarding Skip]', err.message);
    res.status(500).json({ error: 'Failed to skip onboarding' });
  }
});

module.exports = router;
