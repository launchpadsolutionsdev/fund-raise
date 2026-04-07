const router = require('express').Router();
const { ensureAuth } = require('../../middleware/auth');
const { Action, ActionComment, User, sequelize } = require('../../models');
const { Op } = require('sequelize');

const USER_ATTRS = ['id', 'name', 'email', 'avatarUrl', 'nickname', 'localAvatarPath'];

function formatAuthor(u) {
  if (!u) return null;
  return {
    id: u.id,
    displayName: u.nickname || u.name || u.email,
    avatarSrc: u.localAvatarPath
      ? '/uploads/avatars/' + u.localAvatarPath
      : (u.avatarUrl || null),
  };
}

// Check if user can access an action (assignee, assigner, or admin)
function canAccess(action, user) {
  return action.assignedToId === user.id
    || action.assignedById === user.id
    || user.isAdmin();
}

// ── GET /api/actions — My inbox (assigned to me) ──
router.get('/', ensureAuth, async (req, res) => {
  try {
    const { status, page, limit: lim } = req.query;
    const limit = Math.min(parseInt(lim) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    const where = { tenantId: req.user.tenantId, assignedToId: req.user.id };
    if (status === 'all') {
      // no status filter
    } else if (status && ['open', 'pending', 'resolved'].includes(status)) {
      where.status = status;
    } else {
      where.status = { [Op.ne]: 'resolved' };
    }

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedBy', attributes: USER_ATTRS },
      ],
      order: [
        [sequelize.literal("CASE WHEN priority = 'urgent' THEN 0 WHEN priority = 'high' THEN 1 ELSE 2 END"), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    // Batch comment counts
    const actionIds = rows.map(a => a.id);
    const commentCounts = actionIds.length > 0
      ? await ActionComment.findAll({
          attributes: ['actionId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { actionId: actionIds },
          group: ['actionId'],
          raw: true,
        })
      : [];
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.actionId] = parseInt(c.count); });

    const actions = rows.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      constituentName: a.constituentName,
      constituentId: a.constituentId,
      status: a.status,
      priority: a.priority,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      lastViewedAt: a.lastViewedAt,
      assignedBy: formatAuthor(a.assignedBy),
      commentCount: countMap[a.id] || 0,
    }));

    res.json({ actions, total: count, limit, offset });
  } catch (err) {
    console.error('[Actions List]', err.message);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/actions/assigned — Actions I've assigned to others ──
router.get('/assigned', ensureAuth, async (req, res) => {
  try {
    const { status, page, limit: lim } = req.query;
    const limit = Math.min(parseInt(lim) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    const where = { tenantId: req.user.tenantId, assignedById: req.user.id };
    if (status === 'all') {
      // no status filter
    } else if (status && ['open', 'pending', 'resolved'].includes(status)) {
      where.status = status;
    } else {
      where.status = { [Op.ne]: 'resolved' };
    }

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      ],
      order: [
        [sequelize.literal("CASE WHEN priority = 'urgent' THEN 0 WHEN priority = 'high' THEN 1 ELSE 2 END"), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    const actionIds = rows.map(a => a.id);
    const commentCounts = actionIds.length > 0
      ? await ActionComment.findAll({
          attributes: ['actionId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { actionId: actionIds },
          group: ['actionId'],
          raw: true,
        })
      : [];
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.actionId] = parseInt(c.count); });

    const actions = rows.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      constituentName: a.constituentName,
      constituentId: a.constituentId,
      status: a.status,
      priority: a.priority,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      assignedTo: formatAuthor(a.assignedTo),
      commentCount: countMap[a.id] || 0,
    }));

    res.json({ actions, total: count, limit, offset });
  } catch (err) {
    console.error('[Actions Assigned]', err.message);
    res.status(500).json({ error: 'Failed to load assigned actions' });
  }
});

