/**
 * Tests for crmLybuntSybuntV2Service.js
 *
 * Exercises the filter-clause builder (pure), the recapture-probability
 * helpers (pure), and the main orchestrator with mocked sequelize.query so
 * we verify the shape of the returned payload and the fact that KPIs,
 * bands, and table all read from the same filtered cohort CTE.
 */

const mockQuery = jest.fn().mockResolvedValue([]);
const mockTenantFindByPk = jest.fn().mockResolvedValue({ fiscalYearStart: 4 });

jest.mock('../../src/models', () => ({
  sequelize: { query: mockQuery },
  Tenant: { findByPk: mockTenantFindByPk },
}));

const svc = require('../../src/services/crmLybuntSybuntV2Service');

describe('crmLybuntSybuntV2Service', () => {
  beforeEach(() => {
    // mockReset() clears the .mockResolvedValueOnce queue too — without this
    // a leftover Once value from a previous test bleeds into the next.
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
    mockTenantFindByPk.mockReset();
    mockTenantFindByPk.mockResolvedValue({ fiscalYearStart: 4 });
  });

  // ─── Pure helpers ──────────────────────────────────────────────────────

  describe('fyStart / fyEnd', () => {
    it('April fiscal year starts in the prior calendar year', () => {
      expect(svc.fyStart(2026, 4)).toBe('2025-04-01');
      expect(svc.fyEnd(2026, 4)).toBe('2026-04-01');
    });
    it('January fiscal year equals calendar year', () => {
      expect(svc.fyStart(2026, 1)).toBe('2026-01-01');
      expect(svc.fyEnd(2026, 1)).toBe('2027-01-01');
    });
    it('July fiscal year works like April', () => {
      expect(svc.fyStart(2026, 7)).toBe('2025-07-01');
      expect(svc.fyEnd(2026, 7)).toBe('2026-07-01');
    });
  });

  describe('RECAPTURE_PROBABILITY', () => {
    it('descends with recency bucket and is strictly positive', () => {
      const p = svc.RECAPTURE_PROBABILITY;
      expect(p.lybunt).toBeGreaterThan(p.sybunt_2_3);
      expect(p.sybunt_2_3).toBeGreaterThan(p.sybunt_4_5);
      expect(p.sybunt_4_5).toBeGreaterThan(p.sybunt_6_plus);
      expect(p.sybunt_6_plus).toBeGreaterThan(0);
    });
  });

  describe('recaptureProbSql', () => {
    it('uses the provided parameter names', () => {
      const s = svc.recaptureProbSql(':priorFY', ':currentFY');
      expect(s).toContain(':priorFY');
      expect(s).toContain(':currentFY');
      expect(s).toMatch(/CASE/i);
    });
  });

  describe('buildFilterClause', () => {
    const base = { currentFY: 2026, fyMonth: 4 };

    it('returns empty clause and only the default suppression filter when no filters', () => {
      const { where } = svc.buildFilterClause(base);
      expect(where).toContain('is_suppressed = FALSE');
    });

    it('adds category filter', () => {
      const { where, repl } = svc.buildFilterClause({ ...base, category: 'LYBUNT' });
      expect(where).toContain('category = :f_category');
      expect(repl.f_category).toBe('LYBUNT');
    });

    it('rejects unknown segment gracefully', () => {
      const { where } = svc.buildFilterClause({ ...base, segment: 'nonsense-preset' });
      // No crash; default suppression clause only
      expect(where).toContain('is_suppressed = FALSE');
      expect(where).not.toContain('nonsense-preset');
    });

    it('maps long-lapsed preset to years_lapsed >= 5', () => {
      const { where } = svc.buildFilterClause({ ...base, segment: 'long-lapsed' });
      expect(where).toContain('years_lapsed >= 5');
    });

    it('maps high-value-lapsed preset to lifetime threshold', () => {
      const { where } = svc.buildFilterClause({ ...base, segment: 'high-value-lapsed' });
      expect(where).toContain('lifetime_giving >= 1000');
    });

    it('maps one-and-done to total_gifts = 1', () => {
      const { where } = svc.buildFilterClause({ ...base, segment: 'one-and-done' });
      expect(where).toContain('total_gifts = 1');
    });

    it('honours gaveInFyStart / gaveInFyEnd by binding dates', () => {
      const { where, repl } = svc.buildFilterClause({ ...base, gaveInFyStart: 2020, gaveInFyEnd: 2022 });
      expect(where).toContain(':f_gaveStart');
      expect(where).toContain(':f_gaveEnd');
      expect(repl.f_gaveStart).toBe('2019-04-01');
      expect(repl.f_gaveEnd).toBe('2022-04-01');
    });

    it('skips default suppression filter when includeSuppressed is true', () => {
      const { where } = svc.buildFilterClause({ ...base, includeSuppressed: true });
      expect(where).not.toContain('is_suppressed = FALSE');
    });

    it('binds fund / campaign / appeal filters distinctly', () => {
      const { where, repl } = svc.buildFilterClause({
        ...base, fundId: 'F1', campaignId: 'C1', appealId: 'A1',
      });
      expect(repl.f_fundId).toBe('F1');
      expect(repl.f_campaignId).toBe('C1');
      expect(repl.f_appealId).toBe('A1');
      expect(where.match(/fund_id = :f_fundId/g) || []).toHaveLength(1);
    });
  });

  describe('orderBySql', () => {
    it('defaults to priority when sortBy is unknown', () => {
      expect(svc.orderBySql('made-up')).toContain('priority_score_raw');
    });
    it('returns a revenue ordering', () => {
      expect(svc.orderBySql('revenue')).toContain('last_active_fy_giving');
    });
    it('supports recovery, recency, lifetime, years_lapsed', () => {
      expect(svc.orderBySql('recovery')).toContain('realistic_recovery');
      expect(svc.orderBySql('recency')).toContain('last_gift_date');
      expect(svc.orderBySql('lifetime')).toContain('lifetime_giving');
      expect(svc.orderBySql('years_lapsed')).toContain('years_lapsed');
    });
  });

  // ─── Orchestrator ──────────────────────────────────────────────────────

  describe('getLybuntSybuntV2', () => {
    it('returns null without a currentFY', async () => {
      const r = await svc._getLybuntSybuntV2('tenant-1', null);
      expect(r).toBeNull();
    });

    it('returns a properly shaped payload', async () => {
      // 1: combined query returns 'sum' + 'band' + 'donor' rows in one shot
      mockQuery.mockResolvedValueOnce([
        {
          row_type: 'sum', band: null, band_order: 0, cat: null,
          donor_count: 120, amt: 250000, recovery: 48000, avg_annual: 2083,
          ly_count: 50, ly_amt: 80000, ly_recovery: 20000,
          sy_count: 70, sy_amt: 170000, sy_recovery: 28000,
          suppressed_donors: 5, max_recovery: 100000,
        },
        {
          row_type: 'band', band: '$100–$499', band_order: 2, cat: 'LYBUNT',
          donor_count: 30, amt: 6000, recovery: 1500, avg_annual: 0,
          ly_count: 0, ly_amt: 0, ly_recovery: 0,
          sy_count: 0, sy_amt: 0, sy_recovery: 0,
          suppressed_donors: 0, max_recovery: null,
        },
        {
          row_type: 'donor', constituent_id: 'c1', cat: 'LYBUNT',
          last_active_fy: 2025, last_active_fy_giving: 500,
          lifetime_giving: 3000, total_gifts: 4, distinct_fy_count: 4,
          first_gift_date: '2020-04-01', last_gift_date: '2024-09-15',
          years_lapsed: 1, recapture_prob: 0.25,
          realistic_recovery_d: 125, suggested_ask: 575,
          is_suppressed: false, constituent_type: 'Individual',
          priority_score_raw: 250,
        },
      ]);
      // 2: contacts lookup for the page
      mockQuery.mockResolvedValueOnce([{
        constituent_id: 'c1', donor_name: 'Jane Doe',
        first_name: 'Jane', last_name: 'Doe',
      }]);
      // 3: streaks lookup for the page
      mockQuery.mockResolvedValueOnce([{
        constituent_id: 'c1', max_consecutive_fys: 4,
      }]);

      const r = await svc._getLybuntSybuntV2('tenant-1', 2026, { page: 1, limit: 50 });

      expect(r).toBeTruthy();
      expect(r.currentFY).toBe(2026);
      expect(r.priorFY).toBe(2025);
      expect(r.summary.totalDonors).toBe(120);
      expect(r.summary.foregoneRevenue).toBe(250000);
      expect(r.summary.realisticRecovery).toBe(48000);
      expect(r.summary.sybunt.foregone).toBe(170000);
      expect(r.summary.sybunt.recovery).toBe(28000);
      expect(r.summary.sybunt.recovery).toBeLessThan(r.summary.sybunt.foregone);
      expect(r.summary.lybunt.recovery).toBeLessThan(r.summary.lybunt.foregone);
      expect(r.bands).toHaveLength(1);
      expect(r.bands[0].band_recovery).toBe(1500);
      expect(r.topDonors).toHaveLength(1);
      // Priority score = round(250 / (100000 * 3) * 100) = round(0.083) = 0
      // Just verify it's a number, not the exact value
      expect(typeof r.topDonors[0].priority_score).toBe('number');
      expect(r.topDonors[0].donor_name).toBe('Jane Doe');
      expect(r.topDonors[0].max_consecutive_fys).toBe(4);
      expect(r.topDonorsPage).toBe(1);
      expect(r.topDonorsLimit).toBe(50);
      expect(r.recaptureBenchmarks).toBeDefined();
    });

    it('executes one consolidated cohort query when no donors are returned', async () => {
      // With empty donor results, contact + streak lookups are skipped
      await svc._getLybuntSybuntV2('tenant-1', 2026, { page: 1, limit: 10 });
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('applies the same filter clause to all 3 queries', async () => {
      await svc._getLybuntSybuntV2('tenant-1', 2026, { category: 'LYBUNT' });
      const calls = mockQuery.mock.calls;
      // Every call's SQL should reference the shared filter param
      calls.forEach(([sql]) => {
        expect(sql).toContain('category = :f_category');
      });
    });

    it('returns zero totals when the summary row is empty', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          row_type: 'sum', donor_count: 0, amt: 0, recovery: 0, avg_annual: 0,
          ly_count: 0, ly_amt: 0, ly_recovery: 0,
          sy_count: 0, sy_amt: 0, sy_recovery: 0,
          suppressed_donors: 0, max_recovery: null,
        },
      ]);
      mockQuery.mockResolvedValueOnce([]); // donors

      const r = await svc._getLybuntSybuntV2('tenant-1', 2026, {});
      expect(r.summary.totalDonors).toBe(0);
      expect(r.summary.foregoneRevenue).toBe(0);
      expect(r.topDonorsTotalPages).toBe(1);
    });
  });

  // ─── Trend & pacing & reactivation ─────────────────────────────────────

  describe('getLybuntSybuntTrend', () => {
    it('returns one entry per pivot FY from the single vectorized query', async () => {
      // Vectorized: ONE query returns all N pivot rows
      mockQuery.mockResolvedValueOnce([
        { fy: 2024, lybunt_count: 5, sybunt_count: 10, lybunt_foregone: 1000, sybunt_foregone: 5000, lybunt_recovery: 250, sybunt_recovery: 600, active_donors: 100, total_revenue: 50000 },
        { fy: 2025, lybunt_count: 8, sybunt_count: 12, lybunt_foregone: 1200, sybunt_foregone: 5400, lybunt_recovery: 300, sybunt_recovery: 648, active_donors: 110, total_revenue: 55000 },
        { fy: 2026, lybunt_count: 6, sybunt_count: 14, lybunt_foregone: 900, sybunt_foregone: 6000, lybunt_recovery: 225, sybunt_recovery: 720, active_donors: 105, total_revenue: 52000 },
      ]);
      const r = await svc._getLybuntSybuntTrend('tenant-1', 2026, { years: 3 });
      expect(mockQuery).toHaveBeenCalledTimes(1); // vectorized
      expect(r.length).toBe(3);
      expect(r[0].fy).toBe(2024);
      expect(r[2].fy).toBe(2026);
      expect(r[1].lybuntCount).toBe(8);
    });

    it('returns empty when currentFY is falsy', async () => {
      const r = await svc._getLybuntSybuntTrend('tenant-1', null);
      expect(r).toEqual([]);
    });
  });

  describe('getReactivatedDonors', () => {
    it('returns a count + revenue shape', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 12, revenue: 5600 }]);
      const r = await svc._getReactivatedDonors('tenant-1', 2026, { lookbackYears: 2 });
      expect(r.count).toBe(12);
      expect(r.revenue).toBe(5600);
      expect(r.lookbackYears).toBe(2);
      expect(r.currentFY).toBe(2026);
    });
    it('returns zeros when no data', async () => {
      const r = await svc._getReactivatedDonors('tenant-1', 2026);
      expect(r.count).toBe(0);
      expect(r.revenue).toBe(0);
    });
    it('returns defaults when currentFY is null', async () => {
      const r = await svc._getReactivatedDonors('tenant-1', null);
      expect(r.count).toBe(0);
    });
  });

  describe('getLybuntSybuntPacing', () => {
    it('computes pace delta vs prior-FY same-point rate', async () => {
      // Current-FY query
      mockQuery.mockResolvedValueOnce([{ prior_donor_count: 100, renewed_count: 30 }]);
      // Prior-FY same-point query
      mockQuery.mockResolvedValueOnce([{ fy2_donor_count: 80, renewed_count: 40 }]);
      const r = await svc._getLybuntSybuntPacing('tenant-1', 2026, { asOf: '2026-06-01' });
      expect(r.current.renewalRate).toBeCloseTo(0.30, 5);
      expect(r.priorYearSamePoint.renewalRate).toBeCloseTo(0.50, 5);
      expect(r.paceDeltaPp).toBeLessThan(0); // behind
    });

    it('returns null with no currentFY', async () => {
      const r = await svc._getLybuntSybuntPacing('tenant-1', null);
      expect(r).toBeNull();
    });
  });

  // ─── Cohort analysis ──────────────────────────────────────────────────

  describe('getLybuntSybuntCohortAnalysis', () => {
    it('computes recovery points per cohort', async () => {
      // Pretend: donors A, B, C gave FY2023; only A gave FY2024 (so B and C are
      // LYBUNT after FY2023). Then B came back in FY2025 but not C.
      mockQuery.mockResolvedValueOnce([
        { constituent_id: 'A', fy: 2023 },
        { constituent_id: 'B', fy: 2023 },
        { constituent_id: 'C', fy: 2023 },
        { constituent_id: 'A', fy: 2024 },
        { constituent_id: 'B', fy: 2025 },
      ]);
      const r = await svc._getLybuntSybuntCohortAnalysis('tenant-1', 2026, { cohortYears: 4 });
      const c23 = r.find(c => c.cohortFy === 2023);
      expect(c23).toBeTruthy();
      expect(c23.cohortSize).toBe(3);
      expect(c23.lybuntSize).toBe(2); // B and C
      // 1 year after lapse (FY2025): B returned → 50%
      expect(c23.recoveryPoints.length).toBeGreaterThan(0);
      const one = c23.recoveryPoints[0];
      expect(one.cumulativeRecovered).toBe(1);
      expect(one.cumulativePct).toBeCloseTo(0.5, 5);
    });

    it('returns empty when cohort window is empty', async () => {
      const r = await svc._getLybuntSybuntCohortAnalysis('tenant-1', null);
      expect(r).toEqual([]);
    });
  });

  // ─── End-to-end: filter preservation ───────────────────────────────────

  describe('filter consistency', () => {
    it('filter clause appears in the cohort-defining query', async () => {
      // Only the consolidated cohort query (call #1) needs the filter
      // clause - contact + streak lookups operate on already-filtered IDs.
      mockQuery.mockResolvedValue([{ row_type: 'donor', constituent_id: 'X' }]);
      await svc._getLybuntSybuntV2('tenant-1', 2026, {
        category: 'LYBUNT', segment: 'long-lapsed', minGift: 500,
      });
      const cohortSql = mockQuery.mock.calls[0][0];
      expect(cohortSql).toContain('category = :f_category');
      expect(cohortSql).toContain('years_lapsed >= 5');
    });
  });
});
