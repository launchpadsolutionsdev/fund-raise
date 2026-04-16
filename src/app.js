require('dotenv').config();

// Require TOKEN_ENCRYPTION_KEY before anything else
if (!process.env.TOKEN_ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY.length !== 64) {
  console.error('FATAL: TOKEN_ENCRYPTION_KEY environment variable is required (64 hex chars). Generate with: openssl rand -hex 32');
  process.exit(1);
}

// Initialize CLS for tenant-scoped transactions BEFORE loading models.
// Sequelize.useCLS() must be called before the Sequelize instance is created.
const { initTenantCLS, tenantContextMiddleware } = require('./middleware/tenantContext');
initTenantCLS();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const helmet = require('helmet');
const { sequelize } = require('./models');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const configurePassport = require('./config/passport');
const blackbaudClient = require('./services/blackbaudClient');
const { csrfMiddleware } = require('./middleware/csrf');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust proxy (Render terminates SSL at the load balancer)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // EJS templates use inline scripts/styles
  crossOriginEmbedderPolicy: false,
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser — required by csrf-csrf to read the CSRF double-submit cookie
const cookieParser = require('cookie-parser');
app.use(cookieParser(process.env.SESSION_SECRET || 'dev-secret'));

// Global request timeout — respond before Render's 30s proxy timeout
app.use((req, res, next) => {
  // Skip for streaming endpoints and large file uploads
  if (req.path.includes('/stream') || req.path.startsWith('/crm-upload/') || req.path.startsWith('/api/onboarding/upload')) return next();
  req._startTime = Date.now();
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.path.endsWith('/data');
      if (isAjax) {
        res.status(504).json({ error: 'Request timed out. Please try again.' });
      } else {
        res.status(504).send('Request timed out. Please refresh the page.');
      }
    }
  }, 28000);
  res.on('finish', () => clearTimeout(timer));
  next();
});

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
    secure: isProd,
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

// Tenant context — sets app.current_tenant_id for PostgreSQL RLS.
// Must come after Passport (so req.user is available) but before routes.
app.use(tenantContextMiddleware(sequelize));

// Onboarding guard — redirect admins to wizard if setup is incomplete
const { ensureOnboarded } = require('./middleware/auth');
app.use(ensureOnboarded);

// CSRF protection — validates token on POST/PUT/PATCH/DELETE, exposes csrfToken to templates
app.use(csrfMiddleware);

// Feature flags — load TenantDataConfig and expose feature flags to all templates
const { getEnabledFeatures } = require('./utils/featureFlags');
app.use(async (req, res, next) => {
  // Always provide default features so templates never encounter undefined
  res.locals.features = getEnabledFeatures(null);
  if (!req.isAuthenticated()) return next();
  try {
    // Cache in session for performance (refresh every 5 minutes)
    if (!req.session._featuresAt || Date.now() - req.session._featuresAt > 5 * 60 * 1000) {
      const { TenantDataConfig } = require('./models');
      const dc = await TenantDataConfig.findOne({ where: { tenantId: req.user.tenantId }, raw: true });
      req.session._features = getEnabledFeatures(dc);
      req.session._featuresAt = Date.now();
      // Track whether data onboarding is incomplete (for nav nudge)
      req.session._dataSetupComplete = !!(dc && dc.onboarding_completed_at);
      // Cache detected departments for sidebar navigation
      const dd = dc && dc.detected_departments;
      req.session._departments = dd && dd.departments && Array.isArray(dd.departments)
        ? dd.departments
        : [];
    }
    res.locals.features = req.session._features || getEnabledFeatures(null);
    res.locals.dataSetupIncomplete = req.user.role === 'admin' && !req.session._dataSetupComplete;
    res.locals.departments = req.session._departments || [];
  } catch (_) {
    res.locals.features = getEnabledFeatures(null);
  }

  // Action Centre badge count — open actions assigned to current user
  try {
    const { Action } = require('./models');
    const { Op } = require('sequelize');
    const count = await Action.count({
      where: {
        tenantId: req.user.tenantId,
        assignedToId: req.user.id,
        status: { [Op.ne]: 'resolved' },
      },
    });
    res.locals.actionBadgeCount = count;
  } catch (_) {
    res.locals.actionBadgeCount = 0;
  }

  next();
});

// Health check (unauthenticated, before all other routes)
app.get('/health', async (_req, res) => {
  try {
    await sequelize.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', db: 'disconnected' });
  }
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/onboarding'));
app.use('/', require('./routes/landing'));
app.use('/', require('./routes/insights'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/ai'));
app.use('/departments', require('./routes/departments'));
app.use('/upload', require('./routes/upload'));
app.use('/crm-upload', require('./routes/crmUpload'));
app.use('/', require('./routes/crmDashboard'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/blackbaud'));
app.use('/', require('./routes/live'));
app.use('/', require('./routes/profile'));
app.use('/', require('./routes/board'));
app.use('/', require('./routes/writing'));
app.use('/', require('./routes/milestones'));
app.use('/', require('./routes/impact'));
app.use('/', require('./routes/bingo'));
app.use('/', require('./routes/notes'));
app.use('/', require('./routes/meetingPrep'));
app.use('/', require('./routes/thermometer'));
app.use('/', require('./routes/kudos'));
app.use('/', require('./routes/digest'));
app.use('/', require('./routes/thankYou'));
app.use('/', require('./routes/thankYouTemplates'));
app.use('/', require('./routes/writingLibrary'));
app.use('/', require('./routes/brandVoice'));
app.use('/', require('./routes/writingAnalytics'));
app.use('/', require('./routes/scenarios'));
app.use('/', require('./routes/actions'));
app.use('/api/actions', require('./routes/api/actions'));

// 404
app.use((_req, res) => {
  res.status(404).render('error', { title: 'Not Found', status: 404, message: "The page you're looking for doesn't exist or has been moved." });
});

// Global error handler — catches unhandled errors from routes/middleware
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err.stack || err.message || err);
  if (res.headersSent) return;
  const isAjax = _req.xhr || (_req.headers.accept && _req.headers.accept.includes('json'));
  if (isAjax) {
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
  const status = err.status || 500;
  res.status(status).render('error', { title: status === 403 ? 'Forbidden' : 'Error', status, message: err.userMessage || null });
});

// Start
async function start() {
  try {
    console.log('Connecting to database...');
    console.log('DATABASE_URL is', process.env.DATABASE_URL ? 'set' : 'NOT SET');
    await sequelize.authenticate();
    console.log('Database connected.');

    // Indexes, department backfill, and materialized views are handled at
    // build time: migrations + scripts/rebuild-materialized-views.js.
    // This avoids race conditions with health checks on startup.

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
