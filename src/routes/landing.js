const router = require('express').Router();

// Public landing page
router.get('/', (req, res) => {
  // If user is already logged in, redirect to dashboard
  if (req.isAuthenticated()) {
    return res.redirect('/crm-dashboard');
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

// What's New
router.get('/whats-new', (req, res) => {
  res.render('landing/whats-new');
});

module.exports = router;
