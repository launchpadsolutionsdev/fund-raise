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

module.exports = { ensureAuth, ensureUploader, ensureAdmin };
