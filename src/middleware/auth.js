function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  // AJAX/fetch requests get JSON 401 instead of a redirect to login HTML
  if (req.xhr || req.headers.accept === 'application/json' || req.path.endsWith('/data')) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

function ensureUploader(req, res, next) {
  if (req.isAuthenticated() && req.user.canUpload()) return next();
  req.flash('danger', 'You do not have permission to upload data.');
  res.redirect('/dashboard');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.isAdmin()) return next();
  req.flash('danger', 'Admin access required.');
  res.redirect('/dashboard');
}

/**
 * Redirect admin users to the onboarding wizard if their tenant
 * hasn't completed onboarding yet.  Non-admin users see the normal
 * app (they can't complete the wizard anyway).
 *
 * Skipped for: auth routes, API routes, static assets, and the
 * onboarding routes themselves.
 */
function ensureOnboarded(req, res, next) {
  // Skip for routes that must always be accessible
  if (!req.isAuthenticated()) return next();
  if (req.path.startsWith('/auth') ||
      req.path.startsWith('/api/onboarding') ||
      req.path === '/onboarding' ||
      req.path.startsWith('/uploads/') ||
      req.path.startsWith('/images/') ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/')) {
    return next();
  }

  // Only redirect admins — they're the ones who can complete setup
  if (req.user.role !== 'admin') return next();

  // Check tenant onboarding status (cached in session for perf)
  if (req.session.onboardingCompleted) return next();

  const { Tenant } = require('../models');
  Tenant.findByPk(req.user.tenantId).then(tenant => {
    if (!tenant || tenant.onboardingCompleted) {
      req.session.onboardingCompleted = true;
      return next();
    }
    // Redirect to wizard
    res.redirect('/onboarding');
  }).catch(() => next());
}

module.exports = { ensureAuth, ensureUploader, ensureAdmin, ensureOnboarded };
