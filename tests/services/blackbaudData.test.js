jest.mock('../../src/services/blackbaudClient', () => ({
  apiRequest: jest.fn().mockResolvedValue({ value: [], count: 0 }),
  apiRequestAll: jest.fn().mockResolvedValue([]),
}));

const blackbaud = require('../../src/services/blackbaudClient');
const {
  getLiveDashboardData,
  getRecentGifts,
  computeGiftSummary,
  getConstituentSummary,
  getCampaigns,
  clearDashboardCache,
} = require('../../src/services/blackbaudData');

describe('blackbaudData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearDashboardCache('tenant-1');
  });

  describe('computeGiftSummary', () => {
    it('returns zeros for empty array', () => {
      const result = computeGiftSummary([]);
      expect(result.totalAmount).toBe(0);
      expect(result.giftCount).toBe(0);
      expect(result.averageGift).toBe(0);
      expect(result.largestGift).toBe(0);
    });

    it('computes totals for gifts', () => {
      const gifts = [
        { amount: { value: 100 }, date: '2025-01-15', lookup_id: 'D001' },
        { amount: { value: 250 }, date: '2025-01-15', lookup_id: 'D002' },
        { amount: { value: 50 }, date: '2025-02-01', lookup_id: 'D003' },
      ];
      const result = computeGiftSummary(gifts);
      expect(result.totalAmount).toBe(400);
      expect(result.giftCount).toBe(3);
      expect(result.averageGift).toBeCloseTo(133.33, 1);
      expect(result.largestGift).toBe(250);
      expect(result.largestGiftDonor).toBe('D002');
    });

    it('groups gifts by day', () => {
      const gifts = [
        { amount: { value: 100 }, date: '2025-01-15T00:00:00Z' },
        { amount: { value: 200 }, date: '2025-01-15T12:00:00Z' },
        { amount: { value: 50 }, date: '2025-01-16T00:00:00Z' },
      ];
      const result = computeGiftSummary(gifts);
      expect(result.giftsByDay['2025-01-15']).toBe(300);
      expect(result.giftsByDay['2025-01-16']).toBe(50);
    });

    it('groups gifts by fund when fund map provided', () => {
      const gifts = [
        { amount: { value: 100 }, gift_splits: [{ fund_id: 'F1' }] },
        { amount: { value: 200 }, gift_splits: [{ fund_id: 'F1' }] },
        { amount: { value: 50 }, gift_splits: [{ fund_id: 'F2' }] },
      ];
      const fundMap = { F1: 'General Fund', F2: 'Annual Fund' };
      const result = computeGiftSummary(gifts, fundMap);
      expect(result.giftsByFund['General Fund']).toEqual({ count: 2, total: 300 });
      expect(result.giftsByFund['Annual Fund']).toEqual({ count: 1, total: 50 });
    });

    it('handles gifts without amount', () => {
      const gifts = [{ lookup_id: 'D001' }];
      const result = computeGiftSummary(gifts);
      expect(result.totalAmount).toBe(0);
      expect(result.giftCount).toBe(1);
    });

    it('handles gifts without fund splits', () => {
      const gifts = [{ amount: { value: 100 } }];
      const result = computeGiftSummary(gifts);
      expect(Object.keys(result.giftsByFund)).toHaveLength(0);
    });
  });

  describe('getConstituentSummary', () => {
    it('returns total constituents count', async () => {
      blackbaud.apiRequest.mockResolvedValue({ count: 500 });
      const result = await getConstituentSummary('tenant-1');
      expect(result.totalConstituents).toBe(500);
    });

    it('returns 0 on error', async () => {
      blackbaud.apiRequest.mockRejectedValue(new Error('API down'));
      const result = await getConstituentSummary('tenant-1');
      expect(result.totalConstituents).toBe(0);
      expect(result.error).toBeDefined();
    });
  });

  describe('getCampaigns', () => {
    it('returns campaigns list filtering inactive', async () => {
      blackbaud.apiRequest.mockResolvedValue({
        value: [
          { id: 1, description: 'Annual', lookup_id: 'A1', inactive: false },
          { id: 2, description: 'Old', lookup_id: 'O1', inactive: true },
        ],
      });
      const result = await getCampaigns('tenant-1');
      expect(result.totalCampaigns).toBe(2);
      expect(result.activeCampaigns).toBe(1);
      expect(result.campaigns).toHaveLength(1);
      expect(result.campaigns[0].description).toBe('Annual');
    });

    it('returns empty on error', async () => {
      blackbaud.apiRequest.mockRejectedValue(new Error('API error'));
      const result = await getCampaigns('tenant-1');
      expect(result.campaigns).toEqual([]);
      expect(result.error).toBeDefined();
    });
  });

  describe('getRecentGifts', () => {
    it('returns sorted gifts', async () => {
      blackbaud.apiRequestAll.mockResolvedValue([]);
      blackbaud.apiRequest.mockResolvedValue({ value: [] });
      const result = await getRecentGifts('tenant-1');
      expect(result).toHaveProperty('gifts');
      expect(result).toHaveProperty('count');
    });

    it('handles errors gracefully', async () => {
      blackbaud.apiRequestAll.mockRejectedValue(new Error('Network error'));
      const result = await getRecentGifts('tenant-1');
      expect(result.gifts).toEqual([]);
      expect(result.count).toBe(0);
    });
  });

  describe('clearDashboardCache', () => {
    it('does not throw', () => {
      expect(() => clearDashboardCache('tenant-1')).not.toThrow();
    });
  });
});
