// Mock the Sequelize entry point BEFORE requiring the service so its own
// require('../models') gets our stub.
jest.mock('../../src/models', () => ({
  sequelize: {
    query: jest.fn(),
  },
}));

const { sequelize } = require('../../src/models');
const {
  searchDonors,
  getDonorProfile,
  _internals,
} = require('../../src/services/donorContext');

describe('donorContext._internals', () => {
  describe('formatMoney', () => {
    it('rounds and group-separates dollars in Canadian locale', () => {
      expect(_internals.formatMoney(12345.67)).toBe('$12,346');
      expect(_internals.formatMoney(0)).toBe('$0');
    });

    it('handles invalid input gracefully', () => {
      expect(_internals.formatMoney(null)).toBe('$0');
      expect(_internals.formatMoney('not-a-number')).toBe('$0');
    });
  });

  describe('formatDate', () => {
    it('truncates ISO strings to YYYY-MM-DD', () => {
      expect(_internals.formatDate('2024-06-15T00:00:00.000Z')).toBe('2024-06-15');
    });

    it('handles Date objects', () => {
      expect(_internals.formatDate(new Date('2024-06-15T00:00:00.000Z'))).toBe('2024-06-15');
    });

    it('returns empty string for null/undefined', () => {
      expect(_internals.formatDate(null)).toBe('');
      expect(_internals.formatDate(undefined)).toBe('');
    });
  });

  describe('buildDisplayName', () => {
    it('prefers first + last when present', () => {
      expect(_internals.buildDisplayName({ first_name: 'Margaret', last_name: 'Thompson' }))
        .toBe('Margaret Thompson');
    });

    it('uses just one name field if the other is missing', () => {
      expect(_internals.buildDisplayName({ first_name: 'Margaret', last_name: null }))
        .toBe('Margaret');
    });

    it('falls back to constituent_name, then constituent_id', () => {
      expect(_internals.buildDisplayName({ constituent_name: 'Maple Corp', constituent_id: 'c-1' }))
        .toBe('Maple Corp');
      expect(_internals.buildDisplayName({ constituent_id: 'c-42' }))
        .toBe('c-42');
    });
  });

  describe('collectTopFunds', () => {
    it('ranks funds by total amount and caps to the limit', () => {
      const gifts = [
        { fund: 'Cancer Care', amount: 500 },
        { fund: 'Cardiac Care', amount: 2500 },
        { fund: 'Cancer Care', amount: 1000 },
        { fund: 'Research', amount: 200 },
        { fund: null, amount: 99 },
      ];
      expect(_internals.collectTopFunds(gifts, 2)).toEqual(['Cardiac Care', 'Cancer Care']);
    });
  });

  describe('buildContextString', () => {
    it('produces a compact markdown block with the key facts', () => {
      const donor = {
        constituentId: 'TH-123',
        firstName: 'Margaret',
        lastName: 'Thompson',
        displayName: 'Margaret Thompson',
        primaryAddressee: null,
        constituentType: 'Individual',
        totalGifts: 4,
        totalGiven: 12500,
        largestGift: 5000,
        firstGiftDate: '2019-03-14',
        lastGiftDate: '2024-12-10',
        uniqueFunds: 2,
      };
      const gifts = [
        { date: '2024-12-10', amount: 5000, fund: 'Cardiac Care' },
        { date: '2023-11-02', amount: 2500, fund: 'Cardiac Care' },
      ];
      const str = _internals.buildContextString(donor, gifts, ['Cardiac Care']);
      expect(str).toContain('Margaret Thompson');
      expect(str).toContain('TH-123');
      expect(str).toContain('Supporter since: 2019-03-14');
      expect(str).toContain('Lifetime giving: $12,500 across 4 gifts');
      expect(str).toContain('largest $5,000');
      expect(str).toContain('Primary interests: Cardiac Care');
      expect(str).toContain('$5,000 to Cardiac Care on 2024-12-10');
    });

    it('omits missing sections cleanly', () => {
      const donor = {
        constituentId: 'X-1',
        firstName: null, lastName: null, displayName: 'X-1',
        primaryAddressee: null, constituentType: null,
        totalGifts: 0, totalGiven: 0, largestGift: 0,
        firstGiftDate: null, lastGiftDate: null, uniqueFunds: 0,
      };
      const str = _internals.buildContextString(donor, [], []);
      expect(str).not.toContain('Lifetime giving');
      expect(str).not.toContain('Recent gifts');
      expect(str).not.toContain('Primary interests');
    });
  });
});

