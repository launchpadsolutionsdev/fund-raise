// ---------------------------------------------------------------------------
// Mock all heavy dependencies BEFORE requiring any route module
// ---------------------------------------------------------------------------

// Mock sequelize and all models
jest.mock('../../src/models', () => {
  const mockModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
    define: jest.fn(),
    belongsTo: jest.fn(),
    hasMany: jest.fn(),
    sync: jest.fn().mockResolvedValue(undefined),
  };

  // Bingo route calls sequelize.define() inline — return a model-like object
  const defineMock = jest.fn().mockReturnValue({
    ...mockModel,
    sync: jest.fn().mockResolvedValue(undefined),
  });

  return {
    sequelize: {
      query: jest.fn(),
      define: defineMock,
      literal: jest.fn((v) => v),
      fn: jest.fn(),
      col: jest.fn(),
      transaction: jest.fn(),
    },
    Sequelize: { Op: {} },
    Tenant: { ...mockModel },
    User: { ...mockModel },
    Snapshot: { ...mockModel },
    DepartmentSummary: { ...mockModel },
    GiftTypeBreakdown: { ...mockModel },
    SourceBreakdown: { ...mockModel },
    FundBreakdown: { ...mockModel },
    RawGift: { ...mockModel },
    BlackbaudToken: { ...mockModel },
    Conversation: { ...mockModel },
    Post: { ...mockModel },
    PostComment: { ...mockModel },
    Milestone: { ...mockModel },
    QuickNote: { ...mockModel },
    Kudos: { ...mockModel },
    CrmImport: { ...mockModel },
    CrmGift: { ...mockModel },
    CrmGiftFundraiser: { ...mockModel },
    CrmGiftSoftCredit: { ...mockModel },
    CrmGiftMatch: { ...mockModel },
    FundraiserGoal: { ...mockModel },
    DepartmentGoal: { ...mockModel },
  };
});

// Mock middleware — just pass through
jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, res, next) => next(),
  ensureUploader: (req, res, next) => next(),
  ensureAdmin: (req, res, next) => next(),
}));

// Mock services
jest.mock('../../src/services/snapshotService', () => ({
  getAvailableDates: jest.fn(),
  getSnapshotForDate: jest.fn(),
  getDashboardData: jest.fn(),
  getEnhancedDashboardData: jest.fn(),
  getDepartmentData: jest.fn(),
  getDepartmentEnhancedData: jest.fn(),
  getCrossDepartmentData: jest.fn(),
  getTrendsEnhanced: jest.fn(),
  getSnapshotComparison: jest.fn(),
  getGiftSeasonality: jest.fn(),
  getProjection: jest.fn(),
  getOperationalMetrics: jest.fn(),
  saveDepartmentData: jest.fn(),
}));

jest.mock('../../src/services/aiService', () => ({
  chat: jest.fn(),
  chatStream: jest.fn(),
  generateTitle: jest.fn(),
  clearCache: jest.fn(),
}));

jest.mock('../../src/services/blackbaudClient', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  getAuthorizeUrl: jest.fn(),
}));

jest.mock('../../src/services/excelParser', () => ({
  parseDepartmentFile: jest.fn(),
}));

jest.mock('../../src/services/crmExcelParser', () => ({
  autoMapColumns: jest.fn(),
  readCsvHeaders: jest.fn(),
}));

jest.mock('../../src/services/crmImportService', () => ({
  importCrmFile: jest.fn(),
  getImportHistory: jest.fn(),
  getCrmStats: jest.fn(),
}));

jest.mock('../../src/services/crmDashboardService', () => ({
  getCrmOverview: jest.fn(),
  getGivingByMonth: jest.fn(),
  getTopDonors: jest.fn(),
  getTopFunds: jest.fn(),
  getTopCampaigns: jest.fn(),
  getTopAppeals: jest.fn(),
  getGiftsByType: jest.fn(),
  getFundraiserLeaderboard: jest.fn(),
  getFundraiserPortfolio: jest.fn(),
  getFiscalYears: jest.fn(),
  getDonorRetention: jest.fn(),
  getGivingPyramid: jest.fn(),
  getDonorDetail: jest.fn(),
  searchGifts: jest.fn(),
  getFilterOptions: jest.fn(),
  getEntityDetail: jest.fn(),
  getDonorScoring: jest.fn(),
  getFundraiserGoals: jest.fn(),
  setFundraiserGoal: jest.fn(),
  deleteFundraiserGoal: jest.fn(),
  getRecurringDonorAnalysis: jest.fn(),
  getAcknowledgmentTracker: jest.fn(),
  getMatchingGiftAnalysis: jest.fn(),
  getSoftCreditAnalysis: jest.fn(),
  getPaymentMethodAnalysis: jest.fn(),
  getDonorLifecycleAnalysis: jest.fn(),
  getGiftTrendAnalysis: jest.fn(),
  getCampaignComparison: jest.fn(),
  getFundHealthReport: jest.fn(),
  getYearOverYearComparison: jest.fn(),
  getDonorInsights: jest.fn(),
  getAppealComparison: jest.fn(),
  getAppealDetail: jest.fn(),
  getDepartmentAnalytics: jest.fn(),
  getDepartmentExtras: jest.fn(),
  getDepartmentGoals: jest.fn(),
  setDepartmentGoal: jest.fn(),
  deleteDepartmentGoal: jest.fn(),
  getDepartmentActuals: jest.fn(),
  getDataQualityReport: jest.fn(),
  getLybuntSybunt: jest.fn(),
  getDonorUpgradeDowngrade: jest.fn(),
}));

// Mock passport (auth route uses it)
jest.mock('passport', () => ({
  authenticate: jest.fn(() => (req, res, next) => next()),
}));

// Mock Anthropic SDK (writing, impact, digest, thankYou, meetingPrep use it)
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  }));
});

// Mock multer (upload, crmUpload, profile, ai routes use it)
jest.mock('multer', () => {
  const multerMock = jest.fn().mockReturnValue({
    single: jest.fn().mockReturnValue((req, res, next) => next()),
    array: jest.fn().mockReturnValue((req, res, next) => next()),
    fields: jest.fn().mockReturnValue((req, res, next) => next()),
  });
  multerMock.memoryStorage = jest.fn().mockReturnValue({});
  multerMock.diskStorage = jest.fn().mockReturnValue({});
  return multerMock;
});

// Mock crypto (blackbaud route uses it)
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue({ toString: () => 'abc123' }),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const routeFiles = [
  'landing',
  'auth',
  'dashboard',
  'ai',
  'departments',
  'upload',
  'crmUpload',
  'crmDashboard',
  'api',
  'blackbaud',
  'live',
  'profile',
  'board',
  'writing',
  'milestones',
  'impact',
  'bingo',
  'notes',
  'meetingPrep',
  'thermometer',
  'kudos',
  'digest',
  'thankYou',
  'scenarios',
];

describe('Route modules', () => {
  routeFiles.forEach((name) => {
    it(`${name} route exports a function (Express router)`, () => {
      const route = require(`../../src/routes/${name}`);
      expect(typeof route).toBe('function');
    });
  });
});
