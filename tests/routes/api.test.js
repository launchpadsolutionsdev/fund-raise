jest.mock('../../src/models', () => ({
  Snapshot: { findOne: jest.fn().mockResolvedValue(null) },
  DepartmentSummary: { findAll: jest.fn().mockResolvedValue([]) },
  GiftTypeBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  SourceBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  FundBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  RawGift: { findAll: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  sequelize: { query: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../../src/services/snapshotService', () => ({
  getAvailableDates: jest.fn().mockResolvedValue(['2025-03-15']),
  getEnhancedDashboardData: jest.fn().mockResolvedValue({ topDonors: [] }),
  getDepartmentEnhancedData: jest.fn().mockResolvedValue({ topDonors: [] }),
  getCrossDepartmentData: jest.fn().mockResolvedValue({ crossDeptDonors: [] }),
  getTrendsEnhanced: jest.fn().mockResolvedValue([]),
  getSnapshotComparison: jest.fn().mockResolvedValue(null),
  getGiftSeasonality: jest.fn().mockResolvedValue([]),
  getProjection: jest.fn().mockResolvedValue(null),
  getOperationalMetrics: jest.fn().mockResolvedValue({}),
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
const { Snapshot, DepartmentSummary, GiftTypeBreakdown, SourceBreakdown, FundBreakdown, RawGift } = require('../../src/models');
const snapshotService = require('../../src/services/snapshotService');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', require('../../src/routes/api'));
  return app;
}

describe('API routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  describe('GET /api/dates', () => {
    it('returns available dates', async () => {
      const res = await request(app).get('/api/dates');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(['2025-03-15']);
    });
  });

  describe('GET /api/snapshot/:date/summary', () => {
    it('returns 404 when snapshot not found', async () => {
      Snapshot.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/snapshot/2025-03-15/summary');
      expect(res.status).toBe(404);
    });

    it('returns department summaries', async () => {
      Snapshot.findOne.mockResolvedValue({ id: 1 });
      DepartmentSummary.findAll.mockResolvedValue([
        { department: 'annual_giving', totalGifts: 100, totalAmount: '50000', goal: '100000', pctToGoal: '50' },
      ]);
      const res = await request(app).get('/api/snapshot/2025-03-15/summary');
      expect(res.status).toBe(200);
      expect(res.body.annual_giving).toBeDefined();
      expect(res.body.annual_giving.totalGifts).toBe(100);
    });
  });

  describe('GET /api/snapshot/:date/gift-types/:department', () => {
    it('returns 404 when snapshot not found', async () => {
      Snapshot.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/snapshot/2025-03-15/gift-types/annual_giving');
      expect(res.status).toBe(404);
    });

    it('returns gift type breakdown', async () => {
      Snapshot.findOne.mockResolvedValue({ id: 1 });
      GiftTypeBreakdown.findAll.mockResolvedValue([
        { giftType: 'Cash', amount: 5000, pctOfGifts: '25' },
      ]);
      const res = await request(app).get('/api/snapshot/2025-03-15/gift-types/annual_giving');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].giftType).toBe('Cash');
    });
  });

  describe('GET /api/snapshot/:date/enhanced', () => {
    it('returns enhanced dashboard data', async () => {
      Snapshot.findOne.mockResolvedValue({ id: 1 });
      const res = await request(app).get('/api/snapshot/2025-03-15/enhanced');
      expect(res.status).toBe(200);
      expect(snapshotService.getEnhancedDashboardData).toHaveBeenCalled();
    });
  });

  describe('GET /api/snapshot/:date/cross-department', () => {
    it('returns cross-department data', async () => {
      Snapshot.findOne.mockResolvedValue({ id: 1 });
      const res = await request(app).get('/api/snapshot/2025-03-15/cross-department');
      expect(res.status).toBe(200);
      expect(snapshotService.getCrossDepartmentData).toHaveBeenCalled();
    });
  });

  describe('GET /api/trends-enhanced', () => {
    it('returns trends enhanced data', async () => {
      const res = await request(app).get('/api/trends-enhanced');
      expect(res.status).toBe(200);
      expect(snapshotService.getTrendsEnhanced).toHaveBeenCalledWith('tenant-1');
    });
  });

  describe('GET /api/projection', () => {
    it('returns projection data', async () => {
      snapshotService.getProjection.mockResolvedValue({ projectedTotal: 150000 });
      const res = await request(app).get('/api/projection');
      expect(res.status).toBe(200);
      expect(res.body.projectedTotal).toBe(150000);
    });
  });

  describe('GET /api/operational', () => {
    it('returns operational metrics', async () => {
      snapshotService.getOperationalMetrics.mockResolvedValue({ totalSnapshots: 5 });
      const res = await request(app).get('/api/operational');
      expect(res.status).toBe(200);
    });
  });
});
