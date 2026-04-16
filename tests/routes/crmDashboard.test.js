// ---------------------------------------------------------------------------
// CRM Dashboard route handler tests
// ---------------------------------------------------------------------------

// Mock ALL dependencies before requiring
jest.mock('../../src/models', () => ({
  sequelize: { query: jest.fn().mockResolvedValue([]) },
  FundraiserGoal: {},
  DepartmentGoal: {},
  PhilanthropyNarrative: {
    findAll: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue([{ id: 1 }]),
  },
  Tenant: { findByPk: jest.fn().mockResolvedValue({ name: 'Test Org', logoPath: null }) },
}));

jest.mock('../../src/services/crmDashboardService', () => ({
  getFiscalYears: jest.fn().mockResolvedValue([2025, 2024]),
  getCrmOverview: jest.fn().mockResolvedValue({
    total_raised: 100000, total_gifts: 50, unique_donors: 30,
    avg_gift: 2000, largest_gift: 10000, unique_funds: 5,
    unique_campaigns: 3, unique_appeals: 2,
  }),
  getGivingByMonth: jest.fn().mockResolvedValue([{ month: '2024-01', total: 5000 }]),
  getTopDonors: jest.fn().mockResolvedValue([{ constituent_name: 'Test Donor', total_given: 5000, gift_count: 2 }]),
  getTopFunds: jest.fn().mockResolvedValue([{ fund_description: 'General', total: 3000, gift_count: 5 }]),
  getTopCampaigns: jest.fn().mockResolvedValue([{ campaign_description: 'Annual', total: 2000, gift_count: 3 }]),
  getTopAppeals: jest.fn().mockResolvedValue([]),
  getGiftsByType: jest.fn().mockResolvedValue([]),
  getFundraiserLeaderboard: jest.fn().mockResolvedValue([
    { fundraiser_name: 'Alice', fundraiser_first_name: 'Alice', fundraiser_last_name: 'Smith', total_credited: 5000, gift_count: 10, donor_count: 8 },
    { fundraiser_name: 'Bob', fundraiser_first_name: 'Bob', fundraiser_last_name: 'Jones', total_credited: 3000, gift_count: 6, donor_count: 4 },
  ]),
  getGivingPyramid: jest.fn().mockResolvedValue([]),
  getDonorScoring: jest.fn().mockResolvedValue({ donors: [], segments: {} }),
  getRetentionDrilldown: jest.fn().mockResolvedValue({}),
  getDonorRetention: jest.fn().mockResolvedValue({ retention_rate: 60, retained: 10, lapsed: 5, brand_new: 8, recovered: 2 }),
  getRecurringDonorAnalysis: jest.fn().mockResolvedValue({ donors: [], patterns: {} }),
  getDonorLifecycleAnalysis: jest.fn().mockResolvedValue({}),
  getDonorInsights: jest.fn().mockResolvedValue({}),
  getLybuntSybunt: jest.fn().mockResolvedValue({}),
  getDonorUpgradeDowngrade: jest.fn().mockResolvedValue({}),
  getFirstTimeDonorConversion: jest.fn().mockResolvedValue({}),
  getDataQualityReport: jest.fn().mockResolvedValue({}),
  getAnomalyDetection: jest.fn().mockResolvedValue({}),
  getAIRecommendations: jest.fn().mockResolvedValue([]),
  getProactiveInsights: jest.fn().mockResolvedValue([]),
  searchGifts: jest.fn().mockResolvedValue({ gifts: [], total: 0 }),
  getDonorDetail: jest.fn().mockResolvedValue({}),
  getFilterOptions: jest.fn().mockResolvedValue({}),
  getEntityDetail: jest.fn().mockResolvedValue({}),
  getFundraiserGoals: jest.fn().mockResolvedValue([]),
  setFundraiserGoal: jest.fn().mockResolvedValue({}),
  deleteFundraiserGoal: jest.fn().mockResolvedValue(true),
  getDepartmentGoals: jest.fn().mockResolvedValue([]),
  setDepartmentGoal: jest.fn().mockResolvedValue({}),
  deleteDepartmentGoal: jest.fn().mockResolvedValue(true),
  getDepartmentActuals: jest.fn().mockResolvedValue([]),
  getFundraiserPortfolio: jest.fn().mockResolvedValue({}),
  getAcknowledgmentTracker: jest.fn().mockResolvedValue({}),
  getMatchingGiftAnalysis: jest.fn().mockResolvedValue({}),
  getSoftCreditAnalysis: jest.fn().mockResolvedValue({}),
  getPaymentMethodAnalysis: jest.fn().mockResolvedValue({}),
  getGiftTrendAnalysis: jest.fn().mockResolvedValue({}),
  getCampaignComparison: jest.fn().mockResolvedValue({}),
  getFundHealthReport: jest.fn().mockResolvedValue({}),
  getYearOverYearComparison: jest.fn().mockResolvedValue({
    years: [
      { fy: 2021, total_raised: 80000, gift_count: 40, donor_count: 25 },
      { fy: 2022, total_raised: 90000, gift_count: 45, donor_count: 28 },
      { fy: 2023, total_raised: 95000, gift_count: 48, donor_count: 30 },
      { fy: 2024, total_raised: 100000, gift_count: 50, donor_count: 32 },
      { fy: 2025, total_raised: 110000, gift_count: 52, donor_count: 35 },
    ],
    bestYear: null, worstYear: null, cumulative: {},
  }),
  getAppealComparison: jest.fn().mockResolvedValue({}),
  getAppealDetail: jest.fn().mockResolvedValue({}),
  getDepartmentAnalytics: jest.fn().mockResolvedValue({ summary: [
    { department: 'major_gifts', gift_count: 10, donor_count: 5, total_amount: 50000, avg_gift: 5000 },
    { department: 'events', gift_count: 20, donor_count: 15, total_amount: 30000, avg_gift: 1500 },
  ] }),
  getDepartmentDetail: jest.fn().mockResolvedValue({
    department: 'legacy_giving',
    summary: { gift_count: 5, donor_count: 4, total_raised: 25000, avg_gift: 5000, largest_gift: 15000 },
    monthly: [],
    yoy: [
      { fy: 2025, gift_count: 5, total: 25000, donors: 4 },
      { fy: 2024, gift_count: 4, total: 20000, donors: 3 },
    ],
    topDonors: [],
    fundraisers: [],
    appeals: [{ appeal_description: 'Legacy Campaign', total: 15000, gift_count: 2 }],
    campaigns: [],
    funds: [{ fund_description: 'Endowment', total: 20000, gift_count: 3 }],
    giftTypes: [],
    giftSizes: [{ bracket: '$10K-$24,999', total: 15000, gift_count: 1 }],
    seasonality: [],
    retention: { retention_rate: '50.0', retained: 2, lapsed: 1, new_donors: 2, current_donors: 4, prior_donors: 4 },
    recentGifts: [],
    goal: null,
  }),
  getDepartmentExtras: jest.fn().mockResolvedValue({}),
  getHouseholdGiving: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/crmImportService', () => ({
  getCrmStats: jest.fn().mockResolvedValue({ gifts: 10 }),
}));

jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, res, next) => {
    req.user = { tenantId: 'test-tenant', id: 1, role: 'admin', isAdmin: () => true, canUpload: () => true };
    next();
  },
  ensureUploader: (req, res, next) => next(),
  ensureAdmin: (req, res, next) => next(),
}));

// Mock pdfkit so the board-report/pdf route works without the real library
jest.mock('pdfkit', () => {
  return jest.fn().mockImplementation(() => {
    const { PassThrough } = require('stream');
    const stream = new PassThrough();
    return {
      fontSize: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      text: jest.fn().mockReturnThis(),
      moveDown: jest.fn().mockReturnThis(),
      moveTo: jest.fn().mockReturnThis(),
      lineTo: jest.fn().mockReturnThis(),
      strokeColor: jest.fn().mockReturnThis(),
      lineWidth: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      addPage: jest.fn().mockReturnThis(),
      rect: jest.fn().mockReturnThis(),
      roundedRect: jest.fn().mockReturnThis(),
      circle: jest.fn().mockReturnThis(),
      ellipse: jest.fn().mockReturnThis(),
      save: jest.fn().mockReturnThis(),
      restore: jest.fn().mockReturnThis(),
      closePath: jest.fn().mockReturnThis(),
      bezierCurveTo: jest.fn().mockReturnThis(),
      curveTo: jest.fn().mockReturnThis(),
      path: jest.fn().mockReturnThis(),
      fill: jest.fn().mockReturnThis(),
      stroke: jest.fn().mockReturnThis(),
      fillAndStroke: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      heightOfString: jest.fn().mockReturnValue(10),
      pipe: jest.fn((dest) => { stream.pipe(dest); }),
      end: jest.fn(() => { stream.end(); }),
      y: 100,
    };
  });
});

