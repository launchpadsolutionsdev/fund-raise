require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { sequelize } = require('./models');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const configurePassport = require('./config/passport');
const blackbaudClient = require('./services/blackbaudClient');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (Render terminates SSL at the load balancer)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store
const sessionStore = new SequelizeStore({
  db: sequelize,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 7 * 24 * 60 * 60 * 1000,
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Passport
configurePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// Flash messages (simple implementation via session)
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  res.locals.currentUser = req.user || null;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  // Blackbaud connection status (cached in session, refreshed every 10 min)
  res.locals.bbConnected = req.session.bbConnected || false;
  if (req.user && blackbaudClient.isConfigured() && !req.session.bbCheckedAt) {
    blackbaudClient.getConnectionStatus(req.user.tenantId).then(status => {
      req.session.bbConnected = status.connected;
      req.session.bbCheckedAt = Date.now();
      res.locals.bbConnected = status.connected;
    }).catch(() => {});
  } else if (req.session.bbCheckedAt && Date.now() - req.session.bbCheckedAt > 10 * 60 * 1000) {
    req.session.bbCheckedAt = null; // force re-check next request
  }
  next();
});

function flash(req, category, message) {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ category, message });
}
app.use((req, _res, next) => {
  req.flash = (cat, msg) => flash(req, cat, msg);
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/landing'));
app.use('/', require('./routes/dashboard'));
app.use('/departments', require('./routes/departments'));
app.use('/upload', require('./routes/upload'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/blackbaud'));
app.use('/', require('./routes/live'));

// 404
app.use((_req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// Start
async function start() {
  try {
    console.log('Connecting to database...');
    console.log('DATABASE_URL is', process.env.DATABASE_URL ? 'set' : 'NOT SET');
    await sequelize.authenticate();
    console.log('Database connected.');
    await sequelize.sync({ alter: true });
    console.log('Database tables synced.');
    await sessionStore.sync();
    console.log('Session table synced.');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err.message || err);
    process.exit(1);
  }
}

start();

module.exports = app;
