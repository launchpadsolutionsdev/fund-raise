jest.mock('../../src/models', () => ({
  sequelize: { query: jest.fn() },
}));

const { sequelize } = require('../../src/models');
const {
  getPlatformBenchmarks,
  MIN_TENANTS,
  _internals,
} = require('../../src/services/writingBenchmarks');

describe('writingBenchmarks._internals.rate', () => {
  test('returns null when denominator is zero', () => {
    expect(_internals.rate(0, 0)).toBeNull();
  });
  test('returns the ratio otherwise', () => {
    expect(_internals.rate(3, 10)).toBe(0.3);
  });
});

describe('writingBenchmarks.getPlatformBenchmarks', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('throws when excludeTenantId is missing', async () => {
    await expect(getPlatformBenchmarks(null)).rejects.toThrow(/excludeTenantId/);
  });

  test('always excludes the calling tenant from the pool', async () => {
    sequelize.query.mockResolvedValue([]);
    await getPlatformBenchmarks(7);
    const sql = sequelize.query.mock.calls[0][0];
    const opts = sequelize.query.mock.calls[0][1];
    expect(sql).toContain('tenant_id <> :excludeTenantId');
    expect(opts.replacements.excludeTenantId).toBe(7);
  });

  test('always filters out soft-deleted rows', async () => {
    sequelize.query.mockResolvedValue([]);
    await getPlatformBenchmarks(7);
    expect(sequelize.query.mock.calls[0][0]).toContain('is_hidden = false');
  });

  test('applies the supplied day window in the WHERE clause', async () => {
    sequelize.query.mockResolvedValue([]);
    await getPlatformBenchmarks(7, { days: 14 });
    expect(sequelize.query.mock.calls[0][0]).toContain("INTERVAL '14 days'");
  });

  test('clamps absurd day windows to MAX_DAYS (365)', async () => {
    sequelize.query.mockResolvedValue([]);
    await getPlatformBenchmarks(7, { days: 99999 });
    expect(sequelize.query.mock.calls[0][0]).toContain("INTERVAL '365 days'");
  });

  test('supports days=null for all-time and reports periodDays as null', async () => {
    sequelize.query.mockResolvedValue([]);
    const result = await getPlatformBenchmarks(7, { days: null });
    expect(result.periodDays).toBeNull();
    expect(sequelize.query.mock.calls[0][0]).not.toContain('INTERVAL');
  });

  test('drops features with fewer than MIN_TENANTS distinct contributors', async () => {
    sequelize.query.mockResolvedValue([
      // 2 contributors → below floor → must be dropped
      {
        feature: 'thankYou',
        contributing_tenants: MIN_TENANTS - 1,
        total: 100,
        helpful: 60, not_helpful: 10, neutral: 10, saved: 30,
        cache_read_tokens: '1000', cache_creation_tokens: '0', input_tokens: '500',
        avg_duration_ms: 1500,
      },
      // Exactly MIN_TENANTS → must be exposed
      {
        feature: 'impact',
        contributing_tenants: MIN_TENANTS,
        total: 50,
        helpful: 30, not_helpful: 5, neutral: 5, saved: 10,
        cache_read_tokens: '500', cache_creation_tokens: '0', input_tokens: '500',
        avg_duration_ms: 2000,
      },
    ]);
    const r = await getPlatformBenchmarks(7);
    expect(r.byFeature.thankYou).toBeUndefined();
    expect(r.byFeature.impact).toBeDefined();
  });

  test('computes pooled helpful / save / cache rates per surviving feature', async () => {
    sequelize.query.mockResolvedValue([
      {
        feature: 'thankYou',
        contributing_tenants: 4,
        total: 100,
        helpful: 60, not_helpful: 10, neutral: 10, saved: 25,
        cache_read_tokens: '800', cache_creation_tokens: '0', input_tokens: '200',
        avg_duration_ms: 1200,
      },
    ]);
    const { byFeature } = await getPlatformBenchmarks(7);
    const t = byFeature.thankYou;
    // Helpful rate ignores unrated: 60 / (60+10+10) = 0.75
    expect(t.helpfulRate).toBeCloseTo(0.75);
    // Save rate over all generations: 25 / 100 = 0.25
    expect(t.saveRate).toBeCloseTo(0.25);
    // Cache hit: 800 / (800 + 0 + 200) = 0.8
    expect(t.cacheHitRate).toBeCloseTo(0.8);
    expect(t.contributingTenants).toBe(4);
    expect(t.total).toBe(100);
    expect(t.avgDurationMs).toBe(1200);
  });

  test('exposes MIN_TENANTS in the response so the UI can explain the floor', async () => {
    sequelize.query.mockResolvedValue([]);
    const r = await getPlatformBenchmarks(7);
    expect(r.minTenants).toBe(MIN_TENANTS);
  });

  test('returns null cacheHitRate when there are no input tokens at all', async () => {
    sequelize.query.mockResolvedValue([
      {
        feature: 'writing',
        contributing_tenants: 5,
        total: 10,
        helpful: 0, not_helpful: 0, neutral: 0, saved: 0,
        cache_read_tokens: '0', cache_creation_tokens: '0', input_tokens: '0',
        avg_duration_ms: 0,
      },
    ]);
    const { byFeature } = await getPlatformBenchmarks(7);
    expect(byFeature.writing.cacheHitRate).toBeNull();
    expect(byFeature.writing.helpfulRate).toBeNull();
    expect(byFeature.writing.saveRate).toBe(0);
  });
});
