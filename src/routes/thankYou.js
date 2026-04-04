const router = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const { ensureAuth } = require('../middleware/auth');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ── Page ──
router.get('/thank-you-letters', ensureAuth, (req, res) => {
  res.render('thankyou/index', { title: 'Thank-You Letters' });
});

// ── API: Generate letter (SSE) ──
router.post('/api/thank-you/generate', ensureAuth, async (req, res) => {
  try {
    const { donorName, giftAmount, giftType, designation, letterStyle, personalNotes } = req.body;
    if (!letterStyle) return res.status(400).json({ error: 'Letter style is required' });

    const STYLES = {
      formal: 'Formal and traditional — suitable for major donors and official correspondence',
      warm: 'Warm and personal — conversational yet professional',
      brief: 'Brief and sincere — a concise thank-you note (150-200 words)',
      impact: 'Impact-focused — emphasize what their gift will accomplish',
      handwritten: 'Handwritten card style — short, heartfelt, personal (100-150 words)',
    };

    const systemPrompt = `You are a donor relations specialist for the Thunder Bay Regional Health Sciences Foundation. You write heartfelt, personalized thank-you letters that make donors feel valued and connected to the impact of their gift.

LETTER STYLE: ${STYLES[letterStyle] || STYLES.warm}
${donorName ? `DONOR NAME: ${donorName}` : 'DONOR NAME: [The letter should work as a template with "Dear [Donor Name]"]'}
${giftAmount ? `GIFT AMOUNT: $${giftAmount}` : ''}
${giftType ? `GIFT TYPE: ${giftType}` : ''}
${designation ? `GIFT DESIGNATION: ${designation}` : ''}

Guidelines:
- Address the donor by name (or use a respectful greeting if no name provided)
- Acknowledge the specific gift amount and type if provided
- Connect the gift to tangible impact at Thunder Bay Regional Health Sciences Centre
- Express genuine gratitude — avoid sounding formulaic or automated
- Use Canadian English (honour, centre, programme, colour)
- Include a specific, vivid example of how their gift helps (even if illustrative)
- Close with an invitation to stay connected with the Foundation
- Sign off as appropriate for the style (e.g., "With gratitude," for formal)
- Do NOT include placeholder brackets in the final output — create complete content
- If no donor name is given, use "Dear Friend" or similar

${personalNotes ? `PERSONAL NOTES FROM STAFF:\n${personalNotes}` : ''}

Return ONLY the letter content — no meta-commentary or explanations.`;

    const client = getClient();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Generate the thank-you letter based on the parameters above.' }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[Thank-You Letters]', err.message);
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
