const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { chat, chatStream, generateTitle, clearCache } = require('../services/aiService');
const { getAvailableDates } = require('../services/snapshotService');
const blackbaudClient = require('../services/blackbaudClient');
const { Conversation, User } = require('../models');
const { Op } = require('sequelize');

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

// List conversations for the current user (owned + shared with them)
router.get('/api/ai/conversations', ensureAuth, async (req, res) => {
  try {
    const conversations = await Conversation.findAll({
      where: {
        tenantId: req.user.tenantId,
        [Op.or]: [
          { userId: req.user.id },
          { sharedWith: { [Op.contains]: [req.user.id] } },
        ],
      },
      order: [['updatedAt', 'DESC']],
      attributes: ['id', 'title', 'createdAt', 'updatedAt', 'userId', 'sharedWith'],
    });
    // Mark which are shared-with-me
    const result = conversations.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      isShared: c.userId !== req.user.id,
      sharedWith: c.sharedWith || [],
    }));
    res.json(result);
  } catch (err) {
    console.error('[AI Conversations List]', err.message);
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// Load a single conversation (owned or shared with user)
router.get('/api/ai/conversations/:id', ensureAuth, async (req, res) => {
  try {
    const conv = await Conversation.findOne({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
        [Op.or]: [
          { userId: req.user.id },
          { sharedWith: { [Op.contains]: [req.user.id] } },
        ],
      },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    res.json(conv);
  } catch (err) {
    console.error('[AI Conversation Load]', err.message);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// Delete a conversation (only owner)
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

// Rename a conversation (only owner)
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

// Share / unshare a conversation (only owner)
router.post('/api/ai/conversations/:id/share', ensureAuth, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array is required' });
    const conv = await Conversation.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    conv.sharedWith = userIds.filter(id => id !== req.user.id);
    await conv.save();
    res.json({ id: conv.id, sharedWith: conv.sharedWith });
  } catch (err) {
    console.error('[AI Conversation Share]', err.message);
    res.status(500).json({ error: 'Failed to share conversation' });
  }
});

// List team members (for share dialog)
router.get('/api/ai/team-members', ensureAuth, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId },
      attributes: ['id', 'name', 'email'],
      order: [['name', 'ASC']],
    });
    res.json(users.filter(u => u.id !== req.user.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load team members' });
  }
});

// Streaming chat endpoint (SSE)
router.post('/api/ai/chat/stream', ensureAuth, async (req, res) => {
  try {
    const { messages, conversationId, deepDive } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Each message must have a valid role and content' });
      }
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Load existing conversation for KB routing (sticky flag)
    let existingConv = null;
    if (conversationId) {
      existingConv = await Conversation.findOne({
        where: {
          id: conversationId,
          tenantId: req.user.tenantId,
          [Op.or]: [
            { userId: req.user.id },
            { sharedWith: { [Op.contains]: [req.user.id] } },
          ],
        },
      });
    }

    const result = await chatStream(req.user.tenantId, messages, {
      deepDive: !!deepDive,
      conversation: existingConv,
    }, res);

    // Save conversation after streaming completes
    const fullMessages = [...messages, { role: 'assistant', content: result.reply }];

    let convId = conversationId;
    if (convId && existingConv) {
      existingConv.messages = fullMessages;
      // Set sticky RE NXT session flag if KB was injected
      if (result.kbInjected && !existingConv.isRenxtSession) {
        existingConv.isRenxtSession = true;
      }
      await existingConv.save();
    } else {
      const title = await generateTitle(req.user.tenantId, messages[0].content);
      const conv = await Conversation.create({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        title,
        messages: fullMessages,
        isRenxtSession: !!result.kbInjected,
      });
      convId = conv.id;
    }

    // Send conversation ID as final event
    res.write(`event: saved\ndata: ${JSON.stringify({ conversationId: convId })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[AI Stream Error]', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Non-streaming chat endpoint (kept for compatibility)
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

    const fullMessages = [...messages, { role: 'assistant', content: result.reply }];

    let convId = conversationId;
    if (convId) {
      const conv = await Conversation.findOne({
        where: { id: convId, tenantId: req.user.tenantId, userId: req.user.id },
      });
      if (conv) {
        conv.messages = fullMessages;
        await conv.save();
      }
    } else {
      const title = await generateTitle(req.user.tenantId, messages[0].content);
      const conv = await Conversation.create({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        title,
        messages: fullMessages,
      });
      convId = conv.id;
    }

    res.json({ reply: result.reply, conversationId: convId, citations: result.citations || [] });
  } catch (err) {
    console.error('[AI Chat Error]', err.message);
    if (err.message.includes('ANTHROPIC_API_KEY')) {
      return res.status(503).json({ error: 'AI service is not configured. Please set the ANTHROPIC_API_KEY environment variable.' });
    }
    res.status(500).json({ error: 'An error occurred while processing your request. Please try again.' });
  }
});

module.exports = router;
