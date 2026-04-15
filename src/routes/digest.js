const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { aiRateLimitMiddleware } = require('../services/aiRateLimit');
const { Snapshot, DepartmentSummary } = require('../models');
const { streamGeneration } = require('../services/writingService');

const DEPT_LABELS = {
  annual_giving: 'Annual Giving',
  direct_mail: 'Direct Mail',
  events: 'Events',
  major_gifts: 'Major Gifts',
  legacy_giving: 'Legacy Giving',
};

// ── Page ──
router.get('/weekly-digest', ensureAuth, (req, res) => {
  res.render('digest/index', { title: 'Weekly Digest' });
});

/**
 * Assemble the latest-snapshot data context for the weekly digest prompt.
 */
async function buildDigestDataContext(tenantId) {
  const snapshot = await Snapshot.findOne({
    where: { tenantId },
    order: [['snapshotDate', 'DESC']],
  });
  if (!snapshot) return 'No snapshot data available yet.';

  const depts = await DepartmentSummary.findAll({ where: { snapshotId: snapshot.id } });

  let totalRaised = 0;
  let totalGoal = 0;
  const deptLines = depts.map(d => {
    const raised = parseFloat(d.totalAmount) || 0;
    const goal = parseFloat(d.goal) || 0;
    const pct = parseFloat(d.pctToGoal) || 0;
    totalRaised += raised;
    totalGoal += goal;
    return `- ${DEPT_LABELS[d.department] || d.department}: $${raised.toLocaleString()} raised of $${goal.toLocaleString()} (${(pct * 100).toFixed(1)}%) — ${d.totalGifts || 0} gifts`;
  });

  return `SNAPSHOT DATE: ${snapshot.snapshotDate}
TOTAL RAISED: $${totalRaised.toLocaleString()}
TOTAL GOAL: $${totalGoal.toLocaleString()}
OVERALL PROGRESS: ${totalGoal > 0 ? ((totalRaised / totalGoal) * 100).toFixed(1) : 0}%

DEPARTMENT BREAKDOWN:
${deptLines.join('\n')}`;
}

// ── API: Generate digest (SSE) ──
router.post('/api/weekly-digest/generate', ensureAuth, aiRateLimitMiddleware, async (req, res) => {
  const { tone, audience, highlights } = req.body;

  let dataContext;
  try {
    dataContext = await buildDigestDataContext(req.user.tenantId);
  } catch (err) {
    console.error('[Weekly Digest]', err.message);
    return res.status(500).json({ error: 'Failed to load fundraising data for digest.' });
  }

  await streamGeneration(res, {
    feature: 'digest',
    promptParams: { tone, audience, highlights, dataContext },
    userMessage: 'Generate the weekly fundraising digest based on the current data.',
    maxTokens: 2000,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      params: { tone, audience, highlights },
    },
  });
});

module.exports = router;
