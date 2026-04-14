const router = require('express').Router();
const { Op } = require('sequelize');
const { ensureAuth } = require('../middleware/auth');
const { WritingOutput } = require('../models');

const FEATURES = ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest'];
const RATINGS = ['helpful', 'neutral', 'not_helpful'];

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * Writing Library — user-facing endpoints over persisted writing_outputs.
 *
 * Scope: every generation is auto-saved by WritingService. These endpoints
 * let the user browse, promote, rate, and hide their history. All queries
 * are tenant- and user-scoped; hidden rows (is_hidden = true) are excluded
 * by default so we preserve aggregate learning data without cluttering the
 * user's library.
 */

// ── List the current user's writing history ──
// Query params:
//   feature  — filter to one feature ('writing' | 'thankYou' | ...)
//   saved    — 'true' to return only saved items
//   rated    — 'true' to return only rated items (any rating)
//   limit    — 1..100 (default 50)
//   offset   — pagination offset (default 0)
router.get('/api/writing/library', ensureAuth, async (req, res) => {
  try {
    const where = {
      tenantId: req.user.tenantId,
      userId: req.user.id,
      isHidden: false,
    };

    if (req.query.feature && FEATURES.includes(req.query.feature)) {
      where.feature = req.query.feature;
    }
    if (req.query.saved === 'true') {
      where.isSaved = true;
    }
    if (req.query.rated === 'true') {
      where.rating = { [Op.ne]: null };
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const { rows, count } = await WritingOutput.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
      // Omit the full generated text from the list view — clients fetch the
      // detail endpoint when they need the body. Keeps payloads small even
      // when a user has hundreds of rows.
      attributes: [
        'id', 'feature', 'params', 'model',
        'rating', 'isSaved', 'savedName',
        'createdAt', 'updatedAt',
      ],
    });

    res.json({ total: count, limit, offset, items: rows });
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to load writing history.' });
  }
});

// ── Fetch a single output (with full generated text) ──
router.get('/api/writing/library/:id', ensureAuth, async (req, res) => {
  try {
    const output = await WritingOutput.findOne({
      where: {
        id: req.params.id,
        tenantId: req.user.tenantId,
        userId: req.user.id,
        isHidden: false,
      },
    });
    if (!output) return res.status(404).json({ error: 'Not found' });
    res.json(output);
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to load output.' });
  }
});

// ── Rate an output ──
// Body: { rating: 'helpful' | 'neutral' | 'not_helpful' | null, feedbackNote?: string }
router.post('/api/writing/library/:id/rate', ensureAuth, async (req, res) => {
  try {
    const { rating, feedbackNote } = req.body || {};
    if (rating !== null && !RATINGS.includes(rating)) {
      return res.status(400).json({ error: 'Invalid rating.' });
    }

    const output = await WritingOutput.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!output) return res.status(404).json({ error: 'Not found' });

    output.rating = rating;
    if (typeof feedbackNote === 'string') {
      // Clamp to a reasonable length so we never blow up the row.
      output.feedbackNote = feedbackNote.slice(0, 2000) || null;
    }
    await output.save();
    res.json({ id: output.id, rating: output.rating, feedbackNote: output.feedbackNote });
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to rate output.' });
  }
});

// ── Promote an output into the saved library ──
// Body: { name?: string }  — defaults to "<feature> — <date>"
router.post('/api/writing/library/:id/save', ensureAuth, async (req, res) => {
  try {
    const { name } = req.body || {};
    const output = await WritingOutput.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!output) return res.status(404).json({ error: 'Not found' });

    const trimmed = typeof name === 'string' ? name.trim().slice(0, 255) : '';
    output.isSaved = true;
    output.savedName = trimmed || defaultSavedName(output);
    await output.save();
    res.json({ id: output.id, isSaved: true, savedName: output.savedName });
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to save output.' });
  }
});

// ── Remove from saved library (history row remains) ──
router.post('/api/writing/library/:id/unsave', ensureAuth, async (req, res) => {
  try {
    const output = await WritingOutput.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!output) return res.status(404).json({ error: 'Not found' });
    output.isSaved = false;
    output.savedName = null;
    await output.save();
    res.json({ id: output.id, isSaved: false });
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to update output.' });
  }
});

// ── Soft-delete from the user's history ──
// Row is retained with is_hidden = true so aggregate analytics and prompt
// learning are unaffected. A true DELETE would forfeit that signal.
router.delete('/api/writing/library/:id', ensureAuth, async (req, res) => {
  try {
    const output = await WritingOutput.findOne({
      where: { id: req.params.id, tenantId: req.user.tenantId, userId: req.user.id },
    });
    if (!output) return res.status(404).json({ error: 'Not found' });
    output.isHidden = true;
    output.isSaved = false;
    await output.save();
    res.json({ success: true });
  } catch (err) {
    console.error('[Writing Library]', err.message);
    res.status(500).json({ error: 'Failed to delete output.' });
  }
});

const FEATURE_LABELS = {
  writing: 'Writing Assistant',
  thankYou: 'Thank-You Letter',
  impact: 'Impact Story',
  meetingPrep: 'Meeting Briefing',
  digest: 'Weekly Digest',
};

function defaultSavedName(output) {
  const label = FEATURE_LABELS[output.feature] || 'Writing';
  const date = output.createdAt ? new Date(output.createdAt).toLocaleDateString('en-CA') : '';
  return date ? `${label} — ${date}` : label;
}

module.exports = router;
