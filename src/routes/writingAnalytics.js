const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { getVariantStats } = require('../services/writingAnalytics');
const { getPlatformBenchmarks } = require('../services/writingBenchmarks');

/**
 * Writing Analytics — admin-only dashboard for comparing prompt variants
 * and tracking per-feature AI usage.
 *
 * Both the page and the JSON endpoint are gated on admin role — the
 * aggregate view reveals usage across every user in the tenant, which
 * staff shouldn't see.
 */

function ensureAdminInline(req, res, json) {
  if (req.user && req.user.role === 'admin') return true;
  if (json) res.status(403).json({ error: 'Admin access required.' });
  else res.status(403).send('Forbidden');
  return false;
}

// Page
router.get('/settings/writing-analytics', ensureAuth, (req, res) => {
  if (!ensureAdminInline(req, res, false)) return;
  res.render('settings/writingAnalytics', { title: 'Writing Analytics' });
});

// API
router.get('/api/writing-analytics', ensureAuth, async (req, res) => {
  if (!ensureAdminInline(req, res, true)) return;
  try {
    const days = req.query.days === 'all' ? null : req.query.days;
    const stats = await getVariantStats(req.user.tenantId, { days });
    res.json(stats);
  } catch (err) {
    console.error('[Writing Analytics]', err.message);
    res.status(500).json({ error: 'Failed to load analytics.' });
  }
});

// Cross-tenant benchmarks: pooled per-feature rates across every OTHER
// tenant. Always excludes the caller's tenant, and any feature without
// at least MIN_TENANTS distinct contributors in the period is dropped
// (privacy floor enforced in the service).
router.get('/api/writing-benchmarks', ensureAuth, async (req, res) => {
  if (!ensureAdminInline(req, res, true)) return;
  try {
    const days = req.query.days === 'all' ? null : req.query.days;
    const benchmarks = await getPlatformBenchmarks(req.user.tenantId, { days });
    res.json(benchmarks);
  } catch (err) {
    console.error('[Writing Benchmarks]', err.message);
    res.status(500).json({ error: 'Failed to load benchmarks.' });
  }
});

module.exports = router;
