const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { TenantBrandVoice } = require('../models');

// ── Page: admin-only settings screen ──
router.get('/settings/brand-voice', ensureAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  res.render('settings/brandVoice', { title: 'Brand Voice' });
});

const MAX_TONE = 2000;
const MAX_GUIDANCE = 4000;
const MAX_SIGNATURE = 1000;
const MAX_LIST_ITEMS = 100;
const MAX_ITEM_LENGTH = 200;

/**
 * Brand Voice — tenant-scoped admin configuration.
 *
 * Voice is per-tenant (one row) and gets spliced into every AI
 * generation for that tenant. All write operations are admin-only;
 * GET is authenticated-but-unrestricted because the WritingService
 * reads it on every generation call (and non-admins generate too).
 *
 * The JSONB list fields are normalised and clamped here so the DB
 * row stays sane regardless of what the client sends.
 */

// ── GET: current tenant's voice (returns {} when none configured) ──
router.get('/api/brand-voice', ensureAuth, async (req, res) => {
  try {
    const row = await TenantBrandVoice.findOne({ where: { tenantId: req.user.tenantId } });
    res.json({ voice: row || null });
  } catch (err) {
    console.error('[BrandVoice GET]', err.message);
    res.status(500).json({ error: 'Failed to load brand voice.' });
  }
});

// ── PUT: upsert tenant voice (admin only) ──
router.put('/api/brand-voice', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });

  try {
    const payload = normalisePayload(req.body || {}, req.user.id);
    const existing = await TenantBrandVoice.findOne({ where: { tenantId: req.user.tenantId } });
    const saved = existing
      ? await existing.update(payload)
      : await TenantBrandVoice.create({ ...payload, tenantId: req.user.tenantId });
    res.json({ voice: saved });
  } catch (err) {
    console.error('[BrandVoice PUT]', err.message);
    res.status(500).json({ error: 'Failed to save brand voice.' });
  }
});

// ── DELETE: remove tenant voice (admin only) ──
// Softly: deletes the row so no block is injected. Re-creating is a PUT.
router.delete('/api/brand-voice', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  try {
    await TenantBrandVoice.destroy({ where: { tenantId: req.user.tenantId } });
    res.json({ success: true });
  } catch (err) {
    console.error('[BrandVoice DELETE]', err.message);
    res.status(500).json({ error: 'Failed to remove brand voice.' });
  }
});

/**
 * Clamp and normalise incoming payload so the DB row stays within sane
 * bounds no matter what the client sends. Keeps lists to MAX_LIST_ITEMS
 * entries and strings to their individual maxes.
 */
function normalisePayload(body, userId) {
  return {
    toneDescription: clampString(body.toneDescription, MAX_TONE),
    organizationValues: clampStringList(body.organizationValues),
    preferredTerms: clampTermList(body.preferredTerms),
    bannedPhrases: clampStringList(body.bannedPhrases),
    signatureBlock: clampString(body.signatureBlock, MAX_SIGNATURE),
    additionalGuidance: clampString(body.additionalGuidance, MAX_GUIDANCE),
    isActive: body.isActive === false ? false : true,
    updatedById: userId,
  };
}

function clampString(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

function clampStringList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((v) => (typeof v === 'string' ? v.trim().slice(0, MAX_ITEM_LENGTH) : ''))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function clampTermList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const from = typeof entry.from === 'string' ? entry.from.trim().slice(0, MAX_ITEM_LENGTH) : '';
      const to = typeof entry.to === 'string' ? entry.to.trim().slice(0, MAX_ITEM_LENGTH) : '';
      if (!from || !to) return null;
      return { from, to };
    })
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

module.exports = router;
