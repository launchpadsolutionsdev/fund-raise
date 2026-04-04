const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { ensureAuth } = require('../middleware/auth');
const { getAvailableDates } = require('../services/snapshotService');
const {
  getDashboardData, getEnhancedDashboardData, getDepartmentData,
  getCrossDepartmentData, getProjection,
} = require('../services/snapshotService');
const { Snapshot } = require('../models');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const MEETING_TYPES = [
  'Board Presentation',
  'Donor Meeting',
  'Department Check-In',
  'Campaign Strategy Session',
  'Year-End Review',
  'New Donor Cultivation',
];

// ── Page ──
router.get('/meeting-prep', ensureAuth, (req, res) => {
  res.render('meeting/prep', { title: 'Meeting Prep' });
});

// ── API ──
router.post('/api/meeting-prep/generate', ensureAuth, async (req, res) => {
  try {
    const { meetingType, attendees, agenda, department, duration } = req.body;
    if (!meetingType) return res.status(400).json({ error: 'Meeting type is required' });

    // Gather current snapshot data for context
    const tenantId = req.user.tenantId;
    const dates = await getAvailableDates(tenantId);
    let dataContext = 'No fundraising data is currently available.';

    if (dates.length > 0) {
      const snapshot = await Snapshot.findOne({ where: { tenantId, snapshotDate: dates[0] } });
      if (snapshot) {
        const [dashboard, enhanced, crossDept, projection] = await Promise.all([
          getDashboardData(snapshot),
          getEnhancedDashboardData(snapshot),
          getCrossDepartmentData(snapshot),
          getProjection(tenantId),
        ]);

        const fmt = n => (n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

        dataContext = `Snapshot Date: ${dates[0]}
Total Raised: $${fmt(dashboard.totalRaised)}
Combined Goal: $${fmt(dashboard.combinedGoal)}
Progress: ${dashboard.overallPct.toFixed(1)}%
Total Gifts: ${dashboard.totalGifts.toLocaleString()}
Unique Donors: ${enhanced.donorCount.toLocaleString()}
${projection ? `Projected Year-End: $${fmt(projection.projectedTotal)} (${projection.projectedPct.toFixed(1)}% of goal)
On Track: ${projection.onTrack ? 'Yes' : 'No'}` : ''}`;

        // Add department data if specified
        if (department) {
          try {
            const deptData = await getDepartmentData(snapshot, department);
            if (deptData.summary) {
              const s = deptData.summary;
              dataContext += `\n\nDepartment (${department}):
Raised: $${fmt(parseFloat(s.totalAmount))}
Goal: $${fmt(parseFloat(s.goal))}
Progress: ${parseFloat(s.pctToGoal).toFixed(1)}%
Gifts: ${s.totalGifts}`;
            }
          } catch (e) { /* department data optional */ }
        }
      }
    }

    const systemPrompt = `You are a meeting preparation assistant for the Thunder Bay Regional Health Sciences Foundation. Generate a comprehensive briefing document for the upcoming meeting.

MEETING TYPE: ${meetingType}
${attendees ? `ATTENDEES: ${attendees}` : ''}
${agenda ? `AGENDA NOTES: ${agenda}` : ''}
${duration ? `DURATION: ${duration} minutes` : ''}
${department ? `FOCUS DEPARTMENT: ${department}` : ''}

CURRENT FUNDRAISING DATA:
${dataContext}

Generate a structured briefing document that includes:
1. **Meeting Overview** — purpose, attendees, suggested duration
2. **Key Talking Points** — 3-5 main points with supporting data from the snapshot
3. **Data Highlights** — relevant metrics, trends, and comparisons to present
4. **Discussion Questions** — thought-provoking questions to drive conversation
5. **Action Items Template** — suggested follow-up items based on meeting type
${meetingType === 'Donor Meeting' ? '6. **Donor Engagement Notes** — suggested conversation starters, gift ask range, stewardship opportunities' : ''}
${meetingType === 'Board Presentation' ? '6. **Board-Ready Metrics** — key numbers formatted for board consumption, suggested visuals' : ''}

Use Canadian English. Be specific with numbers from the data. Format with clear markdown headings.`;

    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the meeting briefing document.' }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Meeting Prep]', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
