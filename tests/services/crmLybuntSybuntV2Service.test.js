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
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([]);
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
      const r = await svc.getLybuntSybuntV2('tenant-1', null);
      expect(r).toBeNull();
    });

    it('returns a properly shaped payload', async () => {
      // 1: summary KPI row
      mockQuery.mockResolvedValueOnce([{
        total_donors: 120,
        foregone_revenue: 250000,
        realistic_recovery: 48000,
        avg_annual_gift: 2083,
        lybunt_donors: 50,
        lybunt_foregone: 80000,
        lybunt_recovery: 20000,
        sybunt_donors: 70,
        sybunt_foregone: 170000,
        sybunt_recovery: 28000,
        suppressed_donors: 5,
        max_priority: 100000,
      }]);
      // 2: bands
      mockQuery.mockResolvedValueOnce([
        { category: 'LYBUNT', band: '$100–$499', band_order: 2, donor_count: 30, band_total: 6000, band_recovery: 1500 },
      ]);
      // 3: top donors
      mockQuery.mockResolvedValueOnce([{
        constituent_id: 'c1',
        donor_name: 'Jane Doe',
        category: 'LYBUNT',
        last_active_fy: 2025,
        last_active_fy_giving: 500,
        lifetime_giving: 3000,
        total_gifts: 4,
        distinct_fy_count: 4,
        max_consecutive_fys: 4,
        years_lapsed: 1,
        recapture_prob: 0.25,
        realistic_recovery: 125,
        suggested_ask: 575,
        priority_score: 74,
      }]);

      const r = await svc.getLybuntSybuntV2('tenant-1', 2026, { page: 1, limit: 50 });

      expect(r).toBeTruthy();
      expect(r.currentFY).toBe(2026);
      expect(r.priorFY).toBe(2025);
      expect(r.summary.totalDonors).toBe(120);
      expect(r.summary.foregoneRevenue).toBe(250000);
      expect(r.summary.realisticRecovery).toBe(48000);
      // SYBUNT-foregone is no longer a blown-up cumulative — it's an annual
      // figure which is always ≤ the donor count × reasonable avg.
      expect(r.summary.sybunt.foregone).toBe(170000);
      expect(r.summary.sybunt.recovery).toBe(28000);
      expect(r.summary.sybunt.recovery).toBeLessThan(r.summary.sybunt.foregone);
      expect(r.summary.lybunt.recovery).toBeLessThan(r.summary.lybunt.foregone);
      expect(r.bands).toHaveLength(1);
      expect(r.bands[0].band_recovery).toBe(1500);
      expect(r.topDonors).toHaveLength(1);
      expect(r.topDonors[0].priority_score).toBe(74);
      expect(r.topDonorsPage).toBe(1);
      expect(r.topDonorsLimit).toBe(50);
      expect(r.recaptureBenchmarks).toBeDefined();
    });

    it('executes three sequelize queries by default (summary, bands, table)', async () => {
      await svc.getLybuntSybuntV2('tenant-1', 2026, { page: 1, limit: 10 });
      expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    it('applies the same filter clause to all 3 queries', async () => {
      await svc.getLybuntSybuntV2('tenant-1', 2026, { category: 'LYBUNT' });
      const calls = mockQuery.mock.calls;
      // Every call's SQL should reference the shared filter param
      calls.forEach(([sql]) => {
        expect(sql).toContain('category = :f_category');
      });
    });

    it('returns zero totals when the summary row is empty', async () => {
      mockQuery.mockResolvedValueOnce([{
        total_donors: 0, foregone_revenue: 0, realistic_recovery: 0,
        avg_annual_gift: 0, lybunt_donors: 0, lybunt_foregone: 0,
        lybunt_recovery: 0, sybunt_donors: 0, sybunt_foregone: 0,
        sybunt_recovery: 0, suppressed_donors: 0, max_priority: null,
      }]);
      mockQuery.mockResolvedValueOnce([]); // bands
      mockQuery.mockResolvedValueOnce([]); // donors

      const r = await svc.getLybuntSybuntV2('tenant-1', 2026, {});
      expect(r.summary.totalDonors).toBe(0);
      expect(r.summary.foregoneRevenue).toBe(0);
      expect(r.topDonorsTotalPages).toBe(1);
    });
  });

  // ─── Trend & pacing & reactivation ─────────────────────────────────────

  describe('getLybuntSybuntTrend', () => {
    it('returns one entry per FY requested, skipping failures gracefully', async () => {
      mockQuery.mockResolvedValue([{
        total: 5, lybunt_count: 2, sybunt_count: 3,
        lybunt_foregone: 100, sybunt_foregone: 300,
        lybunt_recovery: 25, sybunt_recovery: 45,
      }]);
      const r = await svc.getLybuntSybuntTrend('tenant-1', 2026, { years: 3 });
      // For 3 years, 2 queries per year (cohort + active) = 6 queries
      expect(r.length).toBe(3);
      expect(r[0].fy).toBe(2024);
      expect(r[2].fy).toBe(2026);
      r.forEach(row => {
        expect(row.lybuntCount + row.sybuntCount).toBeGreaterThanOrEqual(0);
      });
    });

    it('returns empty when currentFY is falsy', async () => {
      const r = await svc.getLybuntSybuntTrend('tenant-1', null);
      expect(r).toEqual([]);
    });
  });

  describe('getReactivatedDonors', () => {
    it('returns a count + revenue shape', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 12, revenue: 5600 }]);
      const r = await svc.getReactivatedDonors('tenant-1', 2026, { lookbackYears: 2 });
      expect(r.count).toBe(12);
      expect(r.revenue).toBe(5600);
      expect(r.lookbackYears).toBe(2);
      expect(r.currentFY).toBe(2026);
    });
    it('returns zeros when no data', async () => {
      const r = await svc.getReactivatedDonors('tenant-1', 2026);
      expect(r.count).toBe(0);
      expect(r.revenue).toBe(0);
    });
    it('returns defaults when currentFY is null', async () => {
      const r = await svc.getReactivatedDonors('tenant-1', null);
      expect(r.count).toBe(0);
    });
  });

  describe('getLybuntSybuntPacing', () => {
    it('computes pace delta vs prior-FY same-point rate', async () => {
      // Current-FY query
      mockQuery.mockResolvedValueOnce([{ prior_donor_count: 100, renewed_count: 30 }]);
      // Prior-FY same-point query
      mockQuery.mockResolvedValueOnce([{ fy2_donor_count: 80, renewed_count: 40 }]);
      const r = await svc.getLybuntSybuntPacing('tenant-1', 2026, { asOf: '2026-06-01' });
      expect(r.current.renewalRate).toBeCloseTo(0.30, 5);
      expect(r.priorYearSamePoint.renewalRate).toBeCloseTo(0.50, 5);
      expect(r.paceDeltaPp).toBeLessThan(0); // behind
    });

    it('returns null with no currentFY', async () => {
      const r = await svc.getLybuntSybuntPacing('tenant-1', null);
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
      const r = await svc.getLybuntSybuntCohortAnalysis('tenant-1', 2026, { cohortYears: 4 });
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
      const r = await svc.getLybuntSybuntCohortAnalysis('tenant-1', null);
      expect(r).toEqual([]);
    });
  });

  // ─── End-to-end: filter preservation ───────────────────────────────────

  describe('filter consistency', () => {
    it('the same filter clause text appears in every query for a filtered run', async () => {
      mockQuery.mockResolvedValue([{}]);
      await svc.getLybuntSybuntV2('tenant-1', 2026, {
        category: 'LYBUNT', segment: 'long-lapsed', minGift: 500,
      });
      const sqls = mockQuery.mock.calls.map(c => c[0]);
      const filterText = 'category = :f_category';
      sqls.forEach(s => expect(s).toContain(filterText));
      const longLapsedText = 'years_lapsed >= 5';
      sqls.forEach(s => expect(s).toContain(longLapsedText));
    });
  });
});
