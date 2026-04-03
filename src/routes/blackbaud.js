const router = require('express').Router();
const crypto = require('crypto');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');
const blackbaud = require('../services/blackbaudClient');

// ---------------------------------------------------------------------------
// GET /auth/blackbaud — Initiate OAuth flow (admin only)
// ---------------------------------------------------------------------------
router.get('/auth/blackbaud', ensureAuth, ensureAdmin, (req, res) => {
  if (!blackbaud.isConfigured()) {
    req.flash('danger', 'Blackbaud API is not configured. Check environment variables.');
    return req.session.save(() => res.redirect('/settings/blackbaud'));
  }

  // Generate a random state parameter and store in session
  const state = crypto.randomBytes(16).toString('hex');
  req.session.blackbaudOAuthState = state;

  const authorizeUrl = blackbaud.getAuthorizeUrl(state);
  req.session.save(() => res.redirect(authorizeUrl));
});

// ---------------------------------------------------------------------------
// GET /auth/blackbaud/callback — OAuth callback
// ---------------------------------------------------------------------------
router.get('/auth/blackbaud/callback', ensureAuth, async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('[BLACKBAUD] OAuth error:', error);
      req.flash('danger', `Blackbaud authorization failed: ${error}`);
      return req.session.save(() => res.redirect('/settings/blackbaud'));
    }

    if (!code) {
      req.flash('danger', 'No authorization code received from Blackbaud.');
      return req.session.save(() => res.redirect('/settings/blackbaud'));
    }

    // Verify state parameter
    if (state !== req.session.blackbaudOAuthState) {
      console.error('[BLACKBAUD] State mismatch:', state, '!==', req.session.blackbaudOAuthState);
      req.flash('danger', 'Invalid OAuth state. Please try connecting again.');
      return req.session.save(() => res.redirect('/settings/blackbaud'));
    }
    delete req.session.blackbaudOAuthState;

    // Exchange code for tokens
    console.log('[BLACKBAUD] Exchanging authorization code for tokens...');
    const tokenData = await blackbaud.exchangeCodeForTokens(code);
    console.log('[BLACKBAUD] Token exchange successful.');

    // Save tokens
    await blackbaud.saveToken(req.user.tenantId, req.user.id, tokenData);
    console.log('[BLACKBAUD] Tokens saved for tenant:', req.user.tenantId);

    // Try to get environment info
    try {
      const envData = await blackbaud.apiRequest(req.user.tenantId, '/constituent/v1/constituentcodetypes?limit=1');
      console.log('[BLACKBAUD] API test call successful.');
    } catch (apiErr) {
      console.warn('[BLACKBAUD] API test call failed (non-critical):', apiErr.message);
    }

    req.flash('success', 'Blackbaud connected successfully! Live data is now available.');
    req.session.save(() => res.redirect('/settings/blackbaud'));
  } catch (err) {
    console.error('[BLACKBAUD] Callback error:', err.message);
    req.flash('danger', `Connection failed: ${err.message}`);
    req.session.save(() => res.redirect('/settings/blackbaud'));
  }
});

// ---------------------------------------------------------------------------
// POST /auth/blackbaud/disconnect — Remove connection (admin only)
// ---------------------------------------------------------------------------
router.post('/auth/blackbaud/disconnect', ensureAuth, ensureAdmin, async (req, res) => {
  try {
    await blackbaud.disconnect(req.user.tenantId);
    console.log('[BLACKBAUD] Disconnected for tenant:', req.user.tenantId);
    req.flash('success', 'Blackbaud connection removed.');
    req.session.save(() => res.redirect('/settings/blackbaud'));
  } catch (err) {
    console.error('[BLACKBAUD] Disconnect error:', err.message);
    req.flash('danger', 'Failed to disconnect: ' + err.message);
    req.session.save(() => res.redirect('/settings/blackbaud'));
  }
});

// ---------------------------------------------------------------------------
// GET /settings/blackbaud — Connection management page
// ---------------------------------------------------------------------------
router.get('/settings/blackbaud', ensureAuth, async (req, res) => {
  try {
    const configured = blackbaud.isConfigured();
    const status = configured ? await blackbaud.getConnectionStatus(req.user.tenantId) : { connected: false };

    res.render('settings/blackbaud', {
      title: 'Blackbaud Connection',
      configured,
      status,
    });
  } catch (err) {
    console.error('[BLACKBAUD] Settings page error:', err.message);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong.' });
  }
});

module.exports = router;
