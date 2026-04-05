/**
 * Tests for snapshotService.js
 */

jest.mock('../../src/models', () => {
  return {
    sequelize: { query: jest.fn().mockResolvedValue([]), QueryTypes: { SELECT: 'SELECT' } },
    Snapshot: {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    },
    DepartmentSummary: {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    GiftTypeBreakdown: {
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    },
    SourceBreakdown: {
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    },
    FundBreakdown: {
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    },
    RawGift: {
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    },
    User: {},
  };
});

const {
  sequelize,
  Snapshot,
  DepartmentSummary,
  GiftTypeBreakdown,
  SourceBreakdown,
  FundBreakdown,
  RawGift,
} = require('../../src/models');

const {
  getAvailableDates,
  getSnapshotForDate,
  getDashboardData,
  getDepartmentData,
  saveDepartmentData,
  getEnhancedDashboardData,
  getDepartmentEnhancedData,
  getCrossDepartmentData,
  getTrendsEnhanced,
  getSnapshotComparison,
  getGiftSeasonality,
  getProjection,
  getOperationalMetrics,
} = require('../../src/services/snapshotService');

beforeEach(() => {
  jest.clearAllMocks();
  // Restore defaults
  Snapshot.findAll.mockResolvedValue([]);
  Snapshot.findOne.mockResolvedValue(null);
  DepartmentSummary.findAll.mockResolvedValue([]);
  DepartmentSummary.findOne.mockResolvedValue(null);
  DepartmentSummary.create.mockResolvedValue({});
  GiftTypeBreakdown.findAll.mockResolvedValue([]);
  GiftTypeBreakdown.bulkCreate.mockResolvedValue([]);
  SourceBreakdown.findAll.mockResolvedValue([]);
  SourceBreakdown.bulkCreate.mockResolvedValue([]);
  FundBreakdown.findAll.mockResolvedValue([]);
  FundBreakdown.bulkCreate.mockResolvedValue([]);
  RawGift.findOne.mockResolvedValue(null);
  RawGift.findAll.mockResolvedValue([]);
  RawGift.count.mockResolvedValue(0);
  RawGift.bulkCreate.mockResolvedValue([]);
  sequelize.query.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// getAvailableDates
// ---------------------------------------------------------------------------
describe('getAvailableDates', () => {
  it('returns an array of dates from snapshots', async () => {
    Snapshot.findAll.mockResolvedValue([
      { snapshotDate: '2026-03-01' },
      { snapshotDate: '2026-02-01' },
    ]);
    const result = await getAvailableDates('tenant1');
    expect(result).toEqual(['2026-03-01', '2026-02-01']);
    expect(Snapshot.findAll).toHaveBeenCalledWith({
      where: { tenantId: 'tenant1' },
      order: [['snapshotDate', 'DESC']],
      attributes: ['snapshotDate'],
    });
  });

  it('returns empty array when no snapshots exist', async () => {
    const result = await getAvailableDates('tenant1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSnapshotForDate
// ---------------------------------------------------------------------------
describe('getSnapshotForDate', () => {
  it('returns snapshot for given date', async () => {
    const snap = { id: 1, snapshotDate: '2026-03-01' };
    Snapshot.findOne.mockResolvedValue(snap);
    const result = await getSnapshotForDate('tenant1', '2026-03-01');
    expect(result).toBe(snap);
    expect(Snapshot.findOne).toHaveBeenCalledWith({ where: { tenantId: 'tenant1', snapshotDate: '2026-03-01' } });
  });

  it('returns null when no snapshot found', async () => {
    const result = await getSnapshotForDate('tenant1', '2099-01-01');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getDashboardData
// ---------------------------------------------------------------------------
describe('getDashboardData', () => {
  const snapshot = { id: 10 };

  it('returns zeros when no summaries exist', async () => {
    const result = await getDashboardData(snapshot);
    expect(result).toEqual({
      totalRaised: 0,
      totalGifts: 0,
      combinedGoal: 0,
      overallPct: 0,
      departments: {},
    });
  });

  it('aggregates department summaries correctly', async () => {
    DepartmentSummary.findAll.mockResolvedValue([
      { department: 'annual_giving', totalAmount: '1000', totalGifts: 10, goal: '5000' },
      { department: 'major_gifts', totalAmount: '2000', totalGifts: 5, goal: '10000' },
    ]);
    const result = await getDashboardData(snapshot);
    expect(result.totalRaised).toBe(3000);
    expect(result.totalGifts).toBe(15);
    expect(result.combinedGoal).toBe(15000);
    expect(result.overallPct).toBeCloseTo(20);
    expect(result.departments.annual_giving.totalAmount).toBe(1000);
    expect(result.departments.major_gifts.totalAmount).toBe(2000);
  });

  it('includes third-party amounts for events department', async () => {
    DepartmentSummary.findAll.mockResolvedValue([
      {
        department: 'events',
        totalAmount: '1000',
        totalGifts: 10,
        goal: '5000',
        thirdPartyTotalAmount: '500',
        thirdPartyTotalGifts: 3,
        thirdPartyGoal: '2000',
      },
    ]);
    const result = await getDashboardData(snapshot);
    expect(result.totalRaised).toBe(1500);
    expect(result.totalGifts).toBe(13);
    expect(result.combinedGoal).toBe(7000);
    expect(result.departments.events.totalAmount).toBe(1500);
    expect(result.departments.events.totalGifts).toBe(13);
    expect(result.departments.events.goal).toBe(7000);
  });

  it('computes pctToGoal per department', async () => {
    DepartmentSummary.findAll.mockResolvedValue([
      { department: 'annual_giving', totalAmount: '2500', totalGifts: 10, goal: '5000' },
    ]);
    const result = await getDashboardData(snapshot);
    expect(result.departments.annual_giving.pctToGoal).toBeCloseTo(50);
  });

  it('returns 0 pctToGoal when goal is 0', async () => {
    DepartmentSummary.findAll.mockResolvedValue([
      { department: 'annual_giving', totalAmount: '2500', totalGifts: 10, goal: '0' },
    ]);
    const result = await getDashboardData(snapshot);
    expect(result.departments.annual_giving.pctToGoal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getDepartmentData
// ---------------------------------------------------------------------------
describe('getDepartmentData', () => {
  const snapshot = { id: 10 };

  it('returns summary, giftTypes, sources, funds, rawCount', async () => {
    const summary = { department: 'annual_giving', totalAmount: '1000' };
    DepartmentSummary.findOne.mockResolvedValue(summary);
    GiftTypeBreakdown.findAll.mockResolvedValue([{ giftType: 'Cash' }]);
    SourceBreakdown.findAll.mockResolvedValue([{ source: 'Online' }]);
    FundBreakdown.findAll.mockResolvedValue([{ fundName: 'General' }]);
    RawGift.count.mockResolvedValue(42);

    const result = await getDepartmentData(snapshot, 'annual_giving');
    expect(result.summary).toBe(summary);
    expect(result.giftTypes).toEqual([{ giftType: 'Cash' }]);
    expect(result.sources).toEqual([{ source: 'Online' }]);
    expect(result.funds).toEqual([{ fundName: 'General' }]);
    expect(result.rawCount).toBe(42);
  });

  it('returns null summary when department not found', async () => {
    const result = await getDepartmentData(snapshot, 'nonexistent');
    expect(result.summary).toBeNull();
    expect(result.rawCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// saveDepartmentData
// ---------------------------------------------------------------------------
describe('saveDepartmentData', () => {
  const snapshot = { id: 10 };
  const baseParsed = {
    summary: {
      totalGifts: 5, totalAmount: 1000, goal: 5000, pctToGoal: 20,
      avgGift: 200, newExpectancies: 1, openEstates: 2, recordedExpectancies: 3,
      thirdPartyTotalGifts: 0, thirdPartyTotalAmount: 0, thirdPartyGoal: 0, thirdPartyPctToGoal: 0,
    },
    giftTypes: [],
    sources: [],
    funds: [],
    rawGifts: [],
  };

  it('creates DepartmentSummary with correct fields', async () => {
    await saveDepartmentData(snapshot, 'annual_giving', baseParsed);
    expect(DepartmentSummary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: 10,
        department: 'annual_giving',
        totalGifts: 5,
        totalAmount: 1000,
      })
    );
  });

  it('skips bulkCreate when arrays are empty', async () => {
    await saveDepartmentData(snapshot, 'annual_giving', baseParsed);
    expect(GiftTypeBreakdown.bulkCreate).not.toHaveBeenCalled();
    expect(SourceBreakdown.bulkCreate).not.toHaveBeenCalled();
    expect(FundBreakdown.bulkCreate).not.toHaveBeenCalled();
    expect(RawGift.bulkCreate).not.toHaveBeenCalled();
  });

  it('bulk creates giftTypes when non-empty', async () => {
    const parsed = {
      ...baseParsed,
      giftTypes: [{ giftType: 'Cash', amount: 100, pctOfGifts: 50 }],
    };
    await saveDepartmentData(snapshot, 'annual_giving', parsed);
    expect(GiftTypeBreakdown.bulkCreate).toHaveBeenCalledWith([
      { snapshotId: 10, department: 'annual_giving', giftType: 'Cash', amount: 100, pctOfGifts: 50 },
    ]);
  });

  it('bulk creates sources when non-empty', async () => {
    const parsed = {
      ...baseParsed,
      sources: [{ source: 'Online', amount: 200, pctOfGifts: 40 }],
    };
    await saveDepartmentData(snapshot, 'annual_giving', parsed);
    expect(SourceBreakdown.bulkCreate).toHaveBeenCalledWith([
      { snapshotId: 10, department: 'annual_giving', source: 'Online', amount: 200, pctOfGifts: 40 },
    ]);
  });

  it('bulk creates funds when non-empty', async () => {
    const parsed = {
      ...baseParsed,
      funds: [{ fundName: 'General', amount: 300, pctOfTotal: 60, category: 'primary', onetimeCount: 1, recurringCount: 2, onlineCount: 3, mailedInCount: 4, totalCount: 10 }],
    };
    await saveDepartmentData(snapshot, 'annual_giving', parsed);
    expect(FundBreakdown.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ snapshotId: 10, department: 'annual_giving', fundName: 'General' }),
    ]);
  });

  it('bulk creates rawGifts when non-empty', async () => {
    const parsed = {
      ...baseParsed,
      rawGifts: [{ primaryAddressee: 'Doe', appealId: 'A1', splitAmount: 100, fundDescription: 'Gen', giftId: 'G1', giftType: 'Cash', giftReference: 'R1', giftDate: '2026-01-01', extraField: null }],
    };
    await saveDepartmentData(snapshot, 'annual_giving', parsed);
    expect(RawGift.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ snapshotId: 10, department: 'annual_giving', primaryAddressee: 'Doe' }),
    ]);
  });

  it('defaults fund category to primary when not specified', async () => {
    const parsed = {
      ...baseParsed,
      funds: [{ fundName: 'General', amount: 300, pctOfTotal: 60, onetimeCount: 0, recurringCount: 0, onlineCount: 0, mailedInCount: 0, totalCount: 0 }],
    };
    await saveDepartmentData(snapshot, 'annual_giving', parsed);
    expect(FundBreakdown.bulkCreate).toHaveBeenCalledWith([
      expect.objectContaining({ category: 'primary' }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// getEnhancedDashboardData
// ---------------------------------------------------------------------------
describe('getEnhancedDashboardData', () => {
  const snapshot = { id: 10 };

  it('returns null largestGift when no raw gifts exist', async () => {
    const result = await getEnhancedDashboardData(snapshot);
    expect(result.largestGift).toBeNull();
    expect(result.donorCount).toBe(0);
    expect(result.giftDistribution).toEqual([]);
    expect(result.topDonors).toEqual([]);
    expect(result.topAppeals).toEqual([]);
  });

  it('returns formatted largestGift when raw gift exists', async () => {
    RawGift.findOne.mockResolvedValue({
      splitAmount: '50000',
      primaryAddressee: 'Big Donor',
      department: 'major_gifts',
      fundDescription: 'Capital Campaign',
    });
    RawGift.count.mockResolvedValue(150);
    const result = await getEnhancedDashboardData(snapshot);
    expect(result.largestGift).toEqual({
      amount: 50000,
      donor: 'Big Donor',
      department: 'major_gifts',
      fund: 'Capital Campaign',
    });
    expect(result.donorCount).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// getDepartmentEnhancedData
// ---------------------------------------------------------------------------
describe('getDepartmentEnhancedData', () => {
  const snapshot = { id: 10 };

  it('returns null channelTotals for non-annual/direct department', async () => {
    const result = await getDepartmentEnhancedData(snapshot, 'major_gifts');
    expect(result.channelTotals).toBeNull();
    expect(result.topDonors).toEqual([]);
    expect(result.giftDistribution).toEqual([]);
    expect(result.appealPerformance).toEqual([]);
  });

  it('computes channelTotals for annual_giving department', async () => {
    FundBreakdown.findAll.mockResolvedValue([
      { onetimeCount: 10, recurringCount: 5, onlineCount: 8, mailedInCount: 7, totalCount: 15 },
      { onetimeCount: 3, recurringCount: 2, onlineCount: 4, mailedInCount: 1, totalCount: 5 },
    ]);
    const result = await getDepartmentEnhancedData(snapshot, 'annual_giving');
    expect(result.channelTotals).toEqual({
      onetime: 13,
      recurring: 7,
      online: 12,
      mailed: 8,
      total: 20,
      recurringRate: 35,
      onlineRate: 60,
    });
  });

  it('computes channelTotals for direct_mail department', async () => {
    FundBreakdown.findAll.mockResolvedValue([]);
    const result = await getDepartmentEnhancedData(snapshot, 'direct_mail');
    expect(result.channelTotals).toEqual({
      onetime: 0, recurring: 0, online: 0, mailed: 0, total: 0,
      recurringRate: 0, onlineRate: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// getCrossDepartmentData
// ---------------------------------------------------------------------------
describe('getCrossDepartmentData', () => {
  const snapshot = { id: 10 };

  it('returns defaults when queries return empty results', async () => {
    const result = await getCrossDepartmentData(snapshot);
    expect(result.crossDeptDonors).toEqual([]);
    expect(result.donorConcentration).toEqual({ top10_pct: 0, top20_pct: 0, top50_pct: 0, total_donors: 0 });
    expect(result.fundRankings).toEqual([]);
  });

  it('returns donorConcentration from first row of query', async () => {
    sequelize.query
      .mockResolvedValueOnce([]) // crossDeptDonors
      .mockResolvedValueOnce([{ top10_pct: 80, top20_pct: 90, top50_pct: 99, total_donors: 500 }])
      .mockResolvedValueOnce([]); // fundRankings
    const result = await getCrossDepartmentData(snapshot);
    expect(result.donorConcentration.top10_pct).toBe(80);
    expect(result.donorConcentration.total_donors).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// getTrendsEnhanced
// ---------------------------------------------------------------------------
describe('getTrendsEnhanced', () => {
  it('returns empty array when no snapshots exist', async () => {
    const result = await getTrendsEnhanced('tenant1');
    expect(result).toEqual([]);
  });

  it('aggregates department data across snapshots', async () => {
    Snapshot.findAll.mockResolvedValue([
      { id: 1, snapshotDate: '2026-01-01' },
      { id: 2, snapshotDate: '2026-02-01' },
    ]);
    DepartmentSummary.findAll
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '1000', totalGifts: 10, goal: '5000' },
      ])
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '2000', totalGifts: 20, goal: '5000' },
      ]);

    const result = await getTrendsEnhanced('tenant1');
    expect(result).toHaveLength(2);
    expect(result[0].totalRaised).toBe(1000);
    expect(result[0].date).toBe('2026-01-01');
    expect(result[1].totalRaised).toBe(2000);
    expect(result[1].departments.annual_giving.totalAmount).toBe(2000);
  });

  it('includes third-party amounts for events in trends', async () => {
    Snapshot.findAll.mockResolvedValue([{ id: 1, snapshotDate: '2026-01-01' }]);
    DepartmentSummary.findAll.mockResolvedValueOnce([
      {
        department: 'events',
        totalAmount: '1000', totalGifts: 10, goal: '5000',
        thirdPartyTotalAmount: '500', thirdPartyTotalGifts: 3, thirdPartyGoal: '2000',
      },
    ]);
    const result = await getTrendsEnhanced('tenant1');
    expect(result[0].totalRaised).toBe(1500);
    expect(result[0].totalGifts).toBe(13);
    expect(result[0].combinedGoal).toBe(7000);
  });
});

// ---------------------------------------------------------------------------
// getSnapshotComparison
// ---------------------------------------------------------------------------
describe('getSnapshotComparison', () => {
  it('returns null when first snapshot not found', async () => {
    Snapshot.findOne.mockResolvedValue(null);
    const result = await getSnapshotComparison('tenant1', '2026-01-01', '2026-02-01');
    expect(result).toBeNull();
  });

  it('returns null when second snapshot not found', async () => {
    Snapshot.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce(null);
    const result = await getSnapshotComparison('tenant1', '2026-01-01', '2026-02-01');
    expect(result).toBeNull();
  });

  it('computes deltas correctly between two snapshots', async () => {
    Snapshot.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });
    DepartmentSummary.findAll
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '1000', totalGifts: 10, goal: '5000' },
      ])
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '3000', totalGifts: 25, goal: '5000' },
      ]);

    const result = await getSnapshotComparison('tenant1', '2026-01-01', '2026-02-01');
    expect(result.date1).toBe('2026-01-01');
    expect(result.date2).toBe('2026-02-01');
    expect(result.delta.totalRaised).toBe(2000);
    expect(result.delta.totalGifts).toBe(15);
    expect(result.delta.departments.annual_giving.totalAmount).toBe(2000);
  });

  it('handles departments only in one period', async () => {
    Snapshot.findOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 });
    DepartmentSummary.findAll
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '1000', totalGifts: 10, goal: '5000' },
      ])
      .mockResolvedValueOnce([
        { department: 'major_gifts', totalAmount: '2000', totalGifts: 5, goal: '10000' },
      ]);

    const result = await getSnapshotComparison('tenant1', '2026-01-01', '2026-02-01');
    expect(result.delta.departments.annual_giving.totalAmount).toBe(-1000);
    expect(result.delta.departments.major_gifts.totalAmount).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// getGiftSeasonality
// ---------------------------------------------------------------------------
describe('getGiftSeasonality', () => {
  const snapshot = { id: 10 };

  it('returns rows from query', async () => {
    const rows = [{ month: 1, gifts: 10, total: 5000, avg_gift: 500 }];
    sequelize.query.mockResolvedValue(rows);
    const result = await getGiftSeasonality(snapshot);
    expect(result).toEqual(rows);
  });

  it('returns empty array on query error', async () => {
    sequelize.query.mockRejectedValue(new Error('DB error'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await getGiftSeasonality(snapshot);
    expect(result).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getProjection
// ---------------------------------------------------------------------------
describe('getProjection', () => {
  it('returns null when no trends', async () => {
    // Snapshot.findAll already returns [] by default
    const result = await getProjection('tenant1');
    expect(result).toBeNull();
  });

  it('returns basic projection with single snapshot', async () => {
    Snapshot.findAll.mockResolvedValue([{ id: 1, snapshotDate: '2026-01-15' }]);
    DepartmentSummary.findAll.mockResolvedValueOnce([
      { department: 'annual_giving', totalAmount: '10000', totalGifts: 50, goal: '100000' },
    ]);

    const result = await getProjection('tenant1');
    expect(result).not.toBeNull();
    expect(result.currentTotal).toBe(10000);
    expect(result.goal).toBe(100000);
    expect(result.gapToGoal).toBe(90000);
    expect(result.dailyRate).toBe(0);
    expect(result.projectedTotal).toBe(10000);
    expect(result.onTrack).toBe(false);
    expect(result.snapshotCount).toBe(1);
  });

  it('calculates daily rate and projection with 2+ snapshots', async () => {
    Snapshot.findAll.mockResolvedValue([
      { id: 1, snapshotDate: '2026-01-01' },
      { id: 2, snapshotDate: '2026-01-31' },
    ]);
    DepartmentSummary.findAll
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '10000', totalGifts: 50, goal: '100000' },
      ])
      .mockResolvedValueOnce([
        { department: 'annual_giving', totalAmount: '20000', totalGifts: 100, goal: '100000' },
      ]);

    const result = await getProjection('tenant1');
    expect(result).not.toBeNull();
    expect(result.currentTotal).toBe(20000);
    expect(result.goal).toBe(100000);
    expect(result.dailyRate).toBeCloseTo(10000 / 30, 1);
    expect(result.snapshotCount).toBe(2);
    expect(typeof result.daysRemaining).toBe('number');
    expect(typeof result.projectedTotal).toBe('number');
    expect(typeof result.onTrack).toBe('boolean');
    expect(result.fyEndDate).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getOperationalMetrics
// ---------------------------------------------------------------------------
describe('getOperationalMetrics', () => {
  it('returns metrics with empty snapshot history', async () => {
    const result = await getOperationalMetrics('tenant1');
    expect(result.totalSnapshots).toBe(0);
    expect(result.daysSinceUpload).toBeNull();
    expect(result.totalRawGifts).toBe(0);
    expect(result.deptCoverage).toEqual([]);
    expect(result.uploadHistory).toEqual([]);
  });

  it('returns metrics with snapshot history', async () => {
    const now = new Date();
    Snapshot.findAll.mockResolvedValue([
      {
        id: 1,
        snapshotDate: '2026-03-01',
        uploadedAt: now.toISOString(),
        createdAt: now.toISOString(),
        uploader: { name: 'Jane', email: 'jane@example.com' },
        notes: 'Weekly upload',
      },
    ]);
    RawGift.count.mockResolvedValue(500);
    DepartmentSummary.findAll.mockResolvedValue([
      { department: 'annual_giving' },
      { department: 'major_gifts' },
    ]);

    const result = await getOperationalMetrics('tenant1');
    expect(result.totalSnapshots).toBe(1);
    expect(result.daysSinceUpload).toBeGreaterThanOrEqual(0);
    expect(result.totalRawGifts).toBe(500);
    expect(result.deptCoverage).toEqual(['annual_giving', 'major_gifts']);
    expect(result.uploadHistory).toHaveLength(1);
    expect(result.uploadHistory[0].uploadedBy).toBe('Jane');
  });

  it('uses email when uploader name is missing', async () => {
    Snapshot.findAll.mockResolvedValue([
      {
        id: 1,
        snapshotDate: '2026-03-01',
        uploadedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        uploader: { name: null, email: 'jane@example.com' },
        notes: null,
      },
    ]);
    DepartmentSummary.findAll.mockResolvedValue([]);

    const result = await getOperationalMetrics('tenant1');
    expect(result.uploadHistory[0].uploadedBy).toBe('jane@example.com');
  });

  it('shows Unknown when no uploader', async () => {
    Snapshot.findAll.mockResolvedValue([
      {
        id: 1,
        snapshotDate: '2026-03-01',
        uploadedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        uploader: null,
        notes: null,
      },
    ]);
    DepartmentSummary.findAll.mockResolvedValue([]);

    const result = await getOperationalMetrics('tenant1');
    expect(result.uploadHistory[0].uploadedBy).toBe('Unknown');
  });
});
