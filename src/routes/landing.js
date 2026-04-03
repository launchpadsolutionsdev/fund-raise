const router = require('express').Router();

// Public landing page
router.get('/', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('landing/index');
});

// Privacy Policy
router.get('/privacy', (req, res) => {
  res.render('landing/privacy');
});

// Terms of Service
router.get('/terms', (req, res) => {
  res.render('landing/terms');
});

module.exports = router;
