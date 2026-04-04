const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { ensureAuth } = require('../middleware/auth');

const MODES = ['Draft from scratch', 'Polish/edit my draft', 'Reply to a message'];
const CONTENT_TYPES = [
  'Thank you letter',
  'Sympathy/condolence card',
  'Donor email',
  'Event invitation',
  'Follow-up email',
  'General correspondence',
];
const TONES = ['Warm & personal', 'Professional & formal', 'Celebratory', 'Empathetic'];

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function buildSystemPrompt(mode, contentType, tone) {
  return `You are a professional fundraising communications writer for a hospital foundation (Thunder Bay Regional Health Sciences Foundation). You specialize in crafting donor-facing communications that are thoughtful, genuine, and effective.

WRITING MODE: ${mode}
CONTENT TYPE: ${contentType}
TONE: ${tone}

Guidelines:
- Write in the voice of a foundation staff member, not a chatbot
- Be genuine and specific — avoid generic boilerplate
- For thank you letters: express heartfelt gratitude, mention the impact of the gift
- For sympathy/condolence cards: be empathetic and respectful, keep it brief and warm
- For donor emails: balance warmth with professionalism, include a clear purpose
- For event invitations: create excitement while maintaining dignity
- For follow-up emails: be timely and personal, reference previous interactions
- For general correspondence: match the context provided
- Use Canadian English spelling (honour, centre, programme, etc.)
- Keep the writing concise but complete
- Do not include placeholder brackets like [Name] unless the user hasn't provided specific details

${mode === 'Polish/edit my draft' ? 'The user will provide their draft. Improve it while preserving their voice and intent. Fix grammar, improve flow, and strengthen the message.' : ''}
${mode === 'Reply to a message' ? 'The user will provide the message they received. Write an appropriate reply that addresses the key points.' : ''}
${mode === 'Draft from scratch' ? 'The user will provide context/notes about what they want to communicate. Create a polished, ready-to-send piece.' : ''}

Return ONLY the written content — no commentary, no explanations, no "Here is..." preamble. Just the letter/email/card text itself.`;
}

// ── Page ──
router.get('/writing-assistant', ensureAuth, (req, res) => {
  res.render('writing/assistant', { title: 'Writing Assistant' });
});

// ── API: Generate (SSE streaming) ──
router.post('/api/writing-assistant/generate', ensureAuth, async (req, res) => {
  try {
    const { mode, contentType, tone, context } = req.body;

    if (!mode || !MODES.includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
    if (!contentType || !CONTENT_TYPES.includes(contentType)) return res.status(400).json({ error: 'Invalid content type' });
    if (!tone || !TONES.includes(tone)) return res.status(400).json({ error: 'Invalid tone' });
    if (!context || !context.trim()) return res.status(400).json({ error: 'Please provide context or your draft' });

    const client = getClient();
    const systemPrompt = buildSystemPrompt(mode, contentType, tone);

    // Stream via SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: context.trim() }],
    });

    let fullText = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fullText += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, fullText })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Writing Assistant]', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to generate writing. Please try again.' });
    }
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
