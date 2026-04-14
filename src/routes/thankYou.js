const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const {
  streamGeneration,
  thankYouSystemPrompt,
  THANKYOU_STYLES,
} = require('../services/writingService');

// ── Page ──
router.get('/thank-you-letters', ensureAuth, (req, res) => {
  res.render('thankyou/index', { title: 'Thank-You Letters' });
});

// ── API: Generate letter (SSE) ──
router.post('/api/thank-you/generate', ensureAuth, async (req, res) => {
  const { donorName, giftAmount, giftType, designation, letterStyle, personalNotes } = req.body;
  if (!letterStyle || !THANKYOU_STYLES[letterStyle]) {
    return res.status(400).json({ error: 'Letter style is required' });
  }

  await streamGeneration(res, {
    feature: 'thankYou',
    systemPrompt: thankYouSystemPrompt({ donorName, giftAmount, giftType, designation, letterStyle, personalNotes }),
    userMessage: 'Generate the thank-you letter based on the parameters above.',
    maxTokens: 1500,
    persist: {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      params: { donorName, giftAmount, giftType, designation, letterStyle, personalNotes },
    },
  });
});

module.exports = router;
