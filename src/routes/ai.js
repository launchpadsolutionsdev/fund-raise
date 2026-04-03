const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { chat } = require('../services/aiService');
const { getAvailableDates } = require('../services/snapshotService');

// Render the chat page
router.get('/ask', ensureAuth, async (req, res) => {
  const dates = await getAvailableDates(req.user.tenantId);
  const selectedDate = dates.length ? dates[0] : null;
  res.render('ai/chat', {
    title: 'Ask Fund-Raise',
    selectedDate,
    hasData: dates.length > 0,
  });
});

// Chat API endpoint
router.post('/api/ai/chat', ensureAuth, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Each message must have a valid role (user/assistant) and content' });
      }
    }

    const result = await chat(req.user.tenantId, messages);
    res.json(result);
  } catch (err) {
    console.error('[AI Chat Error]', err.message);
    if (err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured. Please set the ANTHROPIC_API_KEY environment variable.' });
    }
    res.status(500).json({ error: 'An error occurred while processing your request. Please try again.' });
  }
});

module.exports = router;
