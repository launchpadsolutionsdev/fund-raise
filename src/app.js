require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const helmet = require('helmet');
const { sequelize } = require('./models');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const configurePassport = require('./config/passport');
const blackbaudClient = require('./services/blackbaudClient');

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

// Global request timeout — respond before Render's 30s proxy timeout
app.use((req, res, next) => {
  // Skip for streaming endpoints
  if (req.path.includes('/stream')) return next();
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

// Onboarding guard — redirect admins to wizard if setup is incomplete
const { ensureOnboarded } = require('./middleware/auth');
app.use(ensureOnboarded);

// Feature flags — load TenantDataConfig and expose feature flags to all templates
const { getEnabledFeatures } = require('./utils/featureFlags');
app.use(async (req, res, next) => {
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
    }
    res.locals.features = req.session._features || getEnabledFeatures(null);
    res.locals.dataSetupIncomplete = req.user.role === 'admin' && !req.session._dataSetupComplete;
  } catch (_) {
    res.locals.features = getEnabledFeatures(null);
  }
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/onboarding'));
app.use('/', require('./routes/landing'));
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
app.use('/', require('./routes/scenarios'));
app.use('/', require('./routes/insights'));

// 404
app.use((_req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// Global error handler — catches unhandled errors from routes/middleware
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err.stack || err.message || err);
  if (res.headersSent) return;
  const isAjax = _req.xhr || (_req.headers.accept && _req.headers.accept.includes('json'));
  if (isAjax) {
    return res.status(500).json({ error: 'An unexpected error occurred.' });
  }
  res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
});

// Start
async function start() {
  try {
    console.log('Connecting to database...');
    console.log('DATABASE_URL is', process.env.DATABASE_URL ? 'set' : 'NOT SET');
    await sequelize.authenticate();
    console.log('Database connected.');
    // Drop materialized views before sync so Sequelize can alter underlying columns
    const { dropMaterializedViews, createMaterializedViews } = require('./services/crmMaterializedViews');
    await dropMaterializedViews();
    // Drop covering indexes before sync — Sequelize can't parse INCLUDE clauses
    try { await sequelize.query('DROP INDEX IF EXISTS idx_crm_gifts_tenant_dept_date'); } catch (_) {}
    await sequelize.sync({ alter: true });
    console.log('Database tables synced.');

    // Ensure critical CRM indexes exist (sequelize sync may skip them)
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_constituent ON crm_gifts(tenant_id, constituent_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_date ON crm_gifts(tenant_id, gift_date)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_fund ON crm_gifts(tenant_id, fund_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_campaign ON crm_gifts(tenant_id, campaign_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_appeal ON crm_gifts(tenant_id, appeal_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_giftid ON crm_gifts(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_fundraisers_tenant_giftid ON crm_gift_fundraisers(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_fundraisers_tenant_name ON crm_gift_fundraisers(tenant_id, fundraiser_name)',
      'CREATE INDEX IF NOT EXISTS idx_crm_softcredits_tenant_giftid ON crm_gift_soft_credits(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_matches_tenant_giftid ON crm_gift_matches(tenant_id, gift_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_gifts_tenant_dept_date ON crm_gifts(tenant_id, department, gift_date) INCLUDE (gift_amount, constituent_id)',
      'CREATE INDEX IF NOT EXISTS idx_actions_tenant_assignedto_status ON actions(tenant_id, assigned_to_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_actions_tenant_assignedby_status ON actions(tenant_id, assigned_by_id, status)',
    ];
    for (const sql of indexes) {
      try { await sequelize.query(sql); } catch (e) { /* table may not exist yet */ }
    }
    // Upgrade dept index to covering version if it exists without INCLUDE columns
    try {
      const [rows] = await sequelize.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_crm_gifts_tenant_dept_date'`
      );
      if (rows && rows.length > 0 && rows[0].indexdef && !rows[0].indexdef.includes('INCLUDE')) {
        await sequelize.query('DROP INDEX IF EXISTS idx_crm_gifts_tenant_dept_date');
        await sequelize.query('CREATE INDEX idx_crm_gifts_tenant_dept_date ON crm_gifts(tenant_id, department, gift_date) INCLUDE (gift_amount, constituent_id)');
        console.log('Upgraded dept index to covering index.');
      }
    } catch (e) { /* fine if table doesn't exist yet */ }
    console.log('CRM indexes ensured.');

    // One-time backfill: classify department for any rows missing it
    const { backfillDepartments } = require('./services/crmDepartmentClassifier');
    await backfillDepartments();

    // Recreate materialized views for fast CRM dashboard queries
    await createMaterializedViews();
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
