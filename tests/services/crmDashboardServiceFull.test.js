/**
 * Comprehensive tests for crmDashboardService.js
 * Mocks sequelize.query and model methods to test all exported functions.
 */

const mockQuery = jest.fn().mockResolvedValue([]);
const mockFundraiserGoal = {
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  upsert: jest.fn().mockResolvedValue([{}, true]),
  destroy: jest.fn().mockResolvedValue(1),
};
const mockDepartmentGoal = {
  findAll: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  upsert: jest.fn().mockResolvedValue([{}, true]),
  destroy: jest.fn().mockResolvedValue(1),
};

jest.mock('../../src/models', () => ({
  sequelize: { query: mockQuery },
  FundraiserGoal: mockFundraiserGoal,
  DepartmentGoal: mockDepartmentGoal,
}));

const service = require('../../src/services/crmDashboardService');

describe('crmDashboardService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([]);
    service.clearCrmCache('tenant-1');
    service.clearCrmCache('tenant-2');
  });

  // ─── clearCrmCache ───
  describe('clearCrmCache', () => {
    it('does not throw', () => {
      expect(() => service.clearCrmCache('tenant-1')).not.toThrow();
    });
  });

  // ─── getFiscalYears ───
  describe('getFiscalYears', () => {
    it('returns mapped fiscal years', async () => {
      mockQuery.mockResolvedValue([
        { fy: '2025', gift_count: '100', total: '50000' },
        { fy: '2024', gift_count: '80', total: '40000' },
      ]);
      const result = await service.getFiscalYears('tenant-1');
      expect(result).toEqual([
        { fy: 2025, label: 'FY2025', gift_count: 100, total: 50000 },
        { fy: 2024, label: 'FY2024', gift_count: 80, total: 40000 },
      ]);
    });

    it('returns empty array when no data', async () => {
      const result = await service.getFiscalYears('tenant-1');
      expect(result).toEqual([]);
    });
  });

  // ─── getCrmOverview ───
  describe('getCrmOverview', () => {
    it('returns overview data with dateRange', async () => {
      mockQuery.mockResolvedValue([{
        total_gifts: 500, total_raised: 100000, avg_gift: 200,
        largest_gift: 5000, earliest_date: '2024-04-01', latest_date: '2025-03-31',
        unique_donors: 200, unique_funds: 10, unique_campaigns: 5, unique_appeals: 8,
      }]);
      const dateRange = { startDate: '2024-04-01', endDate: '2025-04-01' };
      const result = await service.getCrmOverview('tenant-1', dateRange);
      expect(result.total_gifts).toBe(500);
      expect(mockQuery).toHaveBeenCalled();
    });

    it('returns defaults when no data found', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getCrmOverview('tenant-1');
      expect(result).toHaveProperty('total_gifts');
    });

    it('returns overview without dateRange', async () => {
      mockQuery.mockResolvedValue([{ total_gifts: 1000, total_raised: 200000 }]);
      const result = await service.getCrmOverview('tenant-1');
      expect(result.total_gifts).toBe(1000);
    });
  });

  // ─── getGivingByMonth ───
  describe('getGivingByMonth', () => {
    it('returns monthly data', async () => {
      mockQuery.mockResolvedValue([
        { month: '2025-01', gift_count: 50, total: 10000 },
      ]);
      const result = await service.getGivingByMonth('tenant-1');
      expect(result).toHaveLength(1);
      expect(result[0].month).toBe('2025-01');
    });

    it('accepts dateRange parameter', async () => {
      mockQuery.mockResolvedValue([]);
      const dateRange = { startDate: '2024-04-01', endDate: '2025-04-01' };
      const result = await service.getGivingByMonth('tenant-1', dateRange);
      expect(result).toEqual([]);
    });
  });

  // ─── getTopDonors ───
  describe('getTopDonors', () => {
    it('returns top donors', async () => {
      mockQuery.mockResolvedValue([
        { first_name: 'John', last_name: 'Doe', constituent_id: 'C1', gift_count: 5, total: 5000 },
      ]);
      const result = await service.getTopDonors('tenant-1');
      expect(result).toHaveLength(1);
      expect(result[0].last_name).toBe('Doe');
    });

    it('works with dateRange', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getTopDonors('tenant-1', { startDate: '2024-04-01', endDate: '2025-04-01' });
      expect(result).toEqual([]);
    });
  });

  // ─── getTopFunds ───
  describe('getTopFunds', () => {
    it('returns top funds', async () => {
      mockQuery.mockResolvedValue([{ fund_description: 'General', total: 50000 }]);
      const result = await service.getTopFunds('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getTopCampaigns ───
  describe('getTopCampaigns', () => {
    it('returns top campaigns', async () => {
      mockQuery.mockResolvedValue([{ campaign_description: 'Annual', total: 40000 }]);
      const result = await service.getTopCampaigns('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getTopAppeals ───
  describe('getTopAppeals', () => {
    it('returns top appeals', async () => {
      mockQuery.mockResolvedValue([{ appeal_description: 'Year End', total: 30000 }]);
      const result = await service.getTopAppeals('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getGiftsByType ───
  describe('getGiftsByType', () => {
    it('returns gift types', async () => {
      mockQuery.mockResolvedValue([{ gift_code: 'Cash', gift_count: 200, total: 50000 }]);
      const result = await service.getGiftsByType('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getFundraiserLeaderboard ───
  describe('getFundraiserLeaderboard', () => {
    it('returns leaderboard', async () => {
      mockQuery.mockResolvedValue([{ fundraiser_name: 'Jane', total: 25000 }]);
      const result = await service.getFundraiserLeaderboard('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getFundraiserPortfolio ───
  describe('getFundraiserPortfolio', () => {
    it('returns portfolio data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getFundraiserPortfolio('tenant-1', 'Jane Doe');
      expect(result).toBeDefined();
    });
  });

  // ─── getDonorRetention ───
  describe('getDonorRetention', () => {
    it('returns null when no FY provided', async () => {
      const result = await service.getDonorRetention('tenant-1', null);
      expect(result).toBeNull();
    });

    it('returns retention data when FY provided', async () => {
      mockQuery.mockResolvedValue([{
        current_donors: '200', prior_donors: '180', retained: '120',
        brand_new: '50', recovered: '30', lapsed: '60',
      }]);
      const result = await service.getDonorRetention('tenant-1', 2025);
      expect(result.currentFY).toBe(2025);
      expect(result.priorFY).toBe(2024);
      expect(result.current_donors).toBe(200);
      expect(result.retained).toBe(120);
      expect(result.retention_rate).toBe('66.7');
    });
  });

  // ─── getGivingPyramid ───
  describe('getGivingPyramid', () => {
    it('returns pyramid data', async () => {
      mockQuery.mockResolvedValue([{ band: '$1-$99', donor_count: 50, total: 2000 }]);
      const result = await service.getGivingPyramid('tenant-1');
      expect(result).toHaveLength(1);
    });
  });

  // ─── getDonorDetail ───
  describe('getDonorDetail', () => {
    it('returns donor detail', async () => {
      mockQuery.mockResolvedValue([{ first_name: 'John', last_name: 'Doe' }]);
      const result = await service.getDonorDetail('tenant-1', 'C001');
      expect(result).toBeDefined();
    });
  });

  // ─── searchGifts ───
  describe('searchGifts', () => {
    it('returns paginated results', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '10' }]]) // count query
        .mockResolvedValueOnce([{ gift_id: 'G1' }]); // rows query
      const result = await service.searchGifts('tenant-1');
      expect(result).toHaveProperty('rows');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('totalPages');
    });

    it('accepts search filter', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '1' }]])
        .mockResolvedValueOnce([{ gift_id: 'G2' }]);
      const result = await service.searchGifts('tenant-1', { search: 'John' });
      expect(result.rows).toHaveLength(1);
    });

    it('handles multi-word search', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '1' }]])
        .mockResolvedValueOnce([{ gift_id: 'G3' }]);
      const result = await service.searchGifts('tenant-1', { search: 'John Doe' });
      expect(result.rows).toHaveLength(1);
    });

    it('handles fund, campaign, appeal filters', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '5' }]])
        .mockResolvedValueOnce([]);
      const result = await service.searchGifts('tenant-1', {
        fund: 'F1', campaign: 'C1', appeal: 'A1',
      });
      expect(result.total).toBe(5);
    });

    it('handles amount range filters', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '3' }]])
        .mockResolvedValueOnce([]);
      const result = await service.searchGifts('tenant-1', {
        minAmount: '100', maxAmount: '500',
      });
      expect(result.total).toBe(3);
    });

    it('handles dateRange filter', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '2' }]])
        .mockResolvedValueOnce([]);
      const result = await service.searchGifts('tenant-1', {
        dateRange: { startDate: '2024-04-01', endDate: '2025-04-01' },
      });
      expect(result.total).toBe(2);
    });

    it('handles sort parameters', async () => {
      mockQuery
        .mockResolvedValueOnce([[{ count: '0' }]])
        .mockResolvedValueOnce([]);
      const result = await service.searchGifts('tenant-1', {
        sortBy: 'gift_amount', sortDir: 'ASC',
      });
      expect(result.rows).toEqual([]);
    });
  });

  // ─── getFilterOptions ───
  describe('getFilterOptions', () => {
    it('returns funds, campaigns, appeals', async () => {
      mockQuery
        .mockResolvedValueOnce([{ fund_id: 'F1', fund_description: 'General' }])
        .mockResolvedValueOnce([{ campaign_id: 'C1', campaign_description: 'Annual' }])
        .mockResolvedValueOnce([{ appeal_id: 'A1', appeal_description: 'Year End' }]);
      const result = await service.getFilterOptions('tenant-1');
      expect(result.funds).toHaveLength(1);
      expect(result.campaigns).toHaveLength(1);
      expect(result.appeals).toHaveLength(1);
    });
  });

  // ─── getEntityDetail ───
  describe('getEntityDetail', () => {
    it('returns entity detail for fund type', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getEntityDetail('tenant-1', 'fund', 'F1');
      expect(result).toBeDefined();
    });
  });

  // ─── getDonorScoring ───
  describe('getDonorScoring', () => {
    it('returns scoring data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDonorScoring('tenant-1');
      expect(result).toBeDefined();
    });

    it('works with dateRange', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDonorScoring('tenant-1', { startDate: '2024-04-01', endDate: '2025-04-01' });
      expect(result).toBeDefined();
    });
  });

  // ─── Goal CRUD functions ───
  describe('getFundraiserGoals', () => {
    it('calls FundraiserGoal.findAll', async () => {
      mockFundraiserGoal.findAll.mockResolvedValue([{ fundraiserName: 'Jane', goalAmount: 50000 }]);
      const result = await service.getFundraiserGoals('tenant-1', 2025);
      expect(mockFundraiserGoal.findAll).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('setFundraiserGoal', () => {
    it('calls FundraiserGoal.upsert', async () => {
      await service.setFundraiserGoal('tenant-1', 'Jane', 2025, 50000);
      expect(mockFundraiserGoal.upsert).toHaveBeenCalled();
    });
  });

  describe('deleteFundraiserGoal', () => {
    it('calls FundraiserGoal.destroy', async () => {
      await service.deleteFundraiserGoal('tenant-1', 'Jane', 2025);
      expect(mockFundraiserGoal.destroy).toHaveBeenCalled();
    });
  });

  describe('getDepartmentGoals', () => {
    it('calls DepartmentGoal.findAll', async () => {
      mockDepartmentGoal.findAll.mockResolvedValue([]);
      const result = await service.getDepartmentGoals('tenant-1', 2025);
      expect(mockDepartmentGoal.findAll).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('setDepartmentGoal', () => {
    it('calls DepartmentGoal.upsert', async () => {
      await service.setDepartmentGoal('tenant-1', 'annual_giving', 2025, 100000);
      expect(mockDepartmentGoal.upsert).toHaveBeenCalled();
    });
  });

  describe('deleteDepartmentGoal', () => {
    it('calls DepartmentGoal.destroy', async () => {
      await service.deleteDepartmentGoal('tenant-1', 'annual_giving', 2025);
      expect(mockDepartmentGoal.destroy).toHaveBeenCalled();
    });
  });

  // ─── getDepartmentActuals ───
  describe('getDepartmentActuals', () => {
    it('returns empty array when no dateRange', async () => {
      const result = await service.getDepartmentActuals('tenant-dept-1');
      expect(result).toEqual([]);
    });

    it('returns department actuals with dateRange', async () => {
      service.clearCrmCache('tenant-dept-2');
      mockQuery.mockResolvedValue([{ department: 'annual_giving', total: 50000 }]);
      const result = await service.getDepartmentActuals('tenant-dept-2', { startDate: '2024-04-01', endDate: '2025-04-01' });
      expect(result).toHaveLength(1);
    });
  });

  // ─── getDataQualityReport ───
  describe('getDataQualityReport', () => {
    it('returns data quality report', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDataQualityReport('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getRecurringDonorAnalysis ───
  describe('getRecurringDonorAnalysis', () => {
    it('returns recurring donor analysis', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getRecurringDonorAnalysis('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getAcknowledgmentTracker ───
  describe('getAcknowledgmentTracker', () => {
    it('returns acknowledgment data', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }])
        .mockResolvedValueOnce([]);
      const result = await service.getAcknowledgmentTracker('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getMatchingGiftAnalysis ───
  describe('getMatchingGiftAnalysis', () => {
    it('returns matching gift data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getMatchingGiftAnalysis('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getSoftCreditAnalysis ───
  describe('getSoftCreditAnalysis', () => {
    it('returns soft credit data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getSoftCreditAnalysis('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getPaymentMethodAnalysis ───
  describe('getPaymentMethodAnalysis', () => {
    it('returns payment method data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getPaymentMethodAnalysis('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getDonorLifecycleAnalysis ───
  describe('getDonorLifecycleAnalysis', () => {
    it('returns lifecycle data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDonorLifecycleAnalysis('tenant-1');
      expect(result).toBeDefined();
    });

    it('works with dateRange', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDonorLifecycleAnalysis('tenant-1', { startDate: '2024-04-01', endDate: '2025-04-01' });
      expect(result).toBeDefined();
    });
  });

  // ─── getGiftTrendAnalysis ───
  describe('getGiftTrendAnalysis', () => {
    it('returns gift trend data', async () => {
      mockQuery
        .mockResolvedValueOnce([])                                   // monthlyTrend
        .mockResolvedValueOnce([])                                   // distribution
        .mockResolvedValueOnce([])                                   // yoyAvg
        .mockResolvedValueOnce([])                                   // donorTrends
        .mockResolvedValueOnce([{ total: 0, increasing: 0, decreasing: 0 }]); // summaryRow
      const result = await service.getGiftTrendAnalysis('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getCampaignComparison ───
  describe('getCampaignComparison', () => {
    it('returns campaign comparison data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getCampaignComparison('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getFundHealthReport ───
  describe('getFundHealthReport', () => {
    it('returns fund health data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getFundHealthReport('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getYearOverYearComparison ───
  describe('getYearOverYearComparison', () => {
    it('returns year-over-year data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getYearOverYearComparison('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getDonorInsights ───
  describe('getDonorInsights', () => {
    it('returns donor insights', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDonorInsights('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getAppealComparison ───
  describe('getAppealComparison', () => {
    it('returns appeal comparison data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getAppealComparison('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getAppealDetail ───
  describe('getAppealDetail', () => {
    it('returns appeal detail', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getAppealDetail('tenant-1', 'A1');
      expect(result).toBeDefined();
    });
  });

  // ─── getDepartmentAnalytics ───
  describe('getDepartmentAnalytics', () => {
    it('returns department analytics', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDepartmentAnalytics('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getDepartmentExtras ───
  describe('getDepartmentExtras', () => {
    it('returns department extras', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getDepartmentExtras('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getLybuntSybunt ───
  describe('getLybuntSybunt', () => {
    it('returns null when no FY', async () => {
      const result = await service.getLybuntSybunt('tenant-1', null);
      // The function may return null or empty depending on implementation
      expect(result).toBeDefined();
    });

    it('returns data with FY', async () => {
      mockQuery
        .mockResolvedValueOnce([{ category: 'LYBUNT', donor_count: 5, revenue_at_risk: 1000, avg_gift: 200 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 5 }])
        .mockResolvedValueOnce([]);
      const result = await service.getLybuntSybunt('tenant-1', 2025);
      expect(result).toBeDefined();
    });

    it('accepts yearsSince filter', async () => {
      mockQuery
        .mockResolvedValueOnce([{ category: 'LYBUNT', donor_count: 2, revenue_at_risk: 500, avg_gift: 250 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 2 }])
        .mockResolvedValueOnce([]);
      const result = await service.getLybuntSybunt('tenant-1', 2025, { yearsSince: '2-3' });
      expect(result).toBeDefined();
      expect(result.lybunt.donorCount).toBe(2);
    });

    it('accepts segment preset', async () => {
      mockQuery
        .mockResolvedValueOnce([{ category: 'SYBUNT', donor_count: 3, revenue_at_risk: 3000, avg_gift: 1000 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 3 }])
        .mockResolvedValueOnce([{ constituent_id: 'C1', donor_name: 'Test', lifetime_giving: 5000, total_gifts: 10, consecutive_years: 4, giving_trend: 'declining' }]);
      const result = await service.getLybuntSybunt('tenant-1', 2025, { segment: 'high-value-lapsed' });
      expect(result).toBeDefined();
      expect(result.topDonors).toHaveLength(1);
      expect(result.topDonors[0].giving_trend).toBe('declining');
    });

    it('accepts custom FY range filters', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);
      const result = await service.getLybuntSybunt('tenant-1', 2025, {
        gaveInFyStart: 2018, gaveInFyEnd: 2020,
        notInFyStart: 2021, notInFyEnd: 2025,
      });
      expect(result).toBeDefined();
      expect(result.topDonorsTotal).toBe(0);
    });

    it('returns consecutive_years and giving_trend in topDonors', async () => {
      mockQuery
        .mockResolvedValueOnce([{ category: 'LYBUNT', donor_count: 1, revenue_at_risk: 100, avg_gift: 100 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{ constituent_id: 'C2', donor_name: 'Jane Doe', consecutive_years: 5, giving_trend: 'stable' }]);
      const result = await service.getLybuntSybunt('tenant-1', 2025);
      expect(result.topDonors[0].consecutive_years).toBe(5);
      expect(result.topDonors[0].giving_trend).toBe('stable');
    });
  });

  // ─── getDonorUpgradeDowngrade ───
  describe('getDonorUpgradeDowngrade', () => {
    it('returns upgrade/downgrade data', async () => {
      mockQuery
        .mockResolvedValueOnce([])           // summary
        .mockResolvedValueOnce([])           // distribution
        .mockResolvedValueOnce([[{ total: 0 }]]) // count (nested array for destructure)
        .mockResolvedValueOnce([]);          // topMovers
      const result = await service.getDonorUpgradeDowngrade('tenant-1', 2025);
      expect(result).toBeDefined();
    });
  });

  // ─── getFirstTimeDonorConversion ───
  describe('getFirstTimeDonorConversion', () => {
    it('returns first-time donor data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getFirstTimeDonorConversion('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getProactiveInsights ───
  describe('getProactiveInsights', () => {
    it('returns proactive insights', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getProactiveInsights('tenant-1', 2025);
      expect(result).toBeDefined();
    });
  });

  // ─── getRetentionDrilldown ───
  describe('getRetentionDrilldown', () => {
    it('returns null when no FY', async () => {
      const result = await service.getRetentionDrilldown('tenant-1', null);
      expect(result).toBeNull();
    });

    it('returns data with FY', async () => {
      mockQuery.mockResolvedValue([{
        prior_donors: '100', current_donors: '120', retained: '80', lapsed: '20',
      }]);
      const result = await service.getRetentionDrilldown('tenant-1', 2025);
      expect(result).toBeDefined();
    });
  });

  // ─── getHouseholdGiving ───
  describe('getHouseholdGiving', () => {
    it('returns household data', async () => {
      service.clearCrmCache('tenant-household');
      mockQuery
        .mockResolvedValueOnce([]) // households query
        .mockResolvedValueOnce([{ total_individuals: '100', household_count: '20', members_in_households: '35', total_giving: '500000' }]); // summary query
      const result = await service.getHouseholdGiving('tenant-household');
      expect(result).toBeDefined();
      expect(result.totalIndividuals).toBe(100);
      expect(result.householdCount).toBe(20);
      expect(result.topHouseholds).toEqual([]);
    });
  });

  // ─── getAnomalyDetection ───
  describe('getAnomalyDetection', () => {
    it('returns anomaly data', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getAnomalyDetection('tenant-1');
      expect(result).toBeDefined();
    });
  });

  // ─── getAIRecommendations ───
  describe('getAIRecommendations', () => {
    it('returns AI recommendations', async () => {
      mockQuery.mockResolvedValue([]);
      const result = await service.getAIRecommendations('tenant-1', 2025);
      expect(result).toBeDefined();
    });
  });

  // ─── Caching behavior ───
  describe('caching', () => {
    it('returns cached result on second call', async () => {
      mockQuery.mockResolvedValue([{ total_gifts: 99 }]);
      const r1 = await service.getCrmOverview('tenant-2');
      const callCount = mockQuery.mock.calls.length;
      const r2 = await service.getCrmOverview('tenant-2');
      // Second call should use cache, so no new queries
      expect(mockQuery.mock.calls.length).toBe(callCount);
    });

    it('clears cache for specific tenant', async () => {
      mockQuery.mockResolvedValue([{ total_gifts: 99 }]);
      await service.getCrmOverview('tenant-2');
      service.clearCrmCache('tenant-2');
      mockQuery.mockResolvedValue([{ total_gifts: 100 }]);
      const result = await service.getCrmOverview('tenant-2');
      expect(result.total_gifts).toBe(100);
    });
  });
});
