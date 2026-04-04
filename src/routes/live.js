const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');

// ---------------------------------------------------------------------------
// Live Dashboard — temporarily disabled
// All routes return a "coming soon" state; no Blackbaud API calls are made.
// ---------------------------------------------------------------------------

router.get('/live/dashboard', ensureAuth, (req, res) => {
  res.render('live/dashboard', {
    title: 'Live Dashboard',
    comingSoon: true,
  });
});

// API endpoints — return empty/paused responses (no Blackbaud calls)
router.get('/api/live/dashboard', ensureAuth, (req, res) => {
  res.json({ paused: true, message: 'Live Dashboard is temporarily paused.' });
});

router.get('/api/live/gifts', ensureAuth, (req, res) => {
  res.json({ paused: true, message: 'Live Dashboard is temporarily paused.' });
});

router.get('/api/live/diagnostic', ensureAuth, (req, res) => {
  res.json({ paused: true, message: 'Live Dashboard is temporarily paused.' });
});

module.exports = router;
