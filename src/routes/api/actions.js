const router = require('express').Router();
const { body } = require('express-validator');
const { ensureAuth } = require('../../middleware/auth');
const { handleValidation } = require('../../middleware/validate');
const { Action, ActionComment, User, BlackbaudToken, sequelize } = require('../../models');
const { Op, fn, col, literal } = require('sequelize');
const blackbaudActions = require('../../services/blackbaudActions');
const syncStatus = require('../../services/reNxtSyncStatus');

const USER_ATTRS = ['id', 'name', 'email', 'avatarUrl', 'nickname', 'localAvatarPath'];

// Build sort order based on query param
function buildOrder(sort) {
  switch (sort) {
    case 'due':
      return [
        [literal("CASE WHEN due_date IS NULL THEN 1 ELSE 0 END"), 'ASC'],
        ['dueDate', 'ASC'],
        ['createdAt', 'DESC'],
      ];
    case 'created':
      return [['createdAt', 'DESC']];
    case 'priority':
    default:
      return [
        [literal("CASE WHEN priority = 'urgent' THEN 0 WHEN priority = 'high' THEN 1 ELSE 2 END"), 'ASC'],
        [literal("CASE WHEN due_date IS NULL THEN 1 ELSE 0 END"), 'ASC'],
        ['dueDate', 'ASC'],
        ['createdAt', 'DESC'],
      ];
  }
}

// Apply due-date filters to a where clause
function applyDueFilter(where, dueFilter) {
  const today = new Date().toISOString().split('T')[0];
  switch (dueFilter) {
    case 'overdue':
      where.dueDate = { [Op.lt]: today };
      where.status = { [Op.ne]: 'resolved' };
      break;
    case 'today':
      where.dueDate = today;
      break;
    case 'week': {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      where.dueDate = { [Op.between]: [today, weekEnd.toISOString().split('T')[0]] };
      break;
    }
  }
}

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

// Check if tenant has an active Blackbaud connection
async function isBbConnected(tenantId) {
  const token = await BlackbaudToken.findOne({ where: { tenantId }, attributes: ['id'] });
  return !!token;
}

// Fire non-blocking RE NXT sync for an action (create)
function syncActionToReNxt(tenantId, actionId, action, opts = {}) {
  (async () => {
    try {
      const connected = await isBbConnected(tenantId);
      if (!connected) {
        await syncStatus.updateSyncStatus(actionId, { reNxtSyncStatus: 'not_connected' });
        return;
      }

      const result = await blackbaudActions.createAction(tenantId, action, opts);
      if (result.success) {
        await syncStatus.updateSyncStatus(actionId, {
          reNxtActionId: result.reNxtActionId,
          reNxtSyncStatus: 'synced',
          reNxtSyncError: null,
          reNxtLastSyncedAt: new Date(),
        });
      } else {
        await syncStatus.updateSyncStatus(actionId, {
          reNxtSyncStatus: 'failed',
          reNxtSyncError: result.error,
        });
      }
    } catch (err) {
      console.error('[RE NXT SYNC] Create error:', err.message);
      await syncStatus.updateSyncStatus(actionId, { reNxtSyncStatus: 'failed', reNxtSyncError: err.message });
    }
  })();
}

// Fire non-blocking RE NXT sync for status change
function syncStatusToReNxt(tenantId, actionId, reNxtActionId, action, oldStatus, newStatus) {
  if (!reNxtActionId) return;

  (async () => {
    try {
      let result;
      if (newStatus === 'resolved') {
        result = await blackbaudActions.completeAction(tenantId, reNxtActionId, action.resolvedAt);
      } else if (oldStatus === 'resolved') {
        result = await blackbaudActions.reopenAction(tenantId, reNxtActionId);
      } else {
        result = await blackbaudActions.updateAction(tenantId, reNxtActionId, action);
      }

      if (result.success) {
        await syncStatus.updateSyncStatus(actionId, { reNxtSyncStatus: 'synced', reNxtSyncError: null, reNxtLastSyncedAt: new Date() });
      } else {
        await syncStatus.updateSyncStatus(actionId, { reNxtSyncStatus: 'failed', reNxtSyncError: result.error });
      }
    } catch (err) {
      console.error('[RE NXT SYNC] Status update error:', err.message);
      await syncStatus.updateSyncStatus(actionId, { reNxtSyncStatus: 'failed', reNxtSyncError: err.message });
    }
  })();
}

