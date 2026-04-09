const router = require('express').Router();
const multer = require('multer');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const { chat, chatStream, generateTitle, clearCache } = require('../services/aiService');
const { getAvailableDates } = require('../services/snapshotService');
const blackbaudClient = require('../services/blackbaudClient');
const { Conversation, User, AiUsageLog, sequelize } = require('../models');
const { Op, fn, col, literal } = require('sequelize');
const { aiRateLimitMiddleware } = require('../services/aiRateLimit');
const { validateMessageLength } = require('../services/conversationManager');
const { detectInjection } = require('../services/aiSecurity');

// Multer config for image uploads (memory storage, 5MB max)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed.'));
    }
  },
});

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
    if (!Array.isArray(userIds) || !userIds.every(id => Number.isInteger(id) && id > 0)) {
      return res.status(400).json({ error: 'userIds must be an array of positive integers' });
    }
    const filteredIds = userIds.filter(id => id !== req.user.id);
    // Validate ALL userIds belong to the same tenant
    if (filteredIds.length > 0) {
      const validUsers = await User.count({
        where: { id: filteredIds, tenantId: req.user.tenantId },
      });
      if (validUsers !== filteredIds.length) {
        return res.status(403).json({ error: 'One or more users do not belong to your organization' });
      }
    }
    const conv = await Conversation.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    conv.sharedWith = filteredIds;
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

