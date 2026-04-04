const router = require('express').Router();
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const { Milestone, User } = require('../models');

// ── Page ──
router.get('/milestones', ensureAuth, (req, res) => {
  res.render('milestones/index', { title: 'Milestones' });
});

// ── API ──

// List all milestones for the tenant
router.get('/api/milestones', ensureAuth, async (req, res) => {
  try {
    const milestones = await Milestone.findAll({
      where: { tenantId: req.user.tenantId },
      include: [{ model: User, as: 'createdBy', attributes: ['id', 'name', 'nickname'] }],
      order: [['reached', 'ASC'], ['targetValue', 'ASC'], ['createdAt', 'DESC']],
    });
    res.json(milestones.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      milestoneType: m.milestoneType,
      targetValue: parseFloat(m.targetValue) || 0,
      department: m.department,
      reached: m.reached,
      reachedAt: m.reachedAt,
      celebrationEmoji: m.celebrationEmoji,
      createdBy: m.createdBy ? (m.createdBy.nickname || m.createdBy.name) : null,
      createdAt: m.createdAt,
    })));
  } catch (err) {
    console.error('[Milestones]', err.message);
    res.status(500).json({ error: 'Failed to load milestones' });
  }
});

// Create milestone (admin only)
router.post('/api/milestones', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const { title, description, milestoneType, targetValue, department, celebrationEmoji } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

    const milestone = await Milestone.create({
      tenantId: req.user.tenantId,
      title: title.trim(),
      description: (description || '').trim() || null,
      milestoneType: milestoneType || 'amount',
      targetValue: targetValue || null,
      department: department || null,
      celebrationEmoji: celebrationEmoji || '🎉',
      createdById: req.user.id,
    });
    res.status(201).json({ id: milestone.id });
  } catch (err) {
    console.error('[Milestone Create]', err.message);
    res.status(500).json({ error: 'Failed to create milestone' });
  }
});

// Mark milestone as reached (admin only)
router.patch('/api/milestones/:id/celebrate', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const milestone = await Milestone.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!milestone) return res.status(404).json({ error: 'Milestone not found' });
    milestone.reached = true;
    milestone.reachedAt = new Date();
    await milestone.save();
    res.json({ id: milestone.id, reached: true, reachedAt: milestone.reachedAt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to celebrate milestone' });
  }
});

// Delete milestone (admin only)
router.delete('/api/milestones/:id', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    const deleted = await Milestone.destroy({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!deleted) return res.status(404).json({ error: 'Milestone not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete milestone' });
  }
});

// Check for newly reached milestones (called from dashboard or on demand)
router.get('/api/milestones/check', ensureAuth, async (req, res) => {
  try {
    // This returns any milestones that were recently reached (within last 24h)
    // so the frontend can trigger celebration animations
    const recent = await Milestone.findAll({
      where: {
        tenantId: req.user.tenantId,
        reached: true,
        reachedAt: { [require('sequelize').Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      order: [['reachedAt', 'DESC']],
    });
    res.json(recent.map(m => ({
      id: m.id,
      title: m.title,
      celebrationEmoji: m.celebrationEmoji,
      reachedAt: m.reachedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to check milestones' });
  }
});

module.exports = router;
