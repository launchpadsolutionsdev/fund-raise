const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { User, Tenant } = require('../models');
const emailService = require('../services/emailService');

module.exports = function (passport) {
  passport.serializeUser((user, done) => done(null, user.id));

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findByPk(id);
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.APP_URL
        ? process.env.APP_URL + '/auth/callback'
        : '/auth/callback',
      proxy: true,
    }, async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;

        if (!email) {
          console.log('[AUTH] Login attempt failed: no email from Google');
          return done(null, false, { message: 'No email from Google.' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
          console.log('[AUTH] Login attempt failed: email not registered');
          return done(null, false, { message: `Access denied. "${email}" is not registered.` });
        }
        if (!user.isActive) {
          console.log('[AUTH] Login attempt failed: account deactivated');
          return done(null, false, { message: 'Account deactivated.' });
        }

        const isFirstLogin = !user.lastLogin;

        // Update Google info
        await user.update({
          googleId: profile.id,
          name: profile.displayName || user.name,
          avatarUrl: profile.photos && profile.photos[0] && profile.photos[0].value,
          lastLogin: new Date(),
        });

        // Clear invitation token if present
        if (user.invitationToken) {
          await user.update({ invitationToken: null, invitationExpiresAt: null });

          // Notify admins that a new member joined
          const tenant = await Tenant.findByPk(user.tenantId);
          const admins = await User.findAll({
            where: { tenantId: user.tenantId, role: 'admin', isActive: true },
            attributes: ['email'],
          });
          const adminEmails = admins.map(a => a.email).filter(e => e !== user.email);
          if (adminEmails.length > 0 && tenant) {
            emailService.sendInviteAccepted({
              to: adminEmails,
              newUserName: user.name || user.email,
              newUserEmail: user.email,
              orgName: tenant.name,
            }).catch(err => console.error('[EMAIL] Failed to send invite-accepted:', err.message));
          }
        }

        // Send welcome email on first login
        if (isFirstLogin) {
          const tenant = await Tenant.findByPk(user.tenantId);
          emailService.sendWelcome({
            to: user.email,
            userName: user.name || user.email,
            orgName: tenant ? tenant.name : 'your organization',
          }).catch(err => console.error('[EMAIL] Failed to send welcome:', err.message));
        }

        return done(null, user);
      } catch (err) {
        console.error('[AUTH] ERROR:', err.message);
        return done(err, null);
      }
    }));
  }
};
