const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ensureAuth } = require('../middleware/auth');
const { User, Tenant } = require('../models');
const emailService = require('../services/emailService');
const audit = require('../services/auditService');

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

    const oldRole = user.role;
    const role = ['viewer', 'uploader', 'admin'].includes(req.body.role) ? req.body.role : 'viewer';
    await user.update({ role });
    await audit.log(req, 'role_change', 'admin', {
      targetType: 'User', targetId: user.id,
      description: `Changed ${user.name || user.email} role from ${oldRole} to ${role}`,
      metadata: { oldRole, newRole: role },
    });
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

    const userName = user.name || user.email;
    await user.destroy();
    await audit.log(req, 'remove_user', 'admin', {
      targetType: 'User', targetId: req.params.userId,
      description: `Removed pending invite for ${userName}`,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[Team Remove]', err.message);
    res.status(500).json({ error: 'Failed to remove user' });
  }
});

// ── Email Preview (admin only) ──

router.get('/admin/email-preview', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  const tenant = await Tenant.findByPk(req.user.tenantId);
  const orgName = tenant ? tenant.name : 'Your Organization';
  const userName = req.user.name || req.user.email;

  const { _wrapHtml: wrapHtml, _escapeHtml: escapeHtml, _APP_URL: APP_URL } = emailService;

  // Shared preview styles (match emailService.js S object)
  const S = {
    heading: 'margin:0 0 10px;font-size:22px;font-weight:700;color:#1A223D;letter-spacing:-0.3px;line-height:1.3;',
    subheading: 'margin:0 0 6px;font-size:13px;font-weight:600;color:#3434D6;text-transform:uppercase;letter-spacing:0.5px;',
    body: 'font-size:15px;color:#4B5563;line-height:1.75;margin:0 0 24px;',
    bodyLast: 'font-size:15px;color:#4B5563;line-height:1.75;margin:0;',
    btn: 'display:inline-block;background:linear-gradient(135deg,#1960F9 0%,#3434D6 100%);color:#ffffff;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.2px;',
    btnWrap: 'margin:28px 0 0;',
    featureRow: 'font-size:14px;color:#4B5563;line-height:1.6;padding:8px 0;border-bottom:1px solid #F3F4F6;',
    featureIcon: 'display:inline-block;width:20px;text-align:center;margin-right:8px;font-size:14px;',
    muted: 'font-size:12px;color:#9CA3AF;line-height:1.6;margin:24px 0 0;',
  };

  const templates = {
    invitation: wrapHtml(`
      <p style="${S.subheading}">You've been invited</p>
      <h2 style="${S.heading}">Join ${escapeHtml(orgName)} on Fund-Raise</h2>
      <p style="${S.body}">
        ${escapeHtml(userName)} wants you on the team. As a <strong>viewer</strong>, you'll get instant access to real-time fundraising dashboards, AI-powered analytics, and tools that replace hours of manual Blackbaud reporting.
      </p>
      <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;">
        <tr>
          <td style="${S.featureRow}"><span style="${S.featureIcon}">&#9679;</span> <strong>30+ dashboards</strong> with live RE&nbsp;NXT data</td>
        </tr>
        <tr>
          <td style="${S.featureRow}"><span style="${S.featureIcon}">&#9679;</span> <strong>Ask Fund-Raise</strong> — your AI fundraising analyst</td>
        </tr>
        <tr>
          <td style="font-size:14px;color:#4B5563;line-height:1.6;padding:8px 0;"><span style="${S.featureIcon}">&#9679;</span> Board reports, donor letters, and impact stories on demand</td>
        </tr>
      </table>
      <div style="${S.btnWrap}">
        <a href="#" style="${S.btn}">Accept &amp; Get Started &#8594;</a>
      </div>
      <p style="${S.muted}">
        This invitation expires in 7&nbsp;days. You'll sign in securely with Google.<br>
        Didn't expect this? No action needed — this link will simply expire.
      </p>
    `),
    welcome: wrapHtml(`
      <p style="${S.subheading}">Welcome aboard</p>
      <h2 style="${S.heading}">You're in, ${escapeHtml(userName)}.</h2>
      <p style="${S.body}">
        You've joined <strong>${escapeHtml(orgName)}</strong> on Fund-Raise. Your entire Blackbaud RE&nbsp;NXT analytics stack — dashboards, reports, donor insights — is ready to go. No setup required.
      </p>
      <div style="background:#F0F4FF;border:1px solid #DBEAFE;border-radius:12px;padding:24px;margin:0 0 28px;">
        <div style="font-size:14px;font-weight:600;color:#1A223D;margin-bottom:12px;">Here's what you can do right now:</div>
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
              <strong style="color:#1960F9;">Explore dashboards</strong> — 30+ views covering giving trends, donor retention, campaign performance, and fund analytics
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
              <strong style="color:#1960F9;">Ask Fund-Raise</strong> — get instant answers like "Who are our top 20 lapsed donors?" or "Show giving by campaign this quarter"
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-size:14px;color:#4B5563;line-height:1.5;">
              <strong style="color:#1960F9;">Generate reports</strong> — board decks, thank-you letters, and impact stories in seconds, not hours
            </td>
          </tr>
        </table>
      </div>
      <div style="${S.btnWrap}">
        <a href="#" style="${S.btn}">Open Your Dashboard &#8594;</a>
      </div>
    `),
    importComplete: wrapHtml(`
      <p style="${S.subheading}">Import complete</p>
      <h2 style="${S.heading}">Your data is live, ${escapeHtml(userName)}.</h2>
      <p style="${S.body}">
        The CRM import for <strong>${escapeHtml(orgName)}</strong> finished successfully. Every gift has been processed, classified, and is already powering your dashboards.
      </p>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <div style="font-size:28px;font-weight:700;color:#16A34A;letter-spacing:-0.5px;line-height:1.2;">12,847 gifts</div>
        <div style="font-size:13px;color:#6B7280;margin-top:4px;">imported and analyzed in 2m 34s</div>
      </div>
      <p style="${S.body}">
        Donor segments, giving trends, and campaign analytics have all been updated. Your AI assistant already knows about the new data — try asking it a question.
      </p>
      <div style="${S.btnWrap}">
        <a href="#" style="${S.btn}">See Your Updated Dashboard &#8594;</a>
      </div>
    `),
    quotaWarning: wrapHtml(`
      <p style="${S.subheading}">Heads up</p>
      <h2 style="${S.heading}">Blackbaud API usage at 80%</h2>
      <p style="${S.body}">
        <strong>${escapeHtml(orgName)}</strong> is approaching today's Blackbaud SKY API quota. This is informational — no action is required right now.
      </p>
      <div style="background:#FEFCE8;border:1px solid #FDE68A;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <div style="font-size:28px;font-weight:700;color:#D97706;letter-spacing:-0.5px;line-height:1.2;">800 / 1,000</div>
        <div style="font-size:13px;color:#6B7280;margin-top:4px;">API calls used today</div>
        <div style="margin-top:12px;background:#FDE68A;border-radius:50px;height:6px;overflow:hidden;">
          <div style="background:linear-gradient(90deg,#F59E0B,#D97706);height:6px;width:80%;border-radius:50px;"></div>
        </div>
      </div>
      <p style="${S.bodyLast}">
        The quota resets automatically at midnight. If the limit is reached, new Blackbaud API requests will pause until tomorrow — but your existing dashboards and Ask Fund-Raise will continue working with cached data.
      </p>
    `),
    inviteAccepted: wrapHtml(`
      <p style="${S.subheading}">Team update</p>
      <h2 style="${S.heading}">Jane Smith just joined ${escapeHtml(orgName)}</h2>
      <p style="${S.body}">
        Your invitation was accepted. <strong>Jane Smith</strong> now has access to Fund-Raise and can start exploring dashboards, running queries, and generating reports immediately.
      </p>
      <div style="background:#F0F4FF;border:1px solid #DBEAFE;border-radius:12px;padding:20px 24px;margin:0 0 24px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="width:44px;height:44px;background:linear-gradient(135deg,#1960F9,#3434D6);border-radius:50%;text-align:center;vertical-align:middle;">
            <span style="font-size:18px;font-weight:700;color:#fff;line-height:44px;">J</span>
          </td>
          <td style="padding-left:16px;">
            <div style="font-size:15px;font-weight:600;color:#1A223D;">Jane Smith</div>
            <div style="font-size:13px;color:#6B7280;">jane@example.com</div>
          </td>
        </tr></table>
      </div>
      <div style="${S.btnWrap}">
        <a href="#" style="${S.btn}">Manage Your Team &#8594;</a>
      </div>
    `),
  };

  const selected = req.query.template || 'invitation';
  const html = templates[selected] || templates.invitation;

  const tabs = Object.keys(templates).map(key => {
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
    const active = key === selected;
    return `<a href="?template=${key}" style="display:inline-block;padding:8px 16px;margin:0 4px 8px 0;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;font-family:'Manrope',sans-serif;${active ? 'background:#3434D6;color:#fff;' : 'background:#f3f4f6;color:#374151;'}">${label}</a>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html><head><title>Email Preview — Fund-Raise</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; background:#1a1a2e; font-family:'Manrope',sans-serif; }
  .preview-bar { padding:16px 24px; background:#fff; border-bottom:1px solid #e5e7eb; }
  .preview-bar h3 { margin:0 0 12px; font-size:16px; color:#1a1a1a; }
  .preview-frame { display:flex; justify-content:center; padding:40px 20px; }
  iframe { border:none; width:620px; height:700px; border-radius:8px; background:#fff; box-shadow:0 4px 24px rgba(0,0,0,0.3); }
</style></head>
<body>
  <div class="preview-bar">
    <h3>Email Template Preview</h3>
    <div>${tabs}</div>
  </div>
  <div class="preview-frame">
    <iframe srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>
  </div>
</body></html>`);
});

module.exports = router;
