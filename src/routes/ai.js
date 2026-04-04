const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { chat, generateTitle, clearCache } = require('../services/aiService');
const { getAvailableDates } = require('../services/snapshotService');
const blackbaudClient = require('../services/blackbaudClient');
const { Conversation } = require('../models');

// Render the chat page (optionally with a conversation ID)
router.get('/ask', ensureAuth, async (req, res) => {
  const dates = await getAvailableDates(req.user.tenantId);
  const selectedDate = dates.length ? dates[0] : null;
  const bbConnected = blackbaudClient.isConfigured()
    ? await blackbaudClient.getConnectionStatus(req.user.tenantId).then(s => s.connected).catch(() => false)
    : false;
  res.render('ai/chat', {
    title: 'Ask Fund-Raise',
    selectedDate,
    hasData: dates.length > 0,
    conversationId: req.query.c || null,
    bbConnected,
  });
});

// List conversations for the current user
router.get('/api/ai/conversations', ensureAuth, async (req, res) => {
  try {
    const conversations = await Conversation.findAll({
      where: { tenantId: req.user.tenantId, userId: req.user.id },
      order: [['updatedAt', 'DESC']],
      attributes: ['id', 'title', 'createdAt', 'updatedAt'],
    });
    res.json(conversations);
  } catch (err) {
    console.error('[AI Conversations List]', err.message);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// Load a single conversation
router.get('/api/ai/conversations/:id', ensureAuth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch (err) {
    console.error('[AI Conversation Load]', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// Delete a conversation
router.delete('/api/ai/conversations/:id', ensureAuth, async (req, res) => {
  try {
    const deleted = await Conversation.destroy({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!deleted) return res.status(404).json({ error: 'Conversation not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[AI Conversation Delete]', err.message);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

// Rename a conversation
router.patch('/api/ai/conversations/:id', ensureAuth, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    const conv = await Conversation.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    conv.title = title.trim().substring(0, 255);
    await conv.save();
    res.json({ id: conv.id, title: conv.title });
  } catch (err) {
    console.error('[AI Conversation Rename]', err.message);
    res.status(500).json({ error: 'Failed to rename conversation' });
  }
});

// Chat API endpoint - sends message and saves to conversation
router.post('/api/ai/chat', ensureAuth, async (req, res) => {
  try {
    const { messages, conversationId, deepDive } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Each message must have a valid role (user/assistant) and content' });
      }
    }

    const result = await chat(req.user.tenantId, messages, { deepDive: !!deepDive });

    // Build the full messages array including the new assistant reply
    const fullMessages = [...messages, { role: 'assistant', content: result.reply }];

    let convId = conversationId;
    if (convId) {
      // Update existing conversation
      const conv = await Conversation.findOne({
        where: { id: convId, tenantId: req.user.tenantId, userId: req.user.id },
      });
      if (conv) {
        conv.messages = fullMessages;
        await conv.save();
      }
    } else {
      // Create new conversation with auto-generated title
      const title = await generateTitle(req.user.tenantId, messages[0].content);
      const conv = await Conversation.create({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        title,
        messages: fullMessages,
      });
      convId = conv.id;
    }

    res.json({ reply: result.reply, conversationId: convId });
  } catch (err) {
    console.error('[AI Chat Error]', err.message);
    if (err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured. Please set the ANTHROPIC_API_KEY environment variable.' });
    }
    res.status(500).json({ error: 'An error occurred while processing your request. Please try again.' });
  }
});

module.exports = router;
