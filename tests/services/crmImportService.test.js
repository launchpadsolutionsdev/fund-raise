jest.mock('../../src/models', () => ({
  sequelize: {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn().mockImplementation(async (fn) => fn({})),
  },
  CrmImport: {
    create: jest.fn().mockResolvedValue({ id: 1, update: jest.fn().mockResolvedValue({}), }),
    findAll: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  },
  CrmGift: {
    bulkCreate: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(100),
    destroy: jest.fn().mockResolvedValue(0),
  },
  CrmGiftFundraiser: {
    bulkCreate: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(50),
    destroy: jest.fn().mockResolvedValue(0),
  },
  CrmGiftSoftCredit: {
    bulkCreate: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(10),
    destroy: jest.fn().mockResolvedValue(0),
  },
  CrmGiftMatch: {
    bulkCreate: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(5),
    destroy: jest.fn().mockResolvedValue(0),
  },
}));

jest.mock('../../src/services/crmExcelParser', () => ({
  autoMapColumns: jest.fn().mockReturnValue({ mapping: { 'Gift ID': 'giftId' }, unmapped: [] }),
  readCsvHeaders: jest.fn().mockResolvedValue(['Gift ID', 'Amount']),
  streamParseCsv: jest.fn().mockResolvedValue({ totalRows: 0 }),
  parseCrmExcel: jest.fn().mockReturnValue({
    gifts: new Map(),
    fundraisers: [],
    softCredits: [],
    matches: [],
    columnMapping: {},
    stats: { totalRows: 0 },
  }),
}));

jest.mock('../../src/services/crmDashboardService', () => ({
  clearCrmCache: jest.fn(),
  getCrmOverview: jest.fn().mockResolvedValue({}),
  getFiscalYears: jest.fn().mockResolvedValue([]),
  getGivingByMonth: jest.fn().mockResolvedValue([]),
  getTopDonors: jest.fn().mockResolvedValue([]),
  getTopFunds: jest.fn().mockResolvedValue([]),
  getTopCampaigns: jest.fn().mockResolvedValue([]),
  getTopAppeals: jest.fn().mockResolvedValue([]),
  getDepartmentAnalytics: jest.fn().mockResolvedValue({}),
  getDepartmentExtras: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/crmMaterializedViews', () => ({
  refreshMaterializedViews: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/crmDepartmentClassifier', () => ({
  classifyDepartment: jest.fn().mockReturnValue('annual_giving'),
}));

const { importCrmFile, getImportHistory, getCrmStats } = require('../../src/services/crmImportService');
const models = require('../../src/models');
const { classifyDepartment } = require('../../src/services/crmDepartmentClassifier');
const { parseCrmExcel, autoMapColumns, readCsvHeaders, streamParseCsv } = require('../../src/services/crmExcelParser');

// Access internal batch functions via the module internals
// Since insertGiftBatch etc. are not exported, we test them indirectly through importCrmFile
// But we can also re-require the module to test the exports

// Helper: get the non-exported batch functions by loading the module source
// We'll test them indirectly through importCrmFile

const TENANT_ID = 'tenant-123';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// insertGiftBatch (tested indirectly via importCrmFile with Excel path)
// ---------------------------------------------------------------------------

