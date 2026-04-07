const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { Action, User } = require('../models');

// ── Pages ──

router.get('/actions', ensureAuth, (req, res) => {
  res.render('actions/index', { title: 'Action Centre' });
});

router.get('/actions/:id', ensureAuth, async (req, res) => {
  // Validate action exists and user can access it before rendering
  const action = await Action.findOne({
    where: { id: req.params.id, tenantId: req.user.tenantId },
  });
  if (!action) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Action not found.' });
  }
  if (action.assignedToId !== req.user.id && action.assignedById !== req.user.id && !req.user.isAdmin()) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You do not have access to this action.' });
  }

  // Update lastViewedAt if the current user is the assignee
  if (action.assignedToId === req.user.id) {
    action.lastViewedAt = new Date();
    await action.save();
  }

  res.render('actions/detail', { title: 'Action Detail', actionId: req.params.id });
});

module.exports = router;
