jest.mock('../../src/services/snapshotService', () => ({
  getAvailableDates: jest.fn().mockResolvedValue(['2025-03-15', '2025-03-08']),
  getSnapshotForDate: jest.fn().mockResolvedValue({ id: 1 }),
  getDashboardData: jest.fn().mockResolvedValue({ totalRaised: 100000, departments: {} }),
}));

jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, res, next) => {
    req.user = { id: 1, tenantId: 'tenant-1', role: 'admin' };
    next();
  },
  ensureAdmin: (req, res, next) => next(),
  ensureUploader: (req, res, next) => next(),
}));

const express = require('express');
const request = require('supertest');

function createApp() {
  const app = express();
  app.use((req, res, next) => {
    const origRender = res.render.bind(res);
    res.render = (view, opts) => res.json({ view, ...opts });
    next();
  });
  app.use('/', require('../../src/routes/dashboard'));
  return app;
}

describe('Dashboard routes', () => {
  let app;
  const snapshotService = require('../../src/services/snapshotService');

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotService.getAvailableDates.mockResolvedValue(['2025-03-15']);
    snapshotService.getSnapshotForDate.mockResolvedValue({ id: 1 });
    snapshotService.getDashboardData.mockResolvedValue({ totalRaised: 100000 });
    app = createApp();
  });

  it('GET /dashboard renders dashboard/main', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('dashboard/main');
    expect(res.body.title).toBe('Master Dashboard');
  });

  it('GET /dashboard passes data and dates', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.body.selectedDate).toBe('2025-03-15');
    expect(res.body.availableDates).toEqual(['2025-03-15']);
  });

  it('GET /dashboard with date query param', async () => {
    const res = await request(app).get('/dashboard?date=2025-03-08');
    expect(snapshotService.getSnapshotForDate).toHaveBeenCalledWith('tenant-1', '2025-03-08');
  });

  it('GET /dashboard with no snapshots', async () => {
    snapshotService.getAvailableDates.mockResolvedValue([]);
    snapshotService.getSnapshotForDate.mockResolvedValue(null);
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('GET /trends renders dashboard/trends', async () => {
    const res = await request(app).get('/trends');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('dashboard/trends');
    expect(res.body.title).toBe('Trends & Forecasting');
  });

  it('GET /analytics renders dashboard/analytics', async () => {
    const res = await request(app).get('/analytics');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('dashboard/analytics');
    expect(res.body.title).toBe('Cross-Department Analytics');
  });

  it('GET /dashboard handles errors', async () => {
    snapshotService.getAvailableDates.mockRejectedValue(new Error('DB error'));
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(500);
  });
});
