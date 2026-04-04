const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { ensureAuth } = require('../middleware/auth');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const FORMATS = ['Annual Report Narrative', 'Social Media Post', 'Donor Newsletter', 'Website Feature', 'Board Presentation Slide'];
const FOCUSES = ['Patient Care', 'Equipment & Technology', 'Research', 'Education & Training', 'General Operations'];

// ── Page ──
router.get('/impact-stories', ensureAuth, (req, res) => {
  res.render('impact/generator', { title: 'Impact Stories' });
});

// ── API: Generate story (SSE) ──
router.post('/api/impact-stories/generate', ensureAuth, async (req, res) => {
  try {
    const { format, focus, giftAmount, donorType, additionalContext } = req.body;
    if (!format || !FORMATS.includes(format)) return res.status(400).json({ error: 'Invalid format' });
    if (!focus || !FOCUSES.includes(focus)) return res.status(400).json({ error: 'Invalid focus area' });

    const systemPrompt = `You are a storytelling expert for the Thunder Bay Regional Health Sciences Foundation. You craft compelling donor impact narratives that connect financial gifts to real-world outcomes.

OUTPUT FORMAT: ${format}
IMPACT FOCUS AREA: ${focus}
${giftAmount ? `GIFT AMOUNT: $${giftAmount}` : ''}
${donorType ? `DONOR TYPE: ${donorType}` : ''}

Guidelines:
- Write from the Foundation's perspective, showing the tangible impact of donations
- Use specific, vivid details that make the reader feel the impact (even if illustrative)
- For patient stories, use respectful, anonymized language ("a young mother", "a local firefighter")
- Connect the donor's generosity to real outcomes: equipment purchased, procedures enabled, lives touched
- Match the format: annual reports are formal/comprehensive, social media is punchy/emotional, newsletters are warm/personal
- For board presentations, use data-driven language with impact metrics
- Use Canadian English (honour, centre, programme)
- If the format is Social Media Post, keep it under 280 characters for Twitter-friendliness, or provide both a short and long version
- Do NOT use placeholder brackets — create a complete, realistic narrative
- Include a suggested headline/title at the start

Return ONLY the narrative content — no meta-commentary.`;

    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const userMessage = additionalContext
      ? `Generate an impact story. Additional context from the user: ${additionalContext}`
      : 'Generate a compelling impact story based on the parameters above.';

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Impact Stories]', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
