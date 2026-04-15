jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, _res, next) => {
    req.user = req._testUser || { id: 1, tenantId: 7, role: 'admin' };
    next();
  },
  ensureAdmin: (_req, _res, next) => next(),
  ensureUploader: (_req, _res, next) => next(),
}));

jest.mock('../../src/services/writingAnalytics', () => ({
  getVariantStats: jest.fn().mockResolvedValue({
    summary: { total: 0 }, byFeature: {}, periodDays: 30,
  }),
  FEATURES: ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest'],
}));

const express = require('express');
const request = require('supertest');
const { getVariantStats } = require('../../src/services/writingAnalytics');

function createApp(user) {
  const app = express();
  app.use(express.json());
  if (user) app.use((req, _res, next) => { req._testUser = user; next(); });
  // The page route renders an EJS view; stub the renderer so the test isn't
  // coupled to the real view file.
  app.engine('ejs', (_path, _data, cb) => cb(null, '<html>view</html>'));
  app.set('views', __dirname);
  app.set('view engine', 'ejs');
  app.use('/', require('../../src/routes/writingAnalytics'));
  return app;
}

describe('GET /settings/writing-analytics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('rejects non-admins with 403', async () => {
    const res = await request(createApp({ id: 1, tenantId: 7, role: 'staff' }))
      .get('/settings/writing-analytics');
    expect(res.status).toBe(403);
  });

  it('renders the page for admins', async () => {
    const res = await request(createApp()).get('/settings/writing-analytics');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/writing-analytics', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('rejects non-admins with JSON 403', async () => {
    const res = await request(createApp({ id: 1, tenantId: 7, role: 'staff' }))
      .get('/api/writing-analytics');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Admin/);
    expect(getVariantStats).not.toHaveBeenCalled();
  });

  it('passes tenantId and days through to the service', async () => {
    const res = await request(createApp()).get('/api/writing-analytics?days=7');
    expect(res.status).toBe(200);
    expect(getVariantStats).toHaveBeenCalledWith(7, { days: '7' });
  });

  it('translates days=all to null for the service', async () => {
    await request(createApp()).get('/api/writing-analytics?days=all');
    expect(getVariantStats).toHaveBeenCalledWith(7, { days: null });
  });

  it('returns a client-safe 500 when the service throws', async () => {
    getVariantStats.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(createApp()).get('/api/writing-analytics');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to load/);
    expect(JSON.stringify(res.body)).not.toContain('DB down');
  });
});
