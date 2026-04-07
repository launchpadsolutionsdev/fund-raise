const router = require('express').Router();
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { User, Tenant } = require('../models');
const emailService = require('../services/emailService');

// Rate-limit login attempts: 10 per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again in 15 minutes.',
});

router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/crm-dashboard');
  res.render('login', { title: 'Sign In', flash: res.locals.flash });
});

router.get('/login/google', authLimiter,
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
      console.log('[AUTH CALLBACK] Login success');
      req.flash('success', `Welcome, ${user.name || user.email}!`);
      const returnTo = req.session.returnTo || '/crm-dashboard';
      delete req.session.returnTo;
      req.session.save(() => {
        res.redirect(returnTo);
      });
    });
  })(req, res, next);
});

// Accept invitation — landing page that validates token, then redirects to Google OAuth
router.get('/accept-invite', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      req.flash('danger', 'Invalid invitation link.');
      return req.session.save(() => res.redirect('/auth/login'));
    }

    const user = await User.findOne({ where: { invitationToken: token } });
    if (!user) {
      req.flash('danger', 'This invitation link is invalid or has already been used.');
      return req.session.save(() => res.redirect('/auth/login'));
    }
    if (user.invitationExpiresAt && user.invitationExpiresAt < new Date()) {
      req.flash('danger', 'This invitation has expired. Ask your admin to resend it.');
      return req.session.save(() => res.redirect('/auth/login'));
    }

    // Store token in session so we can clear it after successful Google login
    req.session.pendingInviteToken = token;
    req.session.save(() => {
      res.redirect('/auth/login/google');
    });
  } catch (err) {
    console.error('[Accept Invite]', err.message);
    req.flash('danger', 'Something went wrong. Please try again.');
    req.session.save(() => res.redirect('/auth/login'));
  }
});

router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('info', 'You have been logged out.');
    req.session.save(() => res.redirect('/auth/login'));
  });
});

module.exports = router;
