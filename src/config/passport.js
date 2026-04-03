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
      callbackURL: '/auth/callback',
      proxy: true,
    }, async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email = profile.emails && profile.emails[0] && profile.emails[0].value;
        if (!email) return done(null, false, { message: 'No email from Google.' });

        const user = await User.findOne({ where: { email } });
        if (!user) return done(null, false, { message: 'Access denied. Email not registered.' });
        if (!user.isActive) return done(null, false, { message: 'Account deactivated.' });

        // Update Google info
        await user.update({
          googleId: profile.id,
          name: profile.displayName || user.name,
          avatarUrl: profile.photos && profile.photos[0] && profile.photos[0].value,
          lastLogin: new Date(),
        });

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    }));
  }
};
