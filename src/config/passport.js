const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { User } = require('../models');

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
        console.log('[AUTH] Google profile email:', email);
        console.log('[AUTH] Google profile name:', profile.displayName);

        if (!email) {
          console.log('[AUTH] FAIL: No email from Google');
          return done(null, false, { message: 'No email from Google.' });
        }

        // List all users for debugging
        const allUsers = await User.findAll({ attributes: ['id', 'email', 'role', 'isActive'] });
        console.log('[AUTH] Users in database:', JSON.stringify(allUsers.map(u => u.email)));

        const user = await User.findOne({ where: { email } });
        if (!user) {
          console.log('[AUTH] FAIL: Email not found in users table:', email);
          return done(null, false, { message: `Access denied. "${email}" is not registered.` });
        }
        if (!user.isActive) {
          console.log('[AUTH] FAIL: User deactivated:', email);
          return done(null, false, { message: 'Account deactivated.' });
        }

        console.log('[AUTH] SUCCESS: Logging in user:', email, 'role:', user.role);

        // Update Google info
        await user.update({
          googleId: profile.id,
          name: profile.displayName || user.name,
          avatarUrl: profile.photos && profile.photos[0] && profile.photos[0].value,
          lastLogin: new Date(),
        });

        return done(null, user);
      } catch (err) {
        console.error('[AUTH] ERROR:', err.message);
        return done(err, null);
      }
    }));
  }
};