const express = require('express');
const request = require('supertest');

let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  // Stub res.render so we don't need real view engine
  app.use((req, res, next) => {
    res.render = jest.fn((view, data, cb) => {
      if (typeof cb === 'function') {
        cb(null, '<html></html>');
      } else {
        res.json({ view, ...data });
      }
    });
    next();
  });
  app.use('/', require('../../src/routes/crmDashboard'));
});

afterEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Dashboard main
// ---------------------------------------------------------------------------
describe('CRM Dashboard Routes', () => {
  describe('GET /crm-dashboard', () => {
    it('renders the dashboard page', async () => {
      const res = await request(app).get('/crm-dashboard');
      expect(res.status).toBe(200);
      expect(res.body.view).toBe('crm/dashboard');
      expect(res.body.hasData).toBe(true);
    });
  });

  describe('GET /crm-dashboard/data', () => {
    it('returns overview data without FY filter', async () => {
      const res = await request(app).get('/crm-dashboard/data');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('overview');
      expect(res.body).toHaveProperty('fiscalYears');
      expect(res.body).toHaveProperty('topDonors');
      expect(res.body).toHaveProperty('topFunds');
      expect(res.body).toHaveProperty('topCampaigns');
      expect(res.body).toHaveProperty('giftsByType');
      expect(res.body).toHaveProperty('givingByMonth');
      expect(res.body.selectedFY).toBeNull();
    });

    it('returns data with FY filter and prior comparison', async () => {
      const res = await request(app).get('/crm-dashboard/data?fy=2025');
      expect(res.status).toBe(200);
      expect(res.body.selectedFY).toBe(2025);
      expect(res.body).toHaveProperty('priorOverview');
      expect(res.body).toHaveProperty('retention');
    });
  });

  describe('GET /crm-dashboard/insights', () => {
    it('returns proactive insights', async () => {
      const res = await request(app).get('/crm-dashboard/insights');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('insights');
    });
  });
});

