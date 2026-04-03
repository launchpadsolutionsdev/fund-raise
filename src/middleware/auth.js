function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

function ensureUploader(req, res, next) {
  if (req.isAuthenticated() && req.user.canUpload()) return next();
  req.flash('danger', 'You do not have permission to upload data.');
  res.redirect('/');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.isAdmin()) return next();
  req.flash('danger', 'Admin access required.');
  res.redirect('/');
}

module.exports = { ensureAuth, ensureUploader, ensureAdmin };