describe('searchDonors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns [] for queries shorter than the minimum length', async () => {
    const result = await searchDonors(7, 'a');
    expect(result).toEqual([]);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('returns [] for empty/whitespace queries', async () => {
    expect(await searchDonors(7, '')).toEqual([]);
    expect(await searchDonors(7, '   ')).toEqual([]);
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('runs a multi-word pair match for "Margaret Thompson"', async () => {
    sequelize.query.mockResolvedValue([
      {
        constituent_id: 'TH-1',
        first_name: 'Margaret',
        last_name: 'Thompson',
        constituent_name: 'Margaret Thompson',
        constituent_type: 'Individual',
        total_gifts: '4',
        total_given: '12500',
        last_gift_date: '2024-12-10',
        last_gift_amount: '5000',
      },
    ]);

    const results = await searchDonors(7, 'Margaret Thompson');

    const call = sequelize.query.mock.calls[0];
    expect(call[0]).toContain('first_name ILIKE :searchFirst');
    expect(call[0]).toContain('last_name ILIKE :searchLast');
    expect(call[1].replacements.searchFirst).toBe('%Margaret%');
    expect(call[1].replacements.searchLast).toBe('%Thompson%');
    expect(call[1].replacements.tenantId).toBe(7);
    expect(results).toEqual([
      expect.objectContaining({
        constituentId: 'TH-1',
        displayName: 'Margaret Thompson',
        totalGifts: 4,
        totalGiven: 12500,
        lastGiftAmount: 5000,
      }),
    ]);
  });

  it('runs a single-term match for one-word queries', async () => {
    sequelize.query.mockResolvedValue([]);
    await searchDonors(7, 'Thompson');
    const call = sequelize.query.mock.calls[0];
    expect(call[0]).not.toContain(':searchFirst');
    expect(call[1].replacements.search).toBe('%Thompson%');
  });

  it('clamps the limit to the max', async () => {
    sequelize.query.mockResolvedValue([]);
    await searchDonors(7, 'Thompson', { limit: 9999 });
    expect(sequelize.query.mock.calls[0][1].replacements.limit).toBe(25);
  });

  it('uses the default limit when none supplied', async () => {
    sequelize.query.mockResolvedValue([]);
    await searchDonors(7, 'Thompson');
    expect(sequelize.query.mock.calls[0][1].replacements.limit).toBe(10);
  });
});

describe('getDonorProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null for missing constituent ID', async () => {
    expect(await getDonorProfile(7, null)).toBeNull();
    expect(await getDonorProfile(7, '')).toBeNull();
    expect(sequelize.query).not.toHaveBeenCalled();
  });

  it('returns null when the donor is not found', async () => {
    // summary query returns empty, gifts query returns empty
    sequelize.query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await getDonorProfile(7, 'TH-missing')).toBeNull();
  });

  it('assembles profile + contextString + uiPrefill on a hit', async () => {
    sequelize.query
      .mockResolvedValueOnce([
        {
          constituent_id: 'TH-1',
          first_name: 'Margaret',
          last_name: 'Thompson',
          constituent_name: 'Margaret Thompson',
          primary_addressee: 'Ms. Margaret Thompson',
          constituent_type: 'Individual',
          total_gifts: '4',
          total_given: '12500',
          avg_gift: '3125',
          largest_gift: '5000',
          first_gift_date: '2019-03-14',
          last_gift_date: '2024-12-10',
          unique_funds: '2',
        },
      ])
      .mockResolvedValueOnce([
        {
          gift_id: 'g-1', gift_date: '2024-12-10', gift_amount: '5000',
          fund_description: 'Cardiac Care', campaign_description: null, appeal_description: null,
        },
        {
          gift_id: 'g-2', gift_date: '2023-11-02', gift_amount: '2500',
          fund_description: 'Cardiac Care', campaign_description: null, appeal_description: null,
        },
      ]);

    const profile = await getDonorProfile(7, 'TH-1');

    expect(profile.donor.displayName).toBe('Margaret Thompson');
    expect(profile.donor.totalGiven).toBe(12500);
    expect(profile.mostRecentGift.amount).toBe(5000);
    expect(profile.mostRecentGift.fund).toBe('Cardiac Care');
    expect(profile.topFunds).toEqual(['Cardiac Care']);

    expect(profile.contextString).toContain('Margaret Thompson');
    expect(profile.contextString).toContain('Lifetime giving: $12,500');

    expect(profile.uiPrefill).toEqual({
      donorName: 'Ms. Margaret Thompson',   // primary addressee wins when present
      giftAmount: 5000,                      // most-recent gift
      designation: 'Cardiac Care',           // its fund
    });
  });

  it('falls back to display name when no primary addressee is stored', async () => {
    sequelize.query
      .mockResolvedValueOnce([
        {
          constituent_id: 'TH-2',
          first_name: 'Robert',
          last_name: 'Singh',
          constituent_name: null,
          primary_addressee: null,
          constituent_type: 'Individual',
          total_gifts: '1',
          total_given: '100',
          avg_gift: '100',
          largest_gift: '100',
          first_gift_date: '2024-01-01',
          last_gift_date: '2024-01-01',
          unique_funds: '1',
        },
      ])
      .mockResolvedValueOnce([
        { gift_id: 'g-3', gift_date: '2024-01-01', gift_amount: '100', fund_description: null, campaign_description: null, appeal_description: null },
      ]);

    const profile = await getDonorProfile(7, 'TH-2');
    expect(profile.uiPrefill.donorName).toBe('Robert Singh');
    expect(profile.uiPrefill.designation).toBeNull();
  });
});
