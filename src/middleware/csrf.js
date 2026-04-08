/**
 * CSRF Protection Middleware
 *
 * Uses the double-submit cookie pattern via csrf-csrf.
 * - A signed CSRF token is stored in a cookie.
 * - Every state-changing request (POST/PUT/PATCH/DELETE) must include
 *   the token in either a header (x-csrf-token) or hidden form field (_csrf).
 * - GET/HEAD/OPTIONS requests are exempt.
 *
 * Templates can access the token via `res.locals.csrfToken`.
 */

const { doubleCsrf } = require('csrf-csrf');

const {
  doubleCsrfProtection,
  generateCsrfToken,
} = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET || 'dev-csrf-secret',
  cookieName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  },
  getTokenFromRequest: (req) => {
    // Check header first (AJAX), then body field (form), then query (fallback)
    return req.headers['x-csrf-token']
      || (req.body && req.body._csrf)
      || req.query._csrf;
  },
});

/**
 * Middleware that:
 * 1. Validates CSRF token on state-changing requests.
 * 2. Generates a fresh token and exposes it on res.locals for templates.
 */
function csrfMiddleware(req, res, next) {
  // Skip CSRF for API endpoints that use their own auth (webhooks, health check)
  if (req.path === '/health' || req.path.startsWith('/auth/callback') || req.path.startsWith('/auth/blackbaud/callback')) {
    return next();
  }

  doubleCsrfProtection(req, res, (err) => {
    if (err) {
      // If CSRF validation failed on an AJAX request, return JSON
      if (req.xhr || (req.headers.accept && req.headers.accept.includes('json'))) {
        return res.status(403).json({ error: 'Invalid or missing CSRF token.' });
      }
      return res.status(403).render('error', {
        title: 'Forbidden',
        status: 403,
        message: 'Your session has expired or the form token is invalid. Please go back and try again.',
      });
    }
    // Generate token and expose to templates
    res.locals.csrfToken = generateCsrfToken(req, res);
    next();
  });
}

module.exports = { csrfMiddleware, generateCsrfToken };
