const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { ensureAuth } = require('../middleware/auth');
const { Snapshot, DepartmentSummary } = require('../models');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Page ──
router.get('/weekly-digest', ensureAuth, (req, res) => {
  res.render('digest/index', { title: 'Weekly Digest' });
});

// ── API: Generate digest (SSE) ──
router.post('/api/weekly-digest/generate', ensureAuth, async (req, res) => {
  try {
    const { tone, audience, highlights } = req.body;

    // Gather latest snapshot data
    const snapshot = await Snapshot.findOne({
      where: { tenantId: req.user.tenantId },
      order: [['snapshotDate', 'DESC']],
    });

    let dataContext = 'No snapshot data available yet.';
    if (snapshot) {
      const depts = await DepartmentSummary.findAll({
        where: { snapshotId: snapshot.id },
      });

      const deptLabels = {
        annual_giving: 'Annual Giving', direct_mail: 'Direct Mail',
        events: 'Events', major_gifts: 'Major Gifts', legacy_giving: 'Legacy Giving',
      };

      let totalRaised = 0, totalGoal = 0;
      const deptLines = depts.map(d => {
        const raised = parseFloat(d.totalAmount) || 0;
        const goal = parseFloat(d.goal) || 0;
        const pct = parseFloat(d.pctToGoal) || 0;
        totalRaised += raised;
        totalGoal += goal;
        return `- ${deptLabels[d.department] || d.department}: $${raised.toLocaleString()} raised of $${goal.toLocaleString()} (${(pct * 100).toFixed(1)}%) — ${d.totalGifts || 0} gifts`;
      });

      dataContext = `SNAPSHOT DATE: ${snapshot.snapshotDate}
TOTAL RAISED: $${totalRaised.toLocaleString()}
TOTAL GOAL: $${totalGoal.toLocaleString()}
OVERALL PROGRESS: ${totalGoal > 0 ? ((totalRaised / totalGoal) * 100).toFixed(1) : 0}%

DEPARTMENT BREAKDOWN:
${deptLines.join('\n')}`;
    }

    const TONES = {
      professional: 'Professional and polished — suitable for senior leadership',
      casual: 'Warm and casual — suitable for internal team distribution',
      celebratory: 'Upbeat and celebratory — emphasize wins and momentum',
      strategic: 'Data-driven and strategic — focus on trends and next steps',
    };

    const AUDIENCES = {
      team: 'the internal fundraising team',
      leadership: 'senior leadership and executive team',
      board: 'the Board of Directors',
      all_staff: 'all Foundation staff',
    };

    const systemPrompt = `You are a communications specialist for the Thunder Bay Regional Health Sciences Foundation. Generate a weekly fundraising digest/summary report.

TONE: ${TONES[tone] || TONES.professional}
AUDIENCE: Written for ${AUDIENCES[audience] || AUDIENCES.team}

CURRENT DATA:
${dataContext}

${highlights ? `ADDITIONAL HIGHLIGHTS TO INCLUDE:\n${highlights}` : ''}

Guidelines:
- Start with a brief greeting/intro appropriate for the audience
- Include a "Numbers at a Glance" section with key metrics
- Highlight departmental progress — call out leaders and areas needing attention
- Include a "Wins This Week" section (derive from the data or highlights provided)
- End with a "Looking Ahead" section with 2-3 forward-looking items
- Use Canadian English (honour, centre, programme)
- Keep it concise but informative — aim for 300-500 words
- Format with clear sections using headings
- If data shows strong progress (>75%), be encouraging. If lagging (<50%), be motivating without being negative
- Do NOT use placeholder brackets — create complete, realistic content`;

    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the weekly fundraising digest based on the current data.' }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Weekly Digest]', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
