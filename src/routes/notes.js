const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const { QuickNote } = require('../models');

// ── Page ──
router.get('/notes', ensureAuth, (req, res) => {
  res.render('notes/index', { title: 'Quick Notes' });
});

// ── API ──

// Get all notes for the current user
router.get('/api/notes', ensureAuth, async (req, res) => {
  try {
    const notes = await QuickNote.findAll({
      where: { userId: req.user.id, tenantId: req.user.tenantId },
      order: [['sortOrder', 'ASC'], ['createdAt', 'DESC']],
    });
    res.json(notes);
  } catch (err) {
    console.error('[Notes]', err.message);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

// Create a new note
router.post('/api/notes', ensureAuth, async (req, res) => {
  try {
    const { content, color } = req.body;
    const maxOrder = await QuickNote.max('sortOrder', {
      where: { userId: req.user.id, tenantId: req.user.tenantId },
    }) || 0;

    const note = await QuickNote.create({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      content: (content || '').trim(),
      color: color || 'yellow',
      sortOrder: maxOrder + 1,
    });
    res.status(201).json(note);
  } catch (err) {
    console.error('[Note Create]', err.message);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// Update a note
router.put('/api/notes/:id', ensureAuth, async (req, res) => {
  try {
    const note = await QuickNote.findOne({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const { content, color } = req.body;
    if (typeof content !== 'undefined') note.content = content;
    if (typeof color !== 'undefined') note.color = color;
    await note.save();
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// Delete a note
router.delete('/api/notes/:id', ensureAuth, async (req, res) => {
  try {
    const deleted = await QuickNote.destroy({
      where: { id: req.params.id, userId: req.user.id },
    });
    if (!deleted) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// Reorder notes
router.put('/api/notes/reorder', ensureAuth, async (req, res) => {
  try {
    const { order } = req.body; // array of note IDs in new order
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

    for (let i = 0; i < order.length; i++) {
      await QuickNote.update({ sortOrder: i }, {
        where: { id: order[i], userId: req.user.id },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reorder notes' });
  }
});

module.exports = router;