// ── GET /api/actions/all — Admin overview ──
router.get('/all', ensureAuth, async (req, res) => {
  try {
    if (!req.user.isAdmin()) return res.status(403).json({ error: 'Admin access required' });

    const { status, page, limit: lim } = req.query;
    const limit = Math.min(parseInt(lim) || 20, 100);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * limit;

    const where = { tenantId: req.user.tenantId };
    if (status === 'all') {
      // no filter
    } else if (status && ['open', 'pending', 'resolved'].includes(status)) {
      where.status = status;
    } else {
      where.status = { [Op.ne]: 'resolved' };
    }

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedBy', attributes: USER_ATTRS },
        { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      ],
      order: [
        [sequelize.literal("CASE WHEN priority = 'urgent' THEN 0 WHEN priority = 'high' THEN 1 ELSE 2 END"), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      limit,
      offset,
    });

    const actionIds = rows.map(a => a.id);
    const commentCounts = actionIds.length > 0
      ? await ActionComment.findAll({
          attributes: ['actionId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { actionId: actionIds },
          group: ['actionId'],
          raw: true,
        })
      : [];
    const countMap = {};
    commentCounts.forEach(c => { countMap[c.actionId] = parseInt(c.count); });

    const actions = rows.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      constituentName: a.constituentName,
      constituentId: a.constituentId,
      status: a.status,
      priority: a.priority,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      assignedBy: formatAuthor(a.assignedBy),
      assignedTo: formatAuthor(a.assignedTo),
      commentCount: countMap[a.id] || 0,
    }));

    res.json({ actions, total: count, limit, offset });
  } catch (err) {
    console.error('[Actions All]', err.message);
    res.status(500).json({ error: 'Failed to load actions' });
  }
});

// ── GET /api/actions/stats — Badge counts ──
router.get('/stats', ensureAuth, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    const [myStats, assignedStats] = await Promise.all([
      Action.findAll({
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        where: { tenantId, assignedToId: userId, status: { [Op.ne]: 'resolved' } },
        group: ['status'],
        raw: true,
      }),
      Action.findAll({
        attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
        where: { tenantId, assignedById: userId, status: { [Op.ne]: 'resolved' } },
        group: ['status'],
        raw: true,
      }),
    ]);

    const my = { open: 0, pending: 0 };
    myStats.forEach(r => { my[r.status] = parseInt(r.count); });
    const assigned = { open: 0, pending: 0 };
    assignedStats.forEach(r => { assigned[r.status] = parseInt(r.count); });

    res.json({
      myOpen: my.open,
      myPending: my.pending,
      assignedOpen: assigned.open,
      assignedPending: assigned.pending,
    });
  } catch (err) {
    console.error('[Actions Stats]', err.message);
    res.status(500).json({ error: 'Failed to load action stats' });
  }
});

// ── GET /api/actions/:id — Single action with comments ──
router.get('/:id', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: [
        { model: User, as: 'assignedBy', attributes: USER_ATTRS },
        { model: User, as: 'assignedTo', attributes: USER_ATTRS },
        { model: User, as: 'resolvedBy', attributes: USER_ATTRS },
        {
          model: ActionComment,
          as: 'comments',
          include: [{ model: User, as: 'author', attributes: USER_ATTRS }],
        },
      ],
      order: [[{ model: ActionComment, as: 'comments' }, 'createdAt', 'ASC']],
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!canAccess(action, req.user)) return res.status(403).json({ error: 'Not authorized' });

    res.json({
      id: action.id,
      title: action.title,
      description: action.description,
      constituentName: action.constituentName,
      constituentId: action.constituentId,
      systemRecordId: action.systemRecordId,
      donorContext: action.donorContext,
      status: action.status,
      priority: action.priority,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      lastViewedAt: action.lastViewedAt,
      resolvedAt: action.resolvedAt,
      assignedBy: formatAuthor(action.assignedBy),
      assignedTo: formatAuthor(action.assignedTo),
      resolvedBy: formatAuthor(action.resolvedBy),
      comments: (action.comments || []).map(c => ({
        id: c.id,
        content: c.content,
        isSystemComment: c.isSystemComment,
        createdAt: c.createdAt,
        author: formatAuthor(c.author),
      })),
    });
  } catch (err) {
    console.error('[Actions Detail]', err.message);
    res.status(500).json({ error: 'Failed to load action' });
  }
});

