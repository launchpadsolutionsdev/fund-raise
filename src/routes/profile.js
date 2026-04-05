const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ensureAuth } = require('../middleware/auth');
const { User, Tenant } = require('../models');

// Avatar upload config — store as <userId>.ext in public/uploads/avatars/
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, req.user.id + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
  },
});

// Logo upload config — store as <tenantId>.ext in public/uploads/logos/
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

// ── Pages ──

// My Profile page
router.get('/profile', ensureAuth, (req, res) => {
  res.render('profile/edit', { title: 'My Profile' });
});

// Staff Directory page
router.get('/directory', ensureAuth, async (req, res) => {
  res.render('profile/directory', { title: 'Staff Directory' });
});

// View someone's profile page
router.get('/directory/:userId', ensureAuth, (req, res) => {
  res.render('profile/view', { title: 'Profile' });
});

// ── API ──

// Get any user's public profile
router.get('/api/profile/:userId', ensureAuth, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { id: req.params.userId, tenantId: req.user.tenantId },
      attributes: ['id', 'name', 'email', 'avatarUrl', 'role', 'nickname', 'jobTitle', 'bio', 'localAvatarPath'],
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      nickname: user.nickname,
      displayName: user.displayName(),
      jobTitle: user.jobTitle,
      bio: user.bio,
      avatarSrc: user.avatarSrc(),
      role: user.role,
    });
  } catch (err) {
    console.error('[Profile]', err.message);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Update own profile
router.put('/api/profile', ensureAuth, async (req, res) => {
  try {
    const { nickname, jobTitle, bio } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (typeof nickname !== 'undefined') user.nickname = (nickname || '').trim().substring(0, 100) || null;
    if (typeof jobTitle !== 'undefined') user.jobTitle = (jobTitle || '').trim().substring(0, 150) || null;
    if (typeof bio !== 'undefined') user.bio = (bio || '').trim().substring(0, 500) || null;

    await user.save();
    res.json({
      id: user.id,
      nickname: user.nickname,
      displayName: user.displayName(),
      jobTitle: user.jobTitle,
      bio: user.bio,
      avatarSrc: user.avatarSrc(),
    });
  } catch (err) {
    console.error('[Profile Update]', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Upload avatar
router.post('/api/profile/avatar', ensureAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const user = await User.findByPk(req.user.id);

    // Delete old local avatar if different filename
    if (user.localAvatarPath && user.localAvatarPath !== req.file.filename) {
      const oldPath = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars', user.localAvatarPath);
      fs.unlink(oldPath, () => {}); // best-effort cleanup
    }

    user.localAvatarPath = req.file.filename;
    await user.save();

    res.json({ avatarSrc: user.avatarSrc() });
  } catch (err) {
    console.error('[Avatar Upload]', err.message);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// List all staff in tenant (for directory)
router.get('/api/staff', ensureAuth, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId, isActive: true },
      attributes: ['id', 'name', 'email', 'avatarUrl', 'role', 'nickname', 'jobTitle', 'bio', 'localAvatarPath'],
      order: [['name', 'ASC']],
    });
    res.json(users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      nickname: u.nickname,
      displayName: u.displayName(),
      jobTitle: u.jobTitle,
      bio: u.bio,
      avatarSrc: u.avatarSrc(),
      role: u.role,
    })));
  } catch (err) {
    console.error('[Staff List]', err.message);
    res.status(500).json({ error: 'Failed to load staff' });
  }
});

// ── Organization Profile ──

// Page
router.get('/organization', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  const tenant = await Tenant.findByPk(req.user.tenantId);
  res.render('settings/organization', { title: 'Organization Profile', tenant });
});

// API: Get organization
router.get('/api/organization', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const tenant = await Tenant.findByPk(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
    res.json(tenant);
  } catch (err) {
    console.error('[Org Profile]', err.message);
    res.status(500).json({ error: 'Failed to load organization' });
  }
});

// API: Update organization
router.put('/api/organization', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const tenant = await Tenant.findByPk(req.user.tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const { missionStatement, addressLine1, addressLine2, city, state, zip, phone, website, ein, fiscalYearStart } = req.body;

    if (typeof missionStatement !== 'undefined') tenant.missionStatement = (missionStatement || '').trim().substring(0, 500) || null;
    if (typeof addressLine1 !== 'undefined') tenant.addressLine1 = (addressLine1 || '').trim().substring(0, 255) || null;
    if (typeof addressLine2 !== 'undefined') tenant.addressLine2 = (addressLine2 || '').trim().substring(0, 255) || null;
    if (typeof city !== 'undefined') tenant.city = (city || '').trim().substring(0, 100) || null;
    if (typeof state !== 'undefined') tenant.state = (state || '').trim().substring(0, 50) || null;
    if (typeof zip !== 'undefined') tenant.zip = (zip || '').trim().substring(0, 20) || null;
    if (typeof phone !== 'undefined') tenant.phone = (phone || '').trim().substring(0, 30) || null;
    if (typeof website !== 'undefined') tenant.website = (website || '').trim().substring(0, 255) || null;
    if (typeof ein !== 'undefined') tenant.ein = (ein || '').trim().substring(0, 20) || null;
    if (typeof fiscalYearStart !== 'undefined') {
      const fy = parseInt(fiscalYearStart, 10);
      tenant.fiscalYearStart = (fy >= 1 && fy <= 12) ? fy : 4;
    }

    await tenant.save();
    res.json(tenant);
  } catch (err) {
    console.error('[Org Update]', err.message);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// API: Upload logo
router.post('/api/organization/logo', ensureAuth, logoUpload.single('logo'), async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const tenant = await Tenant.findByPk(req.user.tenantId);

    // Delete old logo if different filename
    if (tenant.logoPath && tenant.logoPath !== req.file.filename) {
      const oldPath = path.join(logosDir, tenant.logoPath);
      fs.unlink(oldPath, () => {}); // best-effort cleanup
    }

    tenant.logoPath = req.file.filename;
    await tenant.save();

    res.json({ logoSrc: '/uploads/logos/' + req.file.filename });
  } catch (err) {
    console.error('[Logo Upload]', err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

module.exports = router;