describe('importCrmFile - Excel path (exercises insertGiftBatch)', () => {
  test('empty Excel file produces zero upserts', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [],
      softCredits: [],
      matches: [],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    const result = await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    expect(result).toBeDefined();
    expect(models.CrmImport.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      status: 'processing',
    }));
    // No bulkCreate calls for empty data
    expect(models.CrmGift.bulkCreate).not.toHaveBeenCalled();
  });

  test('Excel file with gifts calls bulkCreate with department classification', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map([
        ['G1', { amount: 100, fundDescription: 'Annual Fund' }],
        ['G2', { amount: 200, fundDescription: 'Capital Campaign' }],
      ]),
      fundraisers: [],
      softCredits: [],
      matches: [],
      columnMapping: { 'Gift ID': 'giftId' },
      stats: { totalRows: 2 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 2048,
    });

    expect(models.CrmGift.bulkCreate).toHaveBeenCalled();
    const callArgs = models.CrmGift.bulkCreate.mock.calls[0][0];
    expect(callArgs.length).toBe(2);
    expect(callArgs[0].tenantId).toBe(TENANT_ID);
    expect(callArgs[0].department).toBe('annual_giving');
    expect(classifyDepartment).toHaveBeenCalled();
  });

  test('Excel file with fundraisers calls CrmGiftFundraiser.bulkCreate', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [
        { giftId: 'G1', fundraiserName: 'Alice' },
        { giftId: 'G2', fundraiserName: 'Bob' },
      ],
      softCredits: [],
      matches: [],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    expect(models.CrmGiftFundraiser.bulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tenantId: TENANT_ID, fundraiserName: 'Alice' }),
      ]),
      { validate: false },
    );
  });

  test('Excel fundraiser deduplication removes duplicates by giftId+fundraiserName', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [
        { giftId: 'G1', fundraiserName: 'Alice' },
        { giftId: 'G1', fundraiserName: 'Alice' }, // duplicate
        { giftId: 'G1', fundraiserName: 'Bob' },   // different name, same gift
      ],
      softCredits: [],
      matches: [],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    const callArgs = models.CrmGiftFundraiser.bulkCreate.mock.calls[0][0];
    expect(callArgs.length).toBe(2); // deduplicated from 3 to 2
  });

  test('Excel soft credits deduplication removes duplicates by giftId+recipientId', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [],
      softCredits: [
        { giftId: 'G1', recipientId: 'R1' },
        { giftId: 'G1', recipientId: 'R1' }, // duplicate
        { giftId: 'G1', recipientId: 'R2' },
      ],
      matches: [],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    const callArgs = models.CrmGiftSoftCredit.bulkCreate.mock.calls[0][0];
    expect(callArgs.length).toBe(2);
  });

  test('Excel match deduplication removes duplicates by giftId+matchGiftId', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [],
      softCredits: [],
      matches: [
        { giftId: 'G1', matchGiftId: 'M1' },
        { giftId: 'G1', matchGiftId: 'M1' }, // duplicate
        { giftId: 'G2', matchGiftId: 'M1' },
      ],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    const callArgs = models.CrmGiftMatch.bulkCreate.mock.calls[0][0];
    expect(callArgs.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// importCrmFile - CSV path
// ---------------------------------------------------------------------------

describe('importCrmFile - CSV path', () => {
  test('CSV import reads headers and streams parse', async () => {
    autoMapColumns.mockReturnValue({
      mapping: { 'Gift ID': 'giftId', 'Amount': 'amount' },
      unmapped: ['Extra Col'],
    });
    readCsvHeaders.mockResolvedValue(['Gift ID', 'Amount', 'Extra Col']);
    streamParseCsv.mockResolvedValue({ totalRows: 5 });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.csv', {
      fileName: 'data.csv',
      fileSize: 4096,
    });

    expect(readCsvHeaders).toHaveBeenCalledWith('/tmp/test.csv');
    expect(autoMapColumns).toHaveBeenCalled();
    expect(streamParseCsv).toHaveBeenCalled();
  });

  test('CSV import fails if no giftId mapping found', async () => {
    autoMapColumns.mockReturnValue({
      mapping: { 'Amount': 'amount' },
      unmapped: [],
    });
    readCsvHeaders.mockResolvedValue(['Amount']);

    await expect(
      importCrmFile(TENANT_ID, 'user1', '/tmp/test.csv', {
        fileName: 'bad.csv',
        fileSize: 100,
      }),
    ).rejects.toThrow('Gift ID');
  });
});

// ---------------------------------------------------------------------------
// importCrmFile - error handling
// ---------------------------------------------------------------------------