// ── POST /api/actions — Create action ──
router.post('/', ensureAuth, async (req, res) => {
  try {
    if (!req.user.canUpload()) {
      return res.status(403).json({ error: 'You do not have permission to create actions' });
    }

    const { assignedToId, title, description, constituentName, constituentId, systemRecordId, donorContext, priority } = req.body;
    if (!assignedToId) return res.status(400).json({ error: 'Assignee is required' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

    // Verify assignee belongs to the same tenant
    const assignee = await User.findOne({ where: { id: assignedToId, tenantId: req.user.tenantId } });
    if (!assignee) return res.status(400).json({ error: 'Invalid assignee' });

    const action = await Action.create({
      tenantId: req.user.tenantId,
      assignedById: req.user.id,
      assignedToId: parseInt(assignedToId),
      title: title.trim().substring(0, 255),
      description: description ? description.trim() : null,
      constituentName: constituentName || null,
      constituentId: constituentId || null,
      systemRecordId: systemRecordId || null,
      donorContext: donorContext || null,
      priority: ['normal', 'high', 'urgent'].includes(priority) ? priority : 'normal',
    });

    res.status(201).json({ id: action.id });
  } catch (err) {
    console.error('[Actions Create]', err.message);
    res.status(500).json({ error: 'Failed to create action' });
  }
});

// ── PATCH /api/actions/:id/status — Update status ──
router.patch('/:id/status', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!canAccess(action, req.user)) return res.status(403).json({ error: 'Not authorized' });

    const { status } = req.body;
    if (!['open', 'pending', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const oldStatus = action.status;
    action.status = status;

    if (status === 'resolved') {
      action.resolvedAt = new Date();
      action.resolvedById = req.user.id;
    } else if (oldStatus === 'resolved') {
      action.resolvedAt = null;
      action.resolvedById = null;
    }

    await action.save();

    // Create system comment
    const userName = req.user.nickname || req.user.name || req.user.email;
    await ActionComment.create({
      actionId: action.id,
      userId: req.user.id,
      content: `${userName} marked this action as ${status}`,
      isSystemComment: true,
    });

    res.json({ id: action.id, status: action.status });
  } catch (err) {
    console.error('[Actions Status]', err.message);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── POST /api/actions/:id/comments — Add comment ──
router.post('/:id/comments', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!canAccess(action, req.user)) return res.status(403).json({ error: 'Not authorized' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Comment content is required' });

    const comment = await ActionComment.create({
      actionId: action.id,
      userId: req.user.id,
      content: content.trim(),
    });

    res.status(201).json({ id: comment.id });
  } catch (err) {
    console.error('[Actions Comment]', err.message);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ── PATCH /api/actions/:id/reassign — Reassign action ──
router.patch('/:id/reassign', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
      include: [
        { model: User, as: 'assignedTo', attributes: ['id', 'name', 'nickname', 'email'] },
      ],
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (action.assignedById !== req.user.id && !req.user.isAdmin()) {
      return res.status(403).json({ error: 'Only the assigner or admin can reassign' });
    }

    const { assignedToId } = req.body;
    if (!assignedToId) return res.status(400).json({ error: 'New assignee is required' });

    const newAssignee = await User.findOne({ where: { id: assignedToId, tenantId: req.user.tenantId } });
    if (!newAssignee) return res.status(400).json({ error: 'Invalid assignee' });

    const oldName = action.assignedTo.nickname || action.assignedTo.name || action.assignedTo.email;
    const newName = newAssignee.nickname || newAssignee.name || newAssignee.email;
    const userName = req.user.nickname || req.user.name || req.user.email;

    action.assignedToId = parseInt(assignedToId);
    // Reset lastViewedAt for the new assignee
    action.lastViewedAt = null;
    await action.save();

    // System comment
    await ActionComment.create({
      actionId: action.id,
      userId: req.user.id,
      content: `${userName} reassigned this from ${oldName} to ${newName}`,
      isSystemComment: true,
    });

    res.json({ id: action.id, assignedToId: action.assignedToId });
  } catch (err) {
    console.error('[Actions Reassign]', err.message);
    res.status(500).json({ error: 'Failed to reassign action' });
  }
});

// ── DELETE /api/actions/:id — Delete action ──
router.delete('/:id', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (action.assignedById !== req.user.id && !req.user.isAdmin()) {
      return res.status(403).json({ error: 'Only the assigner or admin can delete' });
    }

    await action.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('[Actions Delete]', err.message);
    res.status(500).json({ error: 'Failed to delete action' });
  }
});

// ── GET /api/actions/team-members — List users for assignment dropdown ──
router.get('/team-members', ensureAuth, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenantId: req.user.tenantId, isActive: true },
      attributes: USER_ATTRS,
      order: [['name', 'ASC']],
    });

    res.json(users.map(u => ({
      id: u.id,
      displayName: u.nickname || u.name || u.email,
      avatarSrc: u.localAvatarPath
        ? '/uploads/avatars/' + u.localAvatarPath
        : (u.avatarUrl || null),
    })));
  } catch (err) {
    console.error('[Actions Team]', err.message);
    res.status(500).json({ error: 'Failed to load team members' });
  }
});

module.exports = router;
