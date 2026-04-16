/**
 * Thank-You Letter Templates
 *
 * Admin CRUD + preview + per-gift render endpoints for the canned
 * (non-AI) thank-you letter templates. See thankYouTemplateService.js
 * for the rendering rules and merge-field catalog.
 *
 * Authorization:
 *   - Admins only for create/update/delete (list + preview view open to
 *     any authenticated user on this tenant).
 *   - All queries are tenant-scoped by the current session tenant.
 */
const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { ThankYouTemplate, Tenant } = require('../models');
const { getFilterOptions } = require('../services/crmDashboardService');
const {
  getSupportedMergeFields,
  renderTemplate,
  buildSampleContext,
  renderForGift,
} = require('../services/thankYouTemplateService');

const SCOPE_TYPES = ['default', 'fund', 'campaign', 'appeal'];

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// ── Admin page ──
router.get('/settings/thank-you-templates', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  res.render('settings/thank-you-templates', {
    title: 'Thank-You Letter Templates',
    mergeFields: getSupportedMergeFields(),
  });
});

// ── Filter options (funds / campaigns / appeals) ──
// The editor uses this to populate the "Linked record" picker when
// scopeType ≠ default. Wraps the existing crmDashboardService helper so
// the UI doesn't have to reach across two routes.
router.get('/api/crm/filter-options', ensureAuth, async (req, res) => {
  try {
    const opts = await getFilterOptions(req.user.tenantId);
    res.json(opts);
  } catch (err) {
    console.error('[ThankYouTemplates] filter-options:', err.message);
    res.status(500).json({ error: 'Failed to load filter options' });
  }
});

// ── List ──
router.get('/api/thank-you-templates', ensureAuth, async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === '1';
    const where = { tenantId: req.user.tenantId };
    if (!includeArchived) where.isArchived = false;
    const rows = await ThankYouTemplate.findAll({
      where,
      order: [
        // defaults first, then by scope label for a predictable UI
        ['scope_type', 'ASC'], ['name', 'ASC'],
      ],
      raw: true,
    });
    res.json({ templates: rows, mergeFields: getSupportedMergeFields() });
  } catch (err) {
    console.error('[ThankYouTemplates] list:', err.message);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

// ── Fetch one ──
router.get('/api/thank-you-templates/:id', ensureAuth, async (req, res) => {
  try {
    const row = await ThankYouTemplate.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      raw: true,
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (err) {
    console.error('[ThankYouTemplates] fetch:', err.message);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

function validatePayload(body) {
  const errs = [];
  const name = (body.name || '').toString().trim();
  if (!name) errs.push('Name is required');
  if (name.length > 120) errs.push('Name must be 120 characters or fewer');
  const bodyText = (body.body || '').toString();
  if (!bodyText.trim()) errs.push('Letter body is required');
  const scopeType = (body.scopeType || 'default').toString();
  if (!SCOPE_TYPES.includes(scopeType)) errs.push('Scope type must be one of: ' + SCOPE_TYPES.join(', '));
  if (scopeType === 'fund' && !body.fundId) errs.push('fundId is required when scopeType=fund');
  if (scopeType === 'campaign' && !body.campaignId) errs.push('campaignId is required when scopeType=campaign');
  if (scopeType === 'appeal' && !body.appealId) errs.push('appealId is required when scopeType=appeal');
  return errs;
}

function normalisePayload(body) {
  const scopeType = (body.scopeType || 'default').toString();
  return {
    name: (body.name || '').toString().trim().slice(0, 120),
    description: body.description ? String(body.description).slice(0, 2000) : null,
    subject: body.subject ? String(body.subject).slice(0, 200) : null,
    body: (body.body || '').toString(),
    scopeType,
    // Null out the irrelevant scope columns so the row is clean.
    fundId: scopeType === 'fund' ? String(body.fundId) : null,
    campaignId: scopeType === 'campaign' ? String(body.campaignId) : null,
    appealId: scopeType === 'appeal' ? String(body.appealId) : null,
    scopeLabel: body.scopeLabel ? String(body.scopeLabel).slice(0, 500) : null,
  };
}

// ── Create ──
router.post('/api/thank-you-templates', ensureAuth, requireAdmin, async (req, res) => {
  try {
    const errs = validatePayload(req.body);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    const data = normalisePayload(req.body);
    const row = await ThankYouTemplate.create({
      ...data,
      tenantId: req.user.tenantId,
      createdBy: req.user.id,
    });
    res.status(201).json(row);
  } catch (err) {
    console.error('[ThankYouTemplates] create:', err.message);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// ── Update ──
router.put('/api/thank-you-templates/:id', ensureAuth, requireAdmin, async (req, res) => {
  try {
    const errs = validatePayload(req.body);
    if (errs.length) return res.status(400).json({ error: errs.join('; ') });
    const row = await ThankYouTemplate.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    const data = normalisePayload(req.body);
    await row.update(data);
    res.json(row);
  } catch (err) {
    console.error('[ThankYouTemplates] update:', err.message);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// ── Archive (soft delete) ──
router.delete('/api/thank-you-templates/:id', ensureAuth, requireAdmin, async (req, res) => {
  try {
    const row = await ThankYouTemplate.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!row) return res.status(404).json({ error: 'Template not found' });
    // Soft delete — preserves audit history and any letters already sent.
    await row.update({ isArchived: true });
    res.json({ archived: true });
  } catch (err) {
    console.error('[ThankYouTemplates] archive:', err.message);
    res.status(500).json({ error: 'Failed to archive template' });
  }
});

// ── Preview: render an arbitrary template string with sample data ──
// Used by the editor's live "Preview" pane.
router.post('/api/thank-you-templates/preview', ensureAuth, async (req, res) => {
  try {
    const { subject, body } = req.body || {};
    const tenant = await Tenant.findByPk(req.user.tenantId, { raw: true });
    const context = buildSampleContext(tenant ? tenant.name : null);
    const rendered = renderTemplate({ subject, body }, context);
    res.json({ ...rendered, context });
  } catch (err) {
    console.error('[ThankYouTemplates] preview:', err.message);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// ── Generate for a specific gift ──
// Picks the best-matching template and renders with the real donor context.
// Used from the donor profile / gift detail "Generate thank-you letter" button.
router.get('/api/thank-you-templates/for-gift/:giftId', ensureAuth, async (req, res) => {
  try {
    const result = await renderForGift(req.user.tenantId, req.params.giftId);
    if (!result) return res.status(404).json({ error: 'Gift not found' });
    if (!result.template) {
      return res.status(404).json({
        error: 'No matching thank-you template',
        hint: 'Create a default template (or one scoped to this gift\'s fund / campaign / appeal) in Settings → Thank-You Templates.',
      });
    }
    res.json({
      template: {
        id: result.template.id,
        name: result.template.name,
        scopeType: result.template.scopeType,
        scopeLabel: result.template.scopeLabel,
      },
      subject: result.rendered.subject,
      body: result.rendered.body,
      missingTokens: result.rendered.missingTokens,
      context: result.context,
    });
  } catch (err) {
    console.error('[ThankYouTemplates] for-gift:', err.message);
    res.status(500).json({ error: 'Failed to render letter' });
  }
});

module.exports = router;
