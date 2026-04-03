require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const { sequelize } = require('./models');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const configurePassport = require('./config/passport');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
const sessionStore = new SequelizeStore({ db: sequelize });
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));
sessionStore.sync();

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
app.use('/', require('./routes/dashboard'));
app.use('/departments', require('./routes/departments'));
app.use('/upload', require('./routes/upload'));
app.use('/api', require('./routes/api'));

// 404
app.use((_req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// Start
async function start() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');
    // Sync tables (use migrations in production)
    await sequelize.sync();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
