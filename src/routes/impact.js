const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  streamGeneration,
  impactSystemPrompt,
  STORY_FORMATS,
  STORY_FOCUSES,
} = require('../services/writingService');

// ── Page ──
router.get('/impact-stories', ensureAuth, (req, res) => {
  res.render('impact/generator', { title: 'Impact Stories' });
});

// ── API: Generate story (SSE) ──
router.post('/api/impact-stories/generate', ensureAuth, async (req, res) => {
  const { format, focus, giftAmount, donorType, additionalContext } = req.body;
  if (!format || !STORY_FORMATS.includes(format)) return res.status(400).json({ error: 'Invalid format' });
  if (!focus || !STORY_FOCUSES.includes(focus)) return res.status(400).json({ error: 'Invalid focus area' });

  const userMessage = additionalContext
    ? `Generate an impact story. Additional context from the user: ${additionalContext}`
    : 'Generate a compelling impact story based on the parameters above.';

  await streamGeneration(res, {
    feature: 'impact',
    systemPrompt: impactSystemPrompt({ format, focus, giftAmount, donorType }),
    userMessage,
    maxTokens: 1500,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      params: { format, focus, giftAmount, donorType, additionalContext },
    },
  });
});

module.exports = router;
