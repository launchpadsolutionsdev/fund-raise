const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { aiRateLimitMiddleware } = require('../services/aiRateLimit');
const {
  getAvailableDates,
  getDashboardData,
  getEnhancedDashboardData,
  getDepartmentData,
  getCrossDepartmentData,
  getProjection,
} = require('../services/snapshotService');
const { Snapshot } = require('../models');
const { streamGeneration, meetingPrepSystemPrompt } = require('../services/writingService');

// ── Page ──
router.get('/meeting-prep', ensureAuth, (req, res) => {
  res.render('meeting/prep', { title: 'Meeting Prep' });
});

/**
 * Assemble the latest-snapshot data context used to ground the briefing.
 * Returns a short, plain-text block that the prompt template interpolates.
 */
async function buildMeetingDataContext(tenantId, department) {
  const dates = await getAvailableDates(tenantId);
  if (dates.length === 0) return 'No fundraising data is currently available.';

  const snapshot = await Snapshot.findOne({ where: { tenantId, snapshotDate: dates[0] } });
  if (!snapshot) return 'No fundraising data is currently available.';

  const [dashboard, enhanced, , projection] = await Promise.all([
    getDashboardData(snapshot),
    getEnhancedDashboardData(snapshot),
    getCrossDepartmentData(snapshot),
    getProjection(tenantId),
  ]);

  const fmt = n => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  let ctx = `Snapshot Date: ${dates[0]}
Total Raised: $${fmt(dashboard.totalRaised)}
Combined Goal: $${fmt(dashboard.combinedGoal)}
Progress: ${dashboard.overallPct.toFixed(1)}%
Total Gifts: ${dashboard.totalGifts.toLocaleString()}
Unique Donors: ${enhanced.donorCount.toLocaleString()}
${projection ? `Projected Year-End: $${fmt(projection.projectedTotal)} (${projection.projectedPct.toFixed(1)}% of goal)
On Track: ${projection.onTrack ? 'Yes' : 'No'}` : ''}`;

  if (department) {
    try {
      const deptData = await getDepartmentData(snapshot, department);
      if (deptData.summary) {
        const s = deptData.summary;
        ctx += `\n\nDepartment (${department}):
Raised: $${fmt(parseFloat(s.totalAmount))}
Goal: $${fmt(parseFloat(s.goal))}
Progress: ${parseFloat(s.pctToGoal).toFixed(1)}%
Gifts: ${s.totalGifts}`;
      }
    } catch (_) { /* department data optional */ }
  }

  return ctx;
}

// ── API ──
router.post('/api/meeting-prep/generate', ensureAuth, aiRateLimitMiddleware, async (req, res) => {
  const { meetingType, attendees, agenda, department, duration } = req.body;
  if (!meetingType) return res.status(400).json({ error: 'Meeting type is required' });

  let dataContext;
  try {
    dataContext = await buildMeetingDataContext(req.user.tenantId, department);
  } catch (err) {
    console.error('[Meeting Prep]', err.message);
    return res.status(500).json({ error: 'Failed to load fundraising data for briefing.' });
  }

  await streamGeneration(res, {
    feature: 'meetingPrep',
    systemPrompt: meetingPrepSystemPrompt({ meetingType, attendees, agenda, department, duration, dataContext }),
    userMessage: 'Generate the meeting briefing document.',
    maxTokens: 3000,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      params: { meetingType, attendees, agenda, department, duration },
    },
  });
});

module.exports = router;
