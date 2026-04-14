const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  streamGeneration,
  writingSystemPrompt,
  MODES,
  CONTENT_TYPES,
  TONES,
} = require('../services/writingService');

// ── Page ──
router.get('/writing-assistant', ensureAuth, (req, res) => {
  res.render('writing/assistant', { title: 'Writing Assistant' });
});

// ── API: Generate (SSE streaming) ──
router.post('/api/writing-assistant/generate', ensureAuth, async (req, res) => {
  const { mode, contentType, tone, context } = req.body;

  if (!mode || !MODES.includes(mode)) return res.status(400).json({ error: 'Invalid mode' });
  if (!contentType || !CONTENT_TYPES.includes(contentType)) return res.status(400).json({ error: 'Invalid content type' });
  if (!tone || !TONES.includes(tone)) return res.status(400).json({ error: 'Invalid tone' });
  if (!context || !context.trim()) return res.status(400).json({ error: 'Please provide context or your draft' });

  const trimmedContext = context.trim();
  await streamGeneration(res, {
    feature: 'writing',
    systemPrompt: writingSystemPrompt({ mode, contentType, tone }),
    userMessage: trimmedContext,
    maxTokens: 2048,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      params: { mode, contentType, tone, context: trimmedContext },
    },
  });
});

module.exports = router;
