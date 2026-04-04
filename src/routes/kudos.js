const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { Kudos, User } = require('../models');
const { Op } = require('sequelize');

// ── Page ──
router.get('/kudos', ensureAuth, (req, res) => {
  res.render('kudos/wall', { title: 'Kudos Wall' });
});

// ── API: List kudos ──
router.get('/api/kudos', ensureAuth, async (req, res) => {
  try {
    const { limit = 30, offset = 0 } = req.query;
    const kudos = await Kudos.findAll({
      where: { tenantId: req.user.tenantId },
      include: [
        { model: User, as: 'fromUser', attributes: ['id', 'name', 'nickname', 'avatarUrl', 'localAvatarPath'] },
        { model: User, as: 'toUser', attributes: ['id', 'name', 'nickname', 'avatarUrl', 'localAvatarPath'] },
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset),
    });

    res.json(kudos.map(k => ({
      id: k.id,
      from: {
        id: k.fromUser.id,
        name: k.fromUser.nickname || k.fromUser.name || 'Unknown',
        avatar: k.fromUser.localAvatarPath ? '/uploads/avatars/' + k.fromUser.localAvatarPath.split('/').pop() : k.fromUser.avatarUrl,
      },
      to: {
        id: k.toUser.id,
        name: k.toUser.nickname || k.toUser.name || 'Unknown',
        avatar: k.toUser.localAvatarPath ? '/uploads/avatars/' + k.toUser.localAvatarPath.split('/').pop() : k.toUser.avatarUrl,
      },
      message: k.message,
      category: k.category,
      emoji: k.emoji,
      reactions: k.reactions || {},
      createdAt: k.created_at || k.createdAt,
    })));
  } catch (err) {
    console.error('[Kudos List]', err.message);
    res.status(500).json({ error: 'Failed to load kudos' });
  }
});

// ── API: Send kudos ──
router.post('/api/kudos', ensureAuth, async (req, res) => {
  try {
    const { toUserId, message, category, emoji } = req.body;
    if (!toUserId || !message || !message.trim()) {
      return res.status(400).json({ error: 'Recipient and message are required' });
    }
    if (parseInt(toUserId) === req.user.id) {
      return res.status(400).json({ error: 'You cannot send kudos to yourself' });
    }

    // Verify recipient exists in same tenant
    const recipient = await User.findOne({
      where: { id: toUserId, tenantId: req.user.tenantId },
    });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const CATEGORIES = ['general', 'teamwork', 'innovation', 'above-and-beyond', 'milestone', 'mentorship'];
    const EMOJIS = ['⭐', '🏆', '💪', '🎯', '🔥', '💡', '❤️', '🙌', '👏', '🌟'];

    const kudos = await Kudos.create({
      tenantId: req.user.tenantId,
      fromUserId: req.user.id,
      toUserId: parseInt(toUserId),
      message: message.trim(),
      category: CATEGORIES.includes(category) ? category : 'general',
      emoji: EMOJIS.includes(emoji) ? emoji : '⭐',
    });

    res.status(201).json({ id: kudos.id });
  } catch (err) {
    console.error('[Kudos Create]', err.message);
    res.status(500).json({ error: 'Failed to send kudos' });
  }
});

// ── API: React to kudos ──
router.post('/api/kudos/:id/react', ensureAuth, async (req, res) => {
  try {
    const { emoji } = req.body;
    const REACTION_EMOJIS = ['❤️', '🎉', '👏', '🔥', '💯', '😊'];
    if (!emoji || !REACTION_EMOJIS.includes(emoji)) {
      return res.status(400).json({ error: 'Invalid reaction' });
    }

    const kudos = await Kudos.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!kudos) return res.status(404).json({ error: 'Kudos not found' });

    const reactions = kudos.reactions || {};
    if (!reactions[emoji]) reactions[emoji] = [];

    const idx = reactions[emoji].indexOf(req.user.id);
    if (idx >= 0) {
      reactions[emoji].splice(idx, 1);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji].push(req.user.id);
    }

    kudos.reactions = reactions;
    kudos.changed('reactions', true);
    await kudos.save();

    res.json({ reactions: kudos.reactions });
  } catch (err) {
    console.error('[Kudos React]', err.message);
    res.status(500).json({ error: 'Failed to react' });
  }
});

// ── API: Team members for dropdown ──
router.get('/api/kudos/team', ensureAuth, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId, id: { [Op.ne]: req.user.id } },
      attributes: ['id', 'name', 'nickname'],
      order: [['name', 'ASC']],
    });
    res.json(users.map(u => ({ id: u.id, name: u.nickname || u.name })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load team' });
  }
});

module.exports = router;