// Streaming chat endpoint (SSE) — supports optional image upload via multipart
router.post('/api/ai/chat/stream', ensureAuth, aiRateLimitMiddleware, imageUpload.single('image'), async (req, res) => {
  try {
    // Parse body — may come as JSON string in multipart form or as plain JSON
    let body = req.body;
    if (typeof body.payload === 'string') {
      body = JSON.parse(body.payload);
    }
    const { messages, conversationId, deepDive, crmMode } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    for (const msg of messages) {
      if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({ error: 'Each message must have a valid role and content' });
      }
    }

    // Validate message length
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      const lengthCheck = validateMessageLength(lastMsg.content);
      if (!lengthCheck.valid) {
        return res.status(400).json({ error: lengthCheck.error });
      }
    }

    // Prompt injection detection (log + flag, don't block — reduces false positives)
    if (lastMsg && lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
      const injection = detectInjection(lastMsg.content);
      if (injection.flagged) {
        console.warn(`[AI Security] Possible prompt injection from user ${req.user.id}: pattern=${injection.pattern}`);
      }
    }

    // If an image was uploaded, attach it to the last user message as multimodal content
    const hasImage = !!req.file;
    if (req.file) {
      const base64Data = req.file.buffer.toString('base64');
      const mediaType = req.file.mimetype;
      const lastUserIdx = messages.length - 1;
      const lastMsg = messages[lastUserIdx];
      if (lastMsg.role === 'user') {
        // Convert string content to multimodal content array
        const textContent = typeof lastMsg.content === 'string' ? lastMsg.content : '';
        lastMsg.content = [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data,
            },
          },
          { type: 'text', text: textContent || 'What do you see in this image?' },
        ];
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
      crmMode: !!crmMode,
      conversation: existingConv,
      hasImage,
      userRole: req.user.role,
      userId: req.user.id,
    }, res);

    // Save conversation after streaming completes
    // For storage, convert multimodal content back to text (don't persist base64 images in DB)
    const storableMessages = messages.map(m => {
      if (Array.isArray(m.content)) {
        const textParts = m.content.filter(b => b.type === 'text').map(b => b.text);
        const hasImg = m.content.some(b => b.type === 'image');
        return {
          role: m.role,
          content: (hasImg ? '[Image attached] ' : '') + textParts.join(' '),
        };
      }
      return m;
    });
    const fullMessages = [...storableMessages, { role: 'assistant', content: result.reply }];

    let convId = conversationId;
    if (convId && existingConv) {
      existingConv.messages = fullMessages;
      // Set sticky RE NXT session flag if KB was injected
      if (result.kbInjected && !existingConv.isRenxtSession) {
        existingConv.isRenxtSession = true;
      }
      await existingConv.save();
    } else {
      const firstMsgText = storableMessages[0]?.content || 'New conversation';
      const title = await generateTitle(req.user.tenantId, firstMsgText);
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
    // Handle multer file size / type errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      if (!res.headersSent) return res.status(400).json({ error: 'Image must be under 5MB.' });
    }
    if (err.message && err.message.includes('Only PNG')) {
      if (!res.headersSent) return res.status(400).json({ error: err.message });
    }
    if (!res.headersSent) {
      return res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Non-streaming chat endpoint (kept for compatibility)
router.post('/api/ai/chat', ensureAuth, aiRateLimitMiddleware, async (req, res) => {
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

// ─── AI Analytics ──────────────────────────────────────────────────────────

// Render analytics page (admin only)
router.get('/ai-analytics', ensureAuth, ensureAdmin, (req, res) => {
  res.render('ai/analytics', { title: 'AI Analytics' });
});

// API: aggregated AI usage stats
router.get('/api/ai/analytics', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { days = 30 } = req.query;
    const since = new Date();
    since.setDate(since.getDate() - Math.min(parseInt(days, 10) || 30, 365));

    const where = { tenantId, createdAt: { [Op.gte]: since } };

    // Check if table exists (migration may not have run yet)
    try {
      await AiUsageLog.findOne({ where: { tenantId }, limit: 1, raw: true });
    } catch (tableErr) {
      // Table doesn't exist yet — return empty data
      console.warn('[AI Analytics] ai_usage_logs table not available:', tableErr.message);
      return res.json({
        summary: { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheCreationTokens: 0, avgDurationMs: 0, successCount: 0, errorCount: 0, totalToolRounds: 0 },
        daily: [], byUser: [], topTools: [], byModel: [],
      });
    }

    // Summary KPIs
    const summary = await AiUsageLog.findOne({
      where,
      attributes: [
        [fn('COUNT', col('id')), 'totalRequests'],
        [fn('SUM', col('input_tokens')), 'totalInputTokens'],
        [fn('SUM', col('output_tokens')), 'totalOutputTokens'],
        [fn('SUM', col('cache_read_tokens')), 'totalCacheReadTokens'],
        [fn('SUM', col('cache_creation_tokens')), 'totalCacheCreationTokens'],
        [fn('AVG', col('duration_ms')), 'avgDurationMs'],
        [fn('SUM', literal('CASE WHEN success = true THEN 1 ELSE 0 END')), 'successCount'],
        [fn('SUM', literal('CASE WHEN success = false THEN 1 ELSE 0 END')), 'errorCount'],
        [fn('SUM', col('tool_rounds')), 'totalToolRounds'],
      ],
      raw: true,
    });

    // Daily breakdown
    const daily = await AiUsageLog.findAll({
      where,
      attributes: [
        [fn('DATE', col('created_at')), 'date'],
        [fn('COUNT', col('id')), 'requests'],
        [fn('SUM', col('input_tokens')), 'inputTokens'],
        [fn('SUM', col('output_tokens')), 'outputTokens'],
        [fn('SUM', col('cache_read_tokens')), 'cacheReadTokens'],
        [fn('AVG', col('duration_ms')), 'avgDuration'],
        [fn('SUM', literal('CASE WHEN success = false THEN 1 ELSE 0 END')), 'errors'],
      ],
      group: [fn('DATE', col('created_at'))],
      order: [[fn('DATE', col('created_at')), 'ASC']],
      raw: true,
    });

    // Per-user breakdown
    const byUser = await AiUsageLog.findAll({
      where,
      attributes: [
        'userId',
        [fn('COUNT', col('AiUsageLog.id')), 'requests'],
        [fn('SUM', col('input_tokens')), 'inputTokens'],
        [fn('SUM', col('output_tokens')), 'outputTokens'],
        [fn('AVG', col('duration_ms')), 'avgDuration'],
      ],
      include: [{ model: User, attributes: ['name', 'email'] }],
      group: ['AiUsageLog.user_id', 'User.id', 'User.name', 'User.email'],
      order: [[fn('COUNT', col('AiUsageLog.id')), 'DESC']],
      limit: 20,
      raw: true,
      nest: true,
    });

    // Top tools — fetch all rows with tools, aggregate in JS
    const toolRows = await AiUsageLog.findAll({
      where,
      attributes: ['toolsUsed'],
      raw: true,
    });
    const toolCounts = {};
    for (const row of toolRows) {
      const tools = Array.isArray(row.toolsUsed) ? row.toolsUsed : [];
      for (const t of tools) {
        toolCounts[t] = (toolCounts[t] || 0) + 1;
      }
    }
    const topTools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([name, count]) => ({ name, count }));

    // Model breakdown
    const byModel = await AiUsageLog.findAll({
      where,
      attributes: [
        'model',
        [fn('COUNT', col('id')), 'requests'],
        [fn('SUM', col('input_tokens')), 'inputTokens'],
        [fn('SUM', col('output_tokens')), 'outputTokens'],
      ],
      group: ['model'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      raw: true,
    });

    res.json({ summary, daily, byUser, topTools, byModel });
  } catch (err) {
    console.error('[AI Analytics API]', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load analytics data' });
  }
});

module.exports = router;