// Fire non-blocking RE NXT delete
function syncDeleteToReNxt(tenantId, reNxtActionId) {
  if (!reNxtActionId) return;
  blackbaudActions.deleteAction(tenantId, reNxtActionId).catch(err => {
    console.error('[RE NXT SYNC] Delete error:', err.message);
  });
}

// ── GET /api/actions — My inbox (assigned to me) ──
router.get('/', ensureAuth, async (req, res) => {
  try {
    const { status, page, limit: lim, sort, dueFilter } = req.query;
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
    if (dueFilter) applyDueFilter(where, dueFilter);

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedBy', attributes: USER_ATTRS },
      ],
      order: buildOrder(sort),
      limit,
      offset,
    });

    // Batch comment counts + sync statuses
    const actionIds = rows.map(a => a.id);
    const [commentCounts, syncMap] = await Promise.all([
      actionIds.length > 0
        ? ActionComment.findAll({
            attributes: ['actionId', [fn('COUNT', col('id')), 'count']],
            where: { actionId: actionIds },
            group: ['actionId'],
            raw: true,
          })
        : [],
      syncStatus.batchGetSyncStatuses(actionIds),
    ]);
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
      dueDate: a.dueDate,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      lastViewedAt: a.lastViewedAt,
      assignedBy: formatAuthor(a.assignedBy),
      commentCount: countMap[a.id] || 0,
      reNxtSyncStatus: syncMap[a.id] || null,
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
    const { status, page, limit: lim, sort, dueFilter } = req.query;
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
    if (dueFilter) applyDueFilter(where, dueFilter);

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      ],
      order: buildOrder(sort),
      limit,
      offset,
    });

    const actionIds = rows.map(a => a.id);
    const [commentCounts, syncMap] = await Promise.all([
      actionIds.length > 0
        ? ActionComment.findAll({
            attributes: ['actionId', [fn('COUNT', col('id')), 'count']],
            where: { actionId: actionIds },
            group: ['actionId'],
            raw: true,
          })
        : [],
      syncStatus.batchGetSyncStatuses(actionIds),
    ]);
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
      dueDate: a.dueDate,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      assignedTo: formatAuthor(a.assignedTo),
      commentCount: countMap[a.id] || 0,
      reNxtSyncStatus: syncMap[a.id] || null,
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

    const { status, page, limit: lim, sort, dueFilter } = req.query;
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
    if (dueFilter) applyDueFilter(where, dueFilter);

    const { count, rows } = await Action.findAndCountAll({
      where,
      include: [
        { model: User, as: 'assignedBy', attributes: USER_ATTRS },
        { model: User, as: 'assignedTo', attributes: USER_ATTRS },
      ],
      order: buildOrder(sort),
      limit,
      offset,
    });

    const actionIds = rows.map(a => a.id);
    const [commentCounts, syncMap] = await Promise.all([
      actionIds.length > 0
        ? ActionComment.findAll({
            attributes: ['actionId', [fn('COUNT', col('id')), 'count']],
            where: { actionId: actionIds },
            group: ['actionId'],
            raw: true,
          })
        : [],
      syncStatus.batchGetSyncStatuses(actionIds),
    ]);
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
      dueDate: a.dueDate,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      assignedBy: formatAuthor(a.assignedBy),
      assignedTo: formatAuthor(a.assignedTo),
      commentCount: countMap[a.id] || 0,
      reNxtSyncStatus: syncMap[a.id] || null,
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
    const today = new Date().toISOString().split('T')[0];

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const [myStats, assignedStats, myOverdue, myDueToday, resolvedYesterday, dueThisWeek] = await Promise.all([
      Action.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        where: { tenantId, assignedToId: userId, status: { [Op.ne]: 'resolved' } },
        group: ['status'],
        raw: true,
      }),
      Action.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        where: { tenantId, assignedById: userId, status: { [Op.ne]: 'resolved' } },
        group: ['status'],
        raw: true,
      }),
      Action.count({
        where: { tenantId, assignedToId: userId, status: { [Op.ne]: 'resolved' }, dueDate: { [Op.lt]: today } },
      }),
      Action.count({
        where: { tenantId, assignedToId: userId, status: { [Op.ne]: 'resolved' }, dueDate: today },
      }),
      Action.count({
        where: {
          tenantId,
          [Op.or]: [{ assignedToId: userId }, { assignedById: userId }],
          status: 'resolved',
          resolvedAt: { [Op.gte]: yesterdayStr + 'T00:00:00', [Op.lt]: today + 'T00:00:00' },
        },
      }),
      Action.count({
        where: {
          tenantId,
          assignedToId: userId,
          status: { [Op.ne]: 'resolved' },
          dueDate: { [Op.between]: [today, weekEndStr] },
        },
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
      myOverdue: myOverdue,
      myDueToday: myDueToday,
      resolvedYesterday: resolvedYesterday,
      dueThisWeek: dueThisWeek,
    });
  } catch (err) {
    console.error('[Actions Stats]', err.message);
    res.status(500).json({ error: 'Failed to load action stats' });
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

// ── GET /api/actions/re-nxt-config — Get cached RE NXT config values ──
router.get('/re-nxt-config', ensureAuth, async (req, res) => {
  try {
    const connected = await isBbConnected(req.user.tenantId);
    if (!connected) {
      return res.json({ connected: false, actionTypes: [], statusTypes: [], locations: [] });
    }

    const config = await blackbaudActions.getAllConfig(req.user.tenantId);
    res.json({ connected: true, ...config });
  } catch (err) {
    console.error('[Actions RE NXT Config]', err.message);
    res.json({ connected: false, actionTypes: [], statusTypes: [], locations: [] });
  }
});

// ── POST /api/actions/re-nxt-config/refresh — Force-refresh RE NXT config ──
router.post('/re-nxt-config/refresh', ensureAuth, async (req, res) => {
  try {
    if (!req.user.isAdmin()) return res.status(403).json({ error: 'Admin access required' });

    const connected = await isBbConnected(req.user.tenantId);
    if (!connected) {
      return res.status(400).json({ error: 'Not connected to Raiser\'s Edge NXT' });
    }

    const config = await blackbaudActions.refreshAllConfig(req.user.tenantId);
    res.json({ success: true, ...config });
  } catch (err) {
    console.error('[Actions RE NXT Config Refresh]', err.message);
    res.status(500).json({ error: 'Failed to refresh config' });
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
      dueDate: action.dueDate,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      lastViewedAt: action.lastViewedAt,
      resolvedAt: action.resolvedAt,
      assignedBy: formatAuthor(action.assignedBy),
      assignedTo: formatAuthor(action.assignedTo),
      resolvedBy: formatAuthor(action.resolvedBy),
      ...(await syncStatus.getSyncStatus(action.id)),
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
router.post('/', ensureAuth,
  body('assignedToId').notEmpty().withMessage('Assignee is required').isInt().withMessage('Invalid assignee'),
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 255 }).withMessage('Title must be under 255 characters'),
  body('description').optional({ values: 'falsy' }).trim().isLength({ max: 5000 }).withMessage('Description must be under 5,000 characters'),
  body('priority').optional().isIn(['normal', 'high', 'urgent']).withMessage('Invalid priority'),
  body('dueDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid due date'),
  handleValidation,
  async (req, res) => {
  try {
    if (!req.user.canUpload()) {
      return res.status(403).json({ error: 'You do not have permission to create actions' });
    }

    const { assignedToId, title, description, constituentName, constituentId, systemRecordId, donorContext, priority, dueDate } = req.body;

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
      dueDate: dueDate || null,
    });

    // Non-blocking RE NXT sync
    const { category, reNxtType, reNxtStatus, direction, location, fundraiserIds } = req.body;
    syncActionToReNxt(req.user.tenantId, action.id, action, {
      category: category || undefined,
      type: reNxtType || undefined,
      status: reNxtStatus || undefined,
      direction: direction || undefined,
      location: location || undefined,
      fundraiserIds: fundraiserIds || undefined,
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

    // Non-blocking RE NXT sync
    const syncData = await syncStatus.getSyncStatus(action.id);
    syncStatusToReNxt(req.user.tenantId, action.id, syncData.reNxtActionId, action, oldStatus, status);

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

// ── PATCH /api/actions/:id/snooze — Snooze / reschedule due date ──
router.patch('/:id/snooze', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!canAccess(action, req.user)) return res.status(403).json({ error: 'Not authorized' });

    const { days, dueDate: newDueDate } = req.body;
    let targetDate;
    if (newDueDate) {
      targetDate = newDueDate;
    } else if (days && [1, 3, 7, 14].includes(parseInt(days))) {
      const base = action.dueDate ? new Date(action.dueDate) : new Date();
      base.setDate(base.getDate() + parseInt(days));
      targetDate = base.toISOString().split('T')[0];
    } else {
      return res.status(400).json({ error: 'Provide days (1, 3, 7, 14) or a dueDate' });
    }

    const oldDate = action.dueDate;
    action.dueDate = targetDate;
    await action.save();

    // System comment
    const userName = req.user.nickname || req.user.name || req.user.email;
    const fromStr = oldDate || 'no due date';
    await ActionComment.create({
      actionId: action.id,
      userId: req.user.id,
      content: `${userName} rescheduled from ${fromStr} to ${targetDate}`,
      isSystemComment: true,
    });

    res.json({ id: action.id, dueDate: action.dueDate });
  } catch (err) {
    console.error('[Actions Snooze]', err.message);
    res.status(500).json({ error: 'Failed to snooze action' });
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

    const reNxtActionId = await syncStatus.getReNxtActionId(action.id);
    await action.destroy();

    // Non-blocking RE NXT delete
    syncDeleteToReNxt(req.user.tenantId, reNxtActionId);

    res.json({ success: true });
  } catch (err) {
    console.error('[Actions Delete]', err.message);
    res.status(500).json({ error: 'Failed to delete action' });
  }
});

// ── POST /api/actions/:id/retry-sync — Retry failed RE NXT sync ──
router.post('/:id/retry-sync', ensureAuth, async (req, res) => {
  try {
    const action = await Action.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId },
    });
    if (!action) return res.status(404).json({ error: 'Action not found' });
    if (!canAccess(action, req.user)) return res.status(403).json({ error: 'Not authorized' });

    const connected = await isBbConnected(req.user.tenantId);
    if (!connected) {
      return res.status(400).json({ error: 'Not connected to Raiser\'s Edge NXT' });
    }

    // Determine whether we need to create or update
    const { category, reNxtType, reNxtStatus } = req.body;
    const opts = {
      category: category || undefined,
      type: reNxtType || undefined,
      status: reNxtStatus || undefined,
    };

    const syncData = await syncStatus.getSyncStatus(action.id);
    let result;
    if (syncData.reNxtActionId) {
      result = await blackbaudActions.updateAction(req.user.tenantId, syncData.reNxtActionId, action, opts);
    } else {
      result = await blackbaudActions.createAction(req.user.tenantId, action, opts);
    }

    if (result.success) {
      await syncStatus.updateSyncStatus(action.id, {
        reNxtActionId: result.reNxtActionId || syncData.reNxtActionId,
        reNxtSyncStatus: 'synced',
        reNxtSyncError: null,
        reNxtLastSyncedAt: new Date(),
      });
      res.json({ success: true, reNxtSyncStatus: 'synced' });
    } else {
      await syncStatus.updateSyncStatus(action.id, {
        reNxtSyncStatus: 'failed',
        reNxtSyncError: result.error,
      });
      res.json({ success: false, reNxtSyncStatus: 'failed', error: result.error });
    }
  } catch (err) {
    console.error('[Actions Retry Sync]', err.message);
    res.status(500).json({ error: 'Failed to retry sync' });
  }
});

module.exports = router;
