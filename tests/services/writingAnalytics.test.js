jest.mock('../../src/models', () => ({
  sequelize: { query: jest.fn() },
}));

const { sequelize } = require('../../src/models');
const { getVariantStats, _internals } = require('../../src/services/writingAnalytics');

describe('writingAnalytics._internals', () => {
  describe('rate', () => {
    it('returns null when denominator is zero', () => {
      expect(_internals.rate(0, 0)).toBeNull();
    });
    it('returns the ratio otherwise', () => {
      expect(_internals.rate(3, 10)).toBe(0.3);
      expect(_internals.rate(10, 10)).toBe(1);
    });
  });

  describe('accumulate', () => {
    it('sums variant numbers into the running total', () => {
      const sum = _internals.emptyTotals();
      _internals.accumulate(sum, {
        total: 3, helpful: 2, neutral: 1, notHelpful: 0, unrated: 0, saved: 1,
        cacheReadTokens: 100, cacheCreationTokens: 10, inputTokens: 50, outputTokens: 20,
      });
      _internals.accumulate(sum, {
        total: 2, helpful: 1, neutral: 0, notHelpful: 1, unrated: 0, saved: 0,
        cacheReadTokens: 50, cacheCreationTokens: 0, inputTokens: 25, outputTokens: 10,
      });
      expect(sum.total).toBe(5);
      expect(sum.helpful).toBe(3);
      expect(sum.notHelpful).toBe(1);
      expect(sum.saved).toBe(1);
      expect(sum.cacheReadTokens).toBe(150);
      expect(sum.outputTokens).toBe(30);
    });
  });
});

describe('writingAnalytics.getVariantStats', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('throws without a tenantId', async () => {
    await expect(getVariantStats(null)).rejects.toThrow(/tenantId/);
  });

  it('returns empty summary and empty byFeature when no rows', async () => {
    sequelize.query.mockResolvedValue([]);
    const result = await getVariantStats(7);
    expect(result.periodDays).toBe(30);
    expect(result.summary.total).toBe(0);
    expect(result.summary.helpfulRate).toBeNull();
    expect(result.summary.saveRate).toBeNull();
    expect(result.summary.cacheHitRate).toBeNull();
    expect(result.byFeature).toEqual({});
  });

  it('buckets rows by feature in a stable known-feature-first order', async () => {
    sequelize.query.mockResolvedValue([
      { feature: 'digest', prompt_version: 'baseline', total: 1, helpful: 0, not_helpful: 0, neutral: 0, unrated: 1, saved: 0, avg_duration_ms: 100, cache_read_tokens: '0', cache_creation_tokens: '0', input_tokens: '10', output_tokens: '5', first_seen_at: '2026-04-01', last_seen_at: '2026-04-01' },
      { feature: 'thankYou', prompt_version: 'baseline', total: 2, helpful: 2, not_helpful: 0, neutral: 0, unrated: 0, saved: 1, avg_duration_ms: 200, cache_read_tokens: '1000', cache_creation_tokens: '0', input_tokens: '100', output_tokens: '50', first_seen_at: '2026-04-02', last_seen_at: '2026-04-03' },
      { feature: 'writing', prompt_version: 'baseline', total: 3, helpful: 1, not_helpful: 1, neutral: 0, unrated: 1, saved: 0, avg_duration_ms: 150, cache_read_tokens: '500', cache_creation_tokens: '0', input_tokens: '50', output_tokens: '25', first_seen_at: '2026-04-01', last_seen_at: '2026-04-04' },
    ]);

    const result = await getVariantStats(7);
    const keys = Object.keys(result.byFeature);
    // 'writing' comes before 'thankYou' comes before 'digest' in the canonical order.
    expect(keys.indexOf('writing')).toBeLessThan(keys.indexOf('thankYou'));
    expect(keys.indexOf('thankYou')).toBeLessThan(keys.indexOf('digest'));
  });

  it('computes helpful / save / cache rates per variant', async () => {
    sequelize.query.mockResolvedValue([
      {
        feature: 'thankYou',
        prompt_version: 'baseline',
        total: 10, helpful: 6, not_helpful: 2, neutral: 0, unrated: 2, saved: 3,
        avg_duration_ms: 1500,
        cache_read_tokens: '1600', cache_creation_tokens: '0', input_tokens: '400', output_tokens: '500',
        first_seen_at: '2026-04-01', last_seen_at: '2026-04-10',
      },
    ]);

    const { byFeature, summary } = await getVariantStats(7);
    const v = byFeature.thankYou[0];

    // Helpful rate ignores unrated: 6 / (6 + 0 + 2) = 0.75
    expect(v.helpfulRate).toBeCloseTo(0.75);
    // Save rate over all generations: 3 / 10 = 0.3
    expect(v.saveRate).toBeCloseTo(0.3);
    // Cache hit: 1600 / (1600 + 0 + 400) = 0.8
    expect(v.cacheHitRate).toBeCloseTo(0.8);
    expect(v.totalInputTokens).toBe(2000);

    // Summary mirrors the single-variant numbers here.
    expect(summary.total).toBe(10);
    expect(summary.helpfulRate).toBeCloseTo(0.75);
    expect(summary.saveRate).toBeCloseTo(0.3);
    expect(summary.cacheHitRate).toBeCloseTo(0.8);
  });

  it('renames NULL prompt_version to "(untagged)"', async () => {
    sequelize.query.mockResolvedValue([
      {
        feature: 'impact', prompt_version: '(untagged)',
        total: 5, helpful: 0, not_helpful: 0, neutral: 0, unrated: 5, saved: 0,
        avg_duration_ms: 100, cache_read_tokens: '0', cache_creation_tokens: '0',
        input_tokens: '100', output_tokens: '50',
        first_seen_at: '2026-04-01', last_seen_at: '2026-04-02',
      },
    ]);
    const result = await getVariantStats(7);
    expect(result.byFeature.impact[0].name).toBe('(untagged)');
    // No rated rows — helpful rate should be null, not NaN or 0.
    expect(result.byFeature.impact[0].helpfulRate).toBeNull();
  });

  it('applies the supplied day window in the WHERE clause', async () => {
    sequelize.query.mockResolvedValue([]);
    await getVariantStats(7, { days: 7 });
    const sql = sequelize.query.mock.calls[0][0];
    expect(sql).toContain("INTERVAL '7 days'");
  });

  it('supports days=null for all-time', async () => {
    sequelize.query.mockResolvedValue([]);
    const r = await getVariantStats(7, { days: null });
    expect(r.periodDays).toBeNull();
    const sql = sequelize.query.mock.calls[0][0];
    expect(sql).not.toContain('INTERVAL');
  });

  it('clamps absurd day windows to the MAX_DAYS ceiling', async () => {
    sequelize.query.mockResolvedValue([]);
    await getVariantStats(7, { days: 99999 });
    const sql = sequelize.query.mock.calls[0][0];
    // Capped at 365 days
    expect(sql).toContain("INTERVAL '365 days'");
  });

  it('always scopes queries to the caller tenant', async () => {
    sequelize.query.mockResolvedValue([]);
    await getVariantStats(42);
    expect(sequelize.query.mock.calls[0][1].replacements.tenantId).toBe(42);
    expect(sequelize.query.mock.calls[0][0]).toContain('tenant_id = :tenantId');
    // Always filters out soft-deleted rows
    expect(sequelize.query.mock.calls[0][0]).toContain('is_hidden = false');
  });
});
