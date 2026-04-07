const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ensureAuth } = require('../middleware/auth');
const { User, Tenant } = require('../models');
const emailService = require('../services/emailService');

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
      fs.unlink(oldPath, (err) => { if (err && err.code !== 'ENOENT') console.warn('[Avatar] Failed to delete old avatar:', err.message); });
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
      fs.unlink(oldPath, (err) => { if (err && err.code !== 'ENOENT') console.warn('[Logo] Failed to delete old logo:', err.message); });
    }

    tenant.logoPath = req.file.filename;
    await tenant.save();

    res.json({ logoSrc: '/uploads/logos/' + req.file.filename });
  } catch (err) {
    console.error('[Logo Upload]', err.message);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// ── Team Management (admin only) ──

// List all team members (including inactive and pending invites)
router.get('/api/team', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId },
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'lastLogin', 'createdAt', 'invitationToken', 'invitationExpiresAt'],
      order: [['createdAt', 'ASC']],
    });
    res.json(users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
      pending: !!(u.invitationToken && (!u.invitationExpiresAt || u.invitationExpiresAt > new Date())),
      expired: !!(u.invitationToken && u.invitationExpiresAt && u.invitationExpiresAt <= new Date() && !u.lastLogin),
    })));
  } catch (err) {
    console.error('[Team List]', err.message);
    res.status(500).json({ error: 'Failed to load team' });
  }
});

// Invite a new team member
router.post('/api/team/invite', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const role = ['viewer', 'uploader', 'admin'].includes(req.body.role) ? req.body.role : 'viewer';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Check if already exists in this tenant
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      if (existing.tenantId === req.user.tenantId) {
        return res.status(409).json({ error: 'This email is already a member of your organization' });
      }
      return res.status(409).json({ error: 'This email is registered with another organization' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const user = await User.create({
      email,
      role,
      tenantId: req.user.tenantId,
      isActive: true,
      invitationToken: token,
      invitationExpiresAt: expiresAt,
      invitedBy: req.user.id,
    });

    // Send invitation email
    const tenant = await Tenant.findByPk(req.user.tenantId);
    await emailService.sendInvitation({
      to: email,
      inviterName: req.user.name || req.user.email,
      orgName: tenant.name,
      role,
      token,
    });

    res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      pending: true,
    });
  } catch (err) {
    console.error('[Team Invite]', err.message);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// Resend invitation
router.post('/api/team/:userId/resend', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await User.findOne({ where: { id: req.params.userId, tenantId: req.user.tenantId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.lastLogin) return res.status(400).json({ error: 'User has already accepted the invitation' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.update({ invitationToken: token, invitationExpiresAt: expiresAt });

    const tenant = await Tenant.findByPk(req.user.tenantId);
    await emailService.sendInvitation({
      to: user.email,
      inviterName: req.user.name || req.user.email,
      orgName: tenant.name,
      role: user.role,
      token,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Team Resend]', err.message);
    res.status(500).json({ error: 'Failed to resend invitation' });
  }
});

// Update team member role
router.put('/api/team/:userId/role', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await User.findOne({ where: { id: req.params.userId, tenantId: req.user.tenantId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot change your own role' });

    const role = ['viewer', 'uploader', 'admin'].includes(req.body.role) ? req.body.role : 'viewer';
    await user.update({ role });
    res.json({ id: user.id, role });
  } catch (err) {
    console.error('[Team Role]', err.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// Deactivate / reactivate team member
router.put('/api/team/:userId/active', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await User.findOne({ where: { id: req.params.userId, tenantId: req.user.tenantId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });

    const isActive = !!req.body.isActive;
    await user.update({ isActive });
    res.json({ id: user.id, isActive });
  } catch (err) {
    console.error('[Team Active]', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Remove a pending invite (delete user who never logged in)
router.delete('/api/team/:userId', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const user = await User.findOne({ where: { id: req.params.userId, tenantId: req.user.tenantId } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot remove yourself' });
    if (user.lastLogin) return res.status(400).json({ error: 'Cannot delete a user who has logged in. Deactivate them instead.' });

    await user.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[Team Remove]', err.message);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

module.exports = router;
