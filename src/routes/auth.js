const router = require('express').Router();
const passport = require('passport');

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  res.render('login', { title: 'Sign In', flash: res.locals.flash });
});

router.get('/login/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/callback',
  passport.authenticate('google', { failureRedirect: '/auth/login' }),
  (req, res) => {
    req.flash('success', `Welcome, ${req.user.name || req.user.email}!`);
    const returnTo = req.session.returnTo || '/';
    delete req.session.returnTo;
    // Explicitly save session before redirect so the store has it ready
    req.session.save(() => {
      res.redirect(returnTo);
    });
  }
);

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('info', 'You have been logged out.');
    res.redirect('/auth/login');
  });
});

module.exports = router;