// ---------------------------------------------------------------------------
// Fundraiser Performance
// ---------------------------------------------------------------------------
describe('Fundraiser Performance Routes', () => {
  describe('GET /fundraiser-performance', () => {
    it('renders the page', async () => {
      const res = await request(app).get('/fundraiser-performance');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /fundraiser-performance/data', () => {
    it('returns leaderboard data', async () => {
      const res = await request(app).get('/fundraiser-performance/data');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('leaderboard');
      expect(res.body).toHaveProperty('fiscalYears');
    });

    it('includes portfolio when fundraiser is specified', async () => {
      const res = await request(app).get('/fundraiser-performance/data?fundraiser=Alice');
      expect(res.status).toBe(200);
      expect(res.body.selectedFundraiser).toBe('Alice');
      expect(res.body).toHaveProperty('portfolio');
    });
  });
});

// ---------------------------------------------------------------------------
// Donor Detail
// ---------------------------------------------------------------------------
describe('Donor Detail Routes', () => {
  describe('GET /crm/donor/:constituentId', () => {
    it('renders donor detail page', async () => {
      const res = await request(app).get('/crm/donor/D123');
      expect(res.status).toBe(200);
      expect(res.body.constituentId).toBe('D123');
    });
  });

  describe('GET /crm/donor/:constituentId/data', () => {
    it('returns donor detail data', async () => {
      const res = await request(app).get('/crm/donor/D123/data');
      expect(res.status).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// Gift Search
// ---------------------------------------------------------------------------
describe('Gift Search Routes', () => {
  describe('GET /crm/gifts', () => {
    it('renders gift search page', async () => {
      const res = await request(app).get('/crm/gifts');
      expect(res.status).toBe(200);
      expect(res.body.view).toBe('crm/gift-search');
    });
  });

  describe('GET /crm/gifts/data', () => {
    it('returns gift search results', async () => {
      const res = await request(app).get('/crm/gifts/data');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('gifts');
      expect(res.body).toHaveProperty('filters');
      expect(res.body).toHaveProperty('fiscalYears');
    });

    it('passes query params for filtering', async () => {
      const res = await request(app)
        .get('/crm/gifts/data?fy=2025&page=2&limit=25&search=test&fund=gen&campaign=ann&appeal=spr&minAmount=100&maxAmount=5000&sortBy=amount&sortDir=ASC');
      expect(res.status).toBe(200);
      expect(res.body.selectedFY).toBe(2025);
    });
  });
});

// ---------------------------------------------------------------------------
// Standard data page pattern — render + /data endpoint
// Each of these follows the same render-page + fetch-data pattern
// ---------------------------------------------------------------------------
const standardPages = [
  { path: '/crm/donor-scoring', view: 'crm/donor-scoring', name: 'Donor Scoring' },
  { path: '/crm/recurring-donors', view: 'crm/recurring-donors', name: 'Recurring Donors' },
  { path: '/crm/acknowledgments', view: 'crm/acknowledgments', name: 'Acknowledgment Tracker' },
  { path: '/crm/matching-gifts', view: 'crm/matching-gifts', name: 'Matching Gifts' },
  { path: '/crm/soft-credits', view: 'crm/soft-credits', name: 'Soft Credits' },
  { path: '/crm/payment-methods', view: 'crm/payment-methods', name: 'Payment Methods' },
  { path: '/crm/donor-lifecycle', view: 'crm/donor-lifecycle', name: 'Donor Lifecycle' },
  { path: '/crm/gift-trends', view: 'crm/gift-trends', name: 'Gift Trends' },
  { path: '/crm/campaign-compare', view: 'crm/campaign-compare', name: 'Campaign Compare' },
  { path: '/crm/fund-health', view: 'crm/fund-health', name: 'Fund Health' },
  { path: '/crm/yoy-compare', view: 'crm/yoy-compare', name: 'YoY Compare' },
  { path: '/crm/donor-insights', view: 'crm/donor-insights', name: 'Donor Insights' },
  { path: '/crm/appeal-compare', view: 'crm/appeal-compare', name: 'Appeal Compare' },
  { path: '/crm/department-analytics', view: 'crm/department-analytics', name: 'Department Analytics' },
  { path: '/crm/department-goals', view: 'crm/department-goals', name: 'Department Goals' },
  { path: '/crm/data-quality', view: 'crm/data-quality', name: 'Data Quality' },
  { path: '/crm/retention', view: 'crm/retention', name: 'Retention' },
  { path: '/crm/household-giving', view: 'crm/household-giving', name: 'Household Giving' },
  { path: '/crm/lybunt-sybunt', view: 'crm/lybunt-sybunt', name: 'LYBUNT/SYBUNT' },
  { path: '/crm/donor-upgrade-downgrade', view: 'crm/donor-upgrade-downgrade', name: 'Donor Upgrade/Downgrade' },
  { path: '/crm/first-time-donors', view: 'crm/first-time-donors', name: 'First-Time Donors' },
  { path: '/crm/board-report', view: 'crm/board-report', name: 'Board Report' },
  { path: '/crm/anomalies', view: 'crm/anomalies', name: 'Anomalies' },
  { path: '/crm/recommendations', view: 'crm/recommendations', name: 'AI Recommendations' },
];

describe('Standard CRM page routes', () => {
  standardPages.forEach(({ path, view, name }) => {
    it(`GET ${path} renders ${name} page`, async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(200);
    });
  });
});

describe('Standard CRM data endpoints', () => {
  const dataEndpoints = [
    '/crm/donor-scoring/data',
    '/crm/recurring-donors/data',
    '/crm/acknowledgments/data',
    '/crm/matching-gifts/data',
    '/crm/soft-credits/data',
    '/crm/payment-methods/data',
    '/crm/donor-lifecycle/data',
    '/crm/gift-trends/data',
    '/crm/campaign-compare/data',
    '/crm/fund-health/data',
    '/crm/yoy-compare/data',
    '/crm/donor-insights/data',
    '/crm/appeal-compare/data',
    '/crm/department-analytics/data',
    '/crm/data-quality/data',
    '/crm/retention/data',
    '/crm/household-giving/data',
    '/crm/lybunt-sybunt/data',
    '/crm/donor-upgrade-downgrade/data',
    '/crm/first-time-donors/data',
    '/crm/anomalies/data',
    '/crm/recommendations/data',
  ];

  dataEndpoints.forEach((endpoint) => {
    it(`GET ${endpoint} returns 200 with JSON`, async () => {
      const res = await request(app).get(endpoint);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/json/);
    });
  });

  it('GET data endpoints accept fy query param', async () => {
    const res = await request(app).get('/crm/donor-scoring/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// Department Analytics extras
// ---------------------------------------------------------------------------
describe('Department Analytics extras', () => {
  it('GET /crm/department-analytics/extras returns data', async () => {
    const res = await request(app).get('/crm/department-analytics/extras');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Department Goals data + CRUD
// ---------------------------------------------------------------------------
describe('Department Goals', () => {
  it('GET /crm/department-goals/data returns merged departments', async () => {
    const res = await request(app).get('/crm/department-goals/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('departments');
    expect(res.body).toHaveProperty('fiscalYears');
  });

  it('POST /crm/department-goals sets a goal', async () => {
    const res = await request(app)
      .post('/crm/department-goals')
      .send({ department: 'Annual Giving', fiscalYear: 2025, goalAmount: 50000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /crm/department-goals returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/crm/department-goals')
      .send({ department: 'Annual Giving' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it('DELETE /crm/department-goals removes a goal', async () => {
    const res = await request(app)
      .delete('/crm/department-goals')
      .send({ department: 'Annual Giving', fiscalYear: 2025 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Appeal Detail
// ---------------------------------------------------------------------------
describe('Appeal Detail', () => {
  it('GET /crm/appeal-compare/detail returns appeal detail', async () => {
    const res = await request(app).get('/crm/appeal-compare/detail?id=APP1&fy=2025');
    expect(res.status).toBe(200);
  });

  it('GET /crm/appeal-compare/detail returns 400 without id', async () => {
    const res = await request(app).get('/crm/appeal-compare/detail');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Appeal ID required/);
  });
});

// ---------------------------------------------------------------------------
// Entity Detail (wildcard)
// ---------------------------------------------------------------------------
describe('Entity Detail Routes', () => {
  it('GET /crm/fund/F001 renders entity detail page', async () => {
    const res = await request(app).get('/crm/fund/F001');
    expect(res.status).toBe(200);
  });

  it('GET /crm/campaign/C001 renders entity detail page', async () => {
    const res = await request(app).get('/crm/campaign/C001');
    expect(res.status).toBe(200);
  });

  it('GET /crm/appeal/A001 renders entity detail page', async () => {
    const res = await request(app).get('/crm/appeal/A001');
    expect(res.status).toBe(200);
  });

  it('GET /crm/invalid-type/X001 returns 404', async () => {
    const res = await request(app).get('/crm/invalid-type/X001');
    expect(res.status).toBe(404);
  });

  it('GET /crm/fund/F001/data returns entity data', async () => {
    const res = await request(app).get('/crm/fund/F001/data');
    expect(res.status).toBe(200);
    expect(res.body.entityType).toBe('fund');
    expect(res.body.entityId).toBe('F001');
  });

  it('GET /crm/invalid-type/X001/data returns 400', async () => {
    const res = await request(app).get('/crm/invalid-type/X001/data');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Fundraiser Goals
// ---------------------------------------------------------------------------
describe('Fundraiser Goals', () => {
  it('GET /fundraiser-goals renders page', async () => {
    const res = await request(app).get('/fundraiser-goals');
    expect(res.status).toBe(200);
  });

  it('GET /fundraiser-goals/data returns merged fundraisers', async () => {
    const res = await request(app).get('/fundraiser-goals/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fundraisers');
    expect(res.body).toHaveProperty('fiscalYears');
  });

  it('POST /fundraiser-goals sets a goal', async () => {
    const res = await request(app)
      .post('/fundraiser-goals')
      .send({ fundraiserName: 'Alice', fiscalYear: 2025, goalAmount: 100000 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /fundraiser-goals returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/fundraiser-goals')
      .send({ fundraiserName: 'Alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it('DELETE /fundraiser-goals removes a goal', async () => {
    const res = await request(app)
      .delete('/fundraiser-goals')
      .send({ fundraiserName: 'Alice', fiscalYear: 2025 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling — service throws
// ---------------------------------------------------------------------------
describe('Error handling', () => {
  it('returns 500 when crm-dashboard/data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getCrmOverview.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app).get('/crm-dashboard/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('DB down');
  });

  it('returns 500 when crm-dashboard page render fails', async () => {
    const importSvc = require('../../src/services/crmImportService');
    importSvc.getCrmStats.mockRejectedValueOnce(new Error('stats fail'));
    const res = await request(app).get('/crm-dashboard');
    expect(res.status).toBe(500);
  });

  it('returns 500 when fundraiser-performance/data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getFundraiserLeaderboard.mockRejectedValueOnce(new Error('query fail'));
    const res = await request(app).get('/fundraiser-performance/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('query fail');
  });

  it('returns 500 when POST /fundraiser-goals service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.setFundraiserGoal.mockRejectedValueOnce(new Error('save fail'));
    const res = await request(app)
      .post('/fundraiser-goals')
      .send({ fundraiserName: 'Alice', fiscalYear: 2025, goalAmount: 100000 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('save fail');
  });

  it('returns 500 when DELETE /fundraiser-goals service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.deleteFundraiserGoal.mockRejectedValueOnce(new Error('del fail'));
    const res = await request(app)
      .delete('/fundraiser-goals')
      .send({ fundraiserName: 'Alice', fiscalYear: 2025 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('del fail');
  });

  it('returns 500 when POST /crm/department-goals service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.setDepartmentGoal.mockRejectedValueOnce(new Error('dept fail'));
    const res = await request(app)
      .post('/crm/department-goals')
      .send({ department: 'Events', fiscalYear: 2025, goalAmount: 50000 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('dept fail');
  });

  it('returns 500 when DELETE /crm/department-goals service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.deleteDepartmentGoal.mockRejectedValueOnce(new Error('dept del fail'));
    const res = await request(app)
      .delete('/crm/department-goals')
      .send({ department: 'Events', fiscalYear: 2025 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('dept del fail');
  });
});

// ---------------------------------------------------------------------------
// Board Report PDF
// ---------------------------------------------------------------------------
describe('Board Report PDF', () => {
  it('GET /crm/board-report/pdf returns a PDF response', async () => {
    const res = await request(app).get('/crm/board-report/pdf?fy=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.headers['content-disposition']).toMatch(/Board_Report/);
  });

  it('GET /crm/board-report/pdf works without fy param', async () => {
    const res = await request(app).get('/crm/board-report/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });
});

// ---------------------------------------------------------------------------
// Philanthropy Report PDF
// ---------------------------------------------------------------------------
describe('Philanthropy Report PDF', () => {
  it('GET /crm/philanthropy-report renders the page', async () => {
    const res = await request(app).get('/crm/philanthropy-report');
    expect(res.status).toBe(200);
    expect(res.body.view).toBe('crm/philanthropy-report');
  });

  it('GET /crm/philanthropy-report/pdf returns a PDF response', async () => {
    const res = await request(app).get('/crm/philanthropy-report/pdf?fy=2025');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.headers['content-disposition']).toMatch(/Philanthropy_Report/);
  });

  it('GET /crm/philanthropy-report/pdf works without fy param', async () => {
    const res = await request(app).get('/crm/philanthropy-report/pdf');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });

  it('GET /crm/philanthropy-narratives/data returns narratives keyed by department', async () => {
    const res = await request(app).get('/crm/philanthropy-narratives/data?fy=2026');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('narratives');
    expect(res.body.selectedFY).toBe(2026);
  });

  it('POST /crm/philanthropy-narratives upserts a narrative', async () => {
    const res = await request(app)
      .post('/crm/philanthropy-narratives')
      .send({
        department: 'Legacy Giving',
        fiscalYear: 2026,
        highlights: '- Proactive Estate Administration',
        priorities: '- Attend CAGP Conference',
        commentary: 'Revenue shortfall reflects delayed realization.',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('POST /crm/philanthropy-narratives rejects missing fields', async () => {
    const res = await request(app)
      .post('/crm/philanthropy-narratives')
      .send({ fiscalYear: 2026 }); // missing department
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage: FY query param handling on data endpoints
// ---------------------------------------------------------------------------
describe('FY query parameter handling', () => {
  it('GET /crm/recurring-donors/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/recurring-donors/data?fy=2024');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2024);
  });

  it('GET /crm/donor-lifecycle/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/donor-lifecycle/data?fy=2024');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2024);
  });

  it('GET /crm/gift-trends/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/gift-trends/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/campaign-compare/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/campaign-compare/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/fund-health/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/fund-health/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/donor-insights/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/donor-insights/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/anomalies/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/anomalies/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/retention/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/retention/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/household-giving/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/household-giving/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/lybunt-sybunt/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/lybunt-sybunt/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/lybunt-sybunt/data accepts yearsSince filter', async () => {
    const res = await request(app).get('/crm/lybunt-sybunt/data?fy=2025&yearsSince=2-3');
    expect(res.status).toBe(200);
  });

  it('GET /crm/lybunt-sybunt/data accepts segment preset', async () => {
    const res = await request(app).get('/crm/lybunt-sybunt/data?fy=2025&segment=high-value-lapsed');
    expect(res.status).toBe(200);
  });

  it('GET /crm/lybunt-sybunt/data accepts custom FY range filters', async () => {
    const res = await request(app).get('/crm/lybunt-sybunt/data?fy=2025&gaveInFyStart=2018&gaveInFyEnd=2020&notInFyStart=2021&notInFyEnd=2025');
    expect(res.status).toBe(200);
  });

  it('GET /crm/lybunt-sybunt/data ignores invalid segment', async () => {
    const res = await request(app).get('/crm/lybunt-sybunt/data?fy=2025&segment=invalid');
    expect(res.status).toBe(200);
  });

  it('GET /crm/donor-upgrade-downgrade/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/donor-upgrade-downgrade/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/first-time-donors/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/first-time-donors/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });

  it('GET /crm/recommendations/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/crm/recommendations/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });
});

// ---------------------------------------------------------------------------
// Additional error handling paths
// ---------------------------------------------------------------------------
describe('Additional error handling', () => {
  it('returns 500 when donor detail data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getDonorDetail.mockRejectedValueOnce(new Error('donor lookup fail'));
    const res = await request(app).get('/crm/donor/D999/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('donor lookup fail');
  });

  it('returns 500 when gift search data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.searchGifts.mockRejectedValueOnce(new Error('search fail'));
    const res = await request(app).get('/crm/gifts/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('search fail');
  });

  it('returns 500 when entity detail data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getEntityDetail.mockRejectedValueOnce(new Error('entity fail'));
    const res = await request(app).get('/crm/fund/F001/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('entity fail');
  });

  it('returns 500 when donor scoring data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getDonorScoring.mockRejectedValueOnce(new Error('scoring fail'));
    const res = await request(app).get('/crm/donor-scoring/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('scoring fail');
  });

  it('returns 500 when retention data service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getRetentionDrilldown.mockRejectedValueOnce(new Error('retention fail'));
    const res = await request(app).get('/crm/retention/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('retention fail');
  });

  it('returns 500 when data quality service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getDataQualityReport.mockRejectedValueOnce(new Error('quality fail'));
    const res = await request(app).get('/crm/data-quality/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('quality fail');
  });

  it('returns 500 when anomaly detection service throws', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getAnomalyDetection.mockRejectedValueOnce(new Error('anomaly fail'));
    const res = await request(app).get('/crm/anomalies/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('anomaly fail');
  });
});

// ---------------------------------------------------------------------------
// Insights endpoint with fy param
// ---------------------------------------------------------------------------
describe('Insights endpoint', () => {
  it('GET /crm-dashboard/insights with fy param passes it along', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getProactiveInsights.mockClear();
    await request(app).get('/crm-dashboard/insights?fy=2025');
    expect(svc.getProactiveInsights).toHaveBeenCalledWith('test-tenant', 2025);
  });

  it('GET /crm-dashboard/insights without fy passes null', async () => {
    const svc = require('../../src/services/crmDashboardService');
    svc.getProactiveInsights.mockClear();
    await request(app).get('/crm-dashboard/insights');
    expect(svc.getProactiveInsights).toHaveBeenCalledWith('test-tenant', null);
  });
});

// ---------------------------------------------------------------------------
// Fundraiser performance with FY
// ---------------------------------------------------------------------------
describe('Fundraiser performance FY handling', () => {
  it('GET /fundraiser-performance/data with fy param sets selectedFY', async () => {
    const res = await request(app).get('/fundraiser-performance/data?fy=2025');
    expect(res.status).toBe(200);
    expect(res.body.selectedFY).toBe(2025);
  });
});