describe('importCrmFile - error handling', () => {
  test('marks import as failed when an error occurs', async () => {
    parseCrmExcel.mockImplementation(() => {
      throw new Error('Parse failure');
    });

    const mockUpdate = jest.fn().mockResolvedValue({});
    models.CrmImport.create.mockResolvedValue({ id: 1, update: mockUpdate });

    await expect(
      importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
        fileName: 'bad.xlsx',
        fileSize: 100,
      }),
    ).rejects.toThrow('Parse failure');

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorMessage: expect.stringContaining('Parse failure'),
    }));
  });

  test('error with sql property logs SQL snippet', async () => {
    const err = new Error('SQL error');
    err.sql = 'INSERT INTO crm_gifts VALUES ...';
    parseCrmExcel.mockImplementation(() => { throw err; });

    const mockUpdate = jest.fn().mockResolvedValue({});
    models.CrmImport.create.mockResolvedValue({ id: 1, update: mockUpdate });

    await expect(
      importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
        fileName: 'bad.xlsx',
        fileSize: 100,
      }),
    ).rejects.toThrow('SQL error');
  });
});

// ---------------------------------------------------------------------------
// importCrmFile - clears existing data
// ---------------------------------------------------------------------------

describe('importCrmFile - data clearing', () => {
  test('deletes existing tenant data before import', async () => {
    parseCrmExcel.mockReturnValue({
      gifts: new Map(),
      fundraisers: [],
      softCredits: [],
      matches: [],
      columnMapping: {},
      stats: { totalRows: 0 },
    });

    await importCrmFile(TENANT_ID, 'user1', '/tmp/test.xlsx', {
      fileName: 'test.xlsx',
      fileSize: 1024,
    });

    expect(models.CrmGift.destroy).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(models.CrmGiftFundraiser.destroy).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(models.CrmGiftSoftCredit.destroy).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(models.CrmGiftMatch.destroy).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
  });
});

// ---------------------------------------------------------------------------
// getImportHistory
// ---------------------------------------------------------------------------

describe('getImportHistory', () => {
  test('calls CrmImport.findAll with correct params', async () => {
    models.CrmImport.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const result = await getImportHistory(TENANT_ID);

    expect(models.CrmImport.findAll).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
      order: [['uploadedAt', 'DESC']],
      limit: 20,
    });
    expect(result).toHaveLength(2);
  });

  test('returns empty array when no history', async () => {
    models.CrmImport.findAll.mockResolvedValue([]);
    const result = await getImportHistory(TENANT_ID);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getCrmStats
// ---------------------------------------------------------------------------

describe('getCrmStats', () => {
  test('returns counts from all models', async () => {
    models.CrmGift.count.mockResolvedValue(100);
    models.CrmGiftFundraiser.count.mockResolvedValue(50);
    models.CrmGiftSoftCredit.count.mockResolvedValue(10);
    models.CrmGiftMatch.count.mockResolvedValue(5);
    models.CrmImport.findOne.mockResolvedValue(null);

    const result = await getCrmStats(TENANT_ID);

    expect(result.gifts).toBe(100);
    expect(result.fundraisers).toBe(50);
    expect(result.softCredits).toBe(10);
    expect(result.matches).toBe(5);
    expect(result.lastImport).toBeNull();
  });

  test('includes lastImport when a completed import exists', async () => {
    models.CrmImport.findOne.mockResolvedValue({
      completedAt: '2025-01-01',
      fileName: 'data.xlsx',
      giftsUpserted: 42,
    });

    const result = await getCrmStats(TENANT_ID);

    expect(result.lastImport).toEqual({
      date: '2025-01-01',
      fileName: 'data.xlsx',
      giftsUpserted: 42,
    });
  });

  test('calls count with tenantId filter', async () => {
    models.CrmImport.findOne.mockResolvedValue(null);
    await getCrmStats(TENANT_ID);

    expect(models.CrmGift.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(models.CrmGiftFundraiser.count).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
  });
});
