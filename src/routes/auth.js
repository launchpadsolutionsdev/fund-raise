const router = require('express').Router();
const passport = require('passport');

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign In', flash: res.locals.flash });
});

router.get('/login/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) {
      console.error('[AUTH CALLBACK] Error:', err.message);
      req.flash('danger', 'Authentication error. Please try again.');
      return req.session.save(() => res.redirect('/auth/login'));
    }
    if (!user) {
      const msg = (info && info.message) || 'Authentication failed.';
      console.log('[AUTH CALLBACK] No user:', msg);
      req.flash('danger', msg);
      return req.session.save(() => res.redirect('/auth/login'));
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('[AUTH CALLBACK] Login error:', loginErr.message);
        req.flash('danger', 'Login error. Please try again.');
        return req.session.save(() => res.redirect('/auth/login'));
      }
      console.log('[AUTH CALLBACK] Login success:', user.email);
      req.flash('success', `Welcome, ${user.name || user.email}!`);
      const returnTo = req.session.returnTo || '/dashboard';
      delete req.session.returnTo;
      req.session.save(() => {
        res.redirect(returnTo);
      });
    });
  })(req, res, next);
});

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('info', 'You have been logged out.');
    req.session.save(() => res.redirect('/auth/login'));
  });
});

module.exports = router;
