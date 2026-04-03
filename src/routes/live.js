const router = require('express').Router();
const { ensureAuth } = require('../middleware/auth');
const blackbaudClient = require('../services/blackbaudClient');
const blackbaudData = require('../services/blackbaudData');

// Middleware: ensure Blackbaud is connected
async function ensureBbConnected(req, res, next) {
  const status = await blackbaudClient.getConnectionStatus(req.user.tenantId);
  if (!status.connected) {
    req.flash('danger', 'Blackbaud is not connected. Please connect first.');
    return req.session.save(() => res.redirect('/settings/blackbaud'));
  }
  next();
}

// ---------------------------------------------------------------------------
// GET /live/dashboard — Live dashboard page
// ---------------------------------------------------------------------------
router.get('/live/dashboard', ensureAuth, ensureBbConnected, async (req, res) => {
  try {
    res.render('live/dashboard', {
      title: 'Live Dashboard',
    });
  } catch (err) {
    console.error('[LIVE] Dashboard error:', err.message);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

// ---------------------------------------------------------------------------
// API endpoints for live data (called via fetch from the frontend)
// ---------------------------------------------------------------------------

router.get('/api/live/dashboard', ensureAuth, async (req, res) => {
  try {
    const data = await blackbaudData.getLiveDashboardData(req.user.tenantId);
    res.json(data);
  } catch (err) {
    console.error('[LIVE API] Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/live/gifts', ensureAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const data = await blackbaudData.getRecentGifts(req.user.tenantId, limit);
    res.json(data);
  } catch (err) {
    console.error('[LIVE API] Gifts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Diagnostic endpoint — helps debug Blackbaud connection issues
// ---------------------------------------------------------------------------
router.get('/api/live/diagnostic', ensureAuth, async (req, res) => {
  try {
    const status = await blackbaudClient.getConnectionStatus(req.user.tenantId);
    const token = await blackbaudClient.getValidToken(req.user.tenantId);

    const diagnostic = {
      connection: status,
      hasToken: !!token,
      subscriptionKeySet: !!process.env.BLACKBAUD_PRIMARY_ACCESS,
      subscriptionKeyPrefix: process.env.BLACKBAUD_PRIMARY_ACCESS
        ? process.env.BLACKBAUD_PRIMARY_ACCESS.substring(0, 6) + '...'
        : 'NOT SET',
    };

    // Try a simple API call and capture the full response
    if (token) {
      try {
        const testUrl = 'https://api.sky.blackbaud.com/constituent/v1/constituentcodetypes?limit=1';
        const testRes = await fetch(testUrl, {
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Bb-Api-Subscription-Key': process.env.BLACKBAUD_PRIMARY_ACCESS,
          },
        });
        diagnostic.testCall = {
          url: testUrl,
          status: testRes.status,
          statusText: testRes.statusText,
          body: await testRes.text(),
        };
      } catch (fetchErr) {
        diagnostic.testCall = { error: fetchErr.message };
      }
    }

    res.json(diagnostic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
