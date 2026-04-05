/**
 * Tests for crmDepartmentClassifier.js - classifyDepartment function
 *
 * The classifier uses a 5-tier priority heuristic:
 *   1. appeal_category / fund_category
 *   2. gift_code
 *   3. appeal_description + campaign_description
 *   4. fund_description
 *   5. gift_amount threshold (>= $10K)
 *   Default: Annual Giving
 */

// Mock sequelize to avoid DB connection at require time
jest.mock('../../src/models', () => ({
  sequelize: { query: jest.fn() },
}));

const { classifyDepartment } = require('../../src/services/crmDepartmentClassifier');

// ---------------------------------------------------------------------------
// Tier 1: Legacy Giving via category fields
// ---------------------------------------------------------------------------

describe('Legacy Giving classification', () => {
  it('classifies appealCategory "Legacy Giving"', () => {
    expect(classifyDepartment({ appealCategory: 'Legacy Giving' })).toBe('Legacy Giving');
  });

  it('classifies fundCategory "Planned Gifts"', () => {
    expect(classifyDepartment({ fundCategory: 'Planned Gifts' })).toBe('Legacy Giving');
  });

  it('classifies appealDescription containing "Bequest"', () => {
    expect(classifyDepartment({ appealDescription: 'Annual Bequest Campaign' })).toBe('Legacy Giving');
  });

  it('classifies fundCategory "Endowment"', () => {
    expect(classifyDepartment({ fundCategory: 'Endowment Fund' })).toBe('Legacy Giving');
  });

  it('classifies giftCode with "estate"', () => {
    expect(classifyDepartment({ giftCode: 'Estate-2025' })).toBe('Legacy Giving');
  });

  it('classifies fundDescription with "Endowment"', () => {
    expect(classifyDepartment({ fundDescription: 'General Endowment' })).toBe('Legacy Giving');
  });

  it('classifies appealCategory with "Bequest"', () => {
    expect(classifyDepartment({ appealCategory: 'Bequest Program' })).toBe('Legacy Giving');
  });

  it('classifies via campaignDescription with "planned gift"', () => {
    expect(classifyDepartment({ campaignDescription: 'Planned Gift Initiative' })).toBe('Legacy Giving');
  });
});

// ---------------------------------------------------------------------------
// Tier 1: Events classification
// ---------------------------------------------------------------------------

describe('Events classification', () => {
  it('classifies appealCategory "Special Events"', () => {
    expect(classifyDepartment({ appealCategory: 'Special Events' })).toBe('Events');
  });

  it('classifies campaignDescription with "Gala"', () => {
    expect(classifyDepartment({ campaignDescription: 'Annual Gala 2025' })).toBe('Events');
  });

  it('classifies fundDescription with "Golf Tournament"', () => {
    expect(classifyDepartment({ fundDescription: 'Golf Tournament Fund' })).toBe('Events');
  });

  it('classifies fundCategory with "Event"', () => {
    expect(classifyDepartment({ fundCategory: 'Event Sponsorship' })).toBe('Events');
  });

  it('classifies appealDescription with "Auction"', () => {
    expect(classifyDepartment({ appealDescription: 'Silent Auction Night' })).toBe('Events');
  });

  it('classifies giftCode with "ticket"', () => {
    expect(classifyDepartment({ giftCode: 'ticket-gala-2025' })).toBe('Events');
  });

  it('classifies appealCategory with "Dinner"', () => {
    expect(classifyDepartment({ appealCategory: 'Annual Dinner' })).toBe('Events');
  });

  it('classifies campaignDescription with "Luncheon"', () => {
    expect(classifyDepartment({ campaignDescription: 'Spring Luncheon' })).toBe('Events');
  });
});

// ---------------------------------------------------------------------------
// Major Gifts classification
// ---------------------------------------------------------------------------

describe('Major Gifts classification', () => {
  it('classifies appealCategory "Major Gifts"', () => {
    expect(classifyDepartment({ appealCategory: 'Major Gifts' })).toBe('Major Gifts');
  });

  it('classifies by gift amount >= 10000', () => {
    expect(classifyDepartment({ giftAmount: 15000 })).toBe('Major Gifts');
  });

  it('classifies by gift amount exactly 10000', () => {
    expect(classifyDepartment({ giftAmount: 10000 })).toBe('Major Gifts');
  });

  it('does not classify as Major Gifts for amount just below threshold', () => {
    expect(classifyDepartment({ giftAmount: 9999 })).toBe('Annual Giving');
  });

  it('classifies fundDescription "Capital Campaign"', () => {
    expect(classifyDepartment({ fundDescription: 'Capital Campaign' })).toBe('Major Gifts');
  });

  it('classifies appealCategory "Leadership Giving"', () => {
    expect(classifyDepartment({ appealCategory: 'Leadership Giving' })).toBe('Major Gifts');
  });

  it('classifies fundCategory with "Capital"', () => {
    expect(classifyDepartment({ fundCategory: 'Capital Projects' })).toBe('Major Gifts');
  });

  it('classifies campaignDescription with "Transform"', () => {
    expect(classifyDepartment({ campaignDescription: 'Transform the Future' })).toBe('Major Gifts');
  });

  it('classifies giftCode with "major gift"', () => {
    expect(classifyDepartment({ giftCode: 'major-gift-2025' })).toBe('Major Gifts');
  });

  it('classifies fundDescription with "Building"', () => {
    expect(classifyDepartment({ fundDescription: 'New Building Fund' })).toBe('Major Gifts');
  });
});

// ---------------------------------------------------------------------------
// Direct Mail classification
// ---------------------------------------------------------------------------

describe('Direct Mail classification', () => {
  it('classifies appealCategory "Direct Mail"', () => {
    expect(classifyDepartment({ appealCategory: 'Direct Mail' })).toBe('Direct Mail');
  });

  it('classifies appealCategory containing "Solicitation"', () => {
    expect(classifyDepartment({ appealCategory: 'Spring Solicitation' })).toBe('Direct Mail');
  });

  it('classifies appealDescription with "mailing"', () => {
    expect(classifyDepartment({ appealDescription: 'Fall Mailing Campaign' })).toBe('Direct Mail');
  });

  it('classifies appealDescription containing "DM" followed by digits', () => {
    expect(classifyDepartment({ appealDescription: 'DM3 Spring' })).toBe('Direct Mail');
  });

  it('classifies appealDescription with "newsletter"', () => {
    expect(classifyDepartment({ appealDescription: 'Monthly Newsletter' })).toBe('Direct Mail');
  });

  it('classifies giftCode with "DM-2025-Spring" via description tier (not code tier)', () => {
    // gift_code does not have a Direct Mail tier, so DM in code does not match.
    // But appealDescription or campaignDescription with mail patterns would.
    // DM-2025-Spring does not match code-level patterns, falls to default.
    const result = classifyDepartment({ giftCode: 'DM-2025-Spring' });
    // The gift_code tier has no MAIL pattern, so it won't match there.
    // It falls through to Annual Giving default.
    expect(result).toBe('Annual Giving');
  });

  it('classifies appealDescription with "postal"', () => {
    expect(classifyDepartment({ appealDescription: 'Postal Appeal' })).toBe('Direct Mail');
  });
});

// ---------------------------------------------------------------------------
// Annual Giving (default and explicit)
// ---------------------------------------------------------------------------

describe('Annual Giving classification', () => {
  it('classifies appealCategory "Annual Fund"', () => {
    expect(classifyDepartment({ appealCategory: 'Annual Fund' })).toBe('Annual Giving');
  });

  it('defaults to Annual Giving for empty row', () => {
    expect(classifyDepartment({})).toBe('Annual Giving');
  });

  it('defaults to Annual Giving when no signals match', () => {
    expect(classifyDepartment({ giftAmount: 50, fundDescription: 'General' })).toBe('Annual Giving');
  });

  it('classifies appealCategory with "Phonathon"', () => {
    expect(classifyDepartment({ appealCategory: 'Phonathon Drive' })).toBe('Annual Giving');
  });

  it('classifies appealDescription with "Giving Day"', () => {
    expect(classifyDepartment({ appealDescription: 'Giving Day 2025' })).toBe('Annual Giving');
  });

  it('classifies campaignDescription with "Year End"', () => {
    expect(classifyDepartment({ campaignDescription: 'Year End Appeal' })).toBe('Annual Giving');
  });

  it('classifies appealCategory with "Unrestricted"', () => {
    expect(classifyDepartment({ appealCategory: 'Unrestricted Giving' })).toBe('Annual Giving');
  });
});

// ---------------------------------------------------------------------------
// Priority / conflict resolution
// ---------------------------------------------------------------------------

describe('Priority resolution', () => {
  it('category (tier 1) beats description (tier 3)', () => {
    // appealCategory says Legacy, description says Events
    expect(classifyDepartment({
      appealCategory: 'Legacy Program',
      appealDescription: 'Gala Night',
    })).toBe('Legacy Giving');
  });

  it('category (tier 1) beats amount (tier 5)', () => {
    // appealCategory says Events, but amount >= 10K
    expect(classifyDepartment({
      appealCategory: 'Special Events',
      giftAmount: 50000,
    })).toBe('Events');
  });

  it('gift code (tier 2) beats description (tier 3)', () => {
    expect(classifyDepartment({
      giftCode: 'estate-trust-001',
      appealDescription: 'Annual Gala',
    })).toBe('Legacy Giving');
  });

  it('description (tier 3) beats fund description (tier 4)', () => {
    expect(classifyDepartment({
      appealDescription: 'Annual Gala Dinner',
      fundDescription: 'Capital Campaign',
    })).toBe('Events');
  });

  it('fund description (tier 4) beats amount (tier 5)', () => {
    expect(classifyDepartment({
      fundDescription: 'General Endowment',
      giftAmount: 50000,
    })).toBe('Legacy Giving');
  });

  it('amount threshold (tier 5) overrides default', () => {
    expect(classifyDepartment({
      giftAmount: 25000,
    })).toBe('Major Gifts');
  });

  it('Events in category beats Major in fund description', () => {
    expect(classifyDepartment({
      appealCategory: 'Benefit Gala',
      fundDescription: 'Capital Campaign',
    })).toBe('Events');
  });
});

// ---------------------------------------------------------------------------
// snake_case field name support
// ---------------------------------------------------------------------------

describe('snake_case field names', () => {
  it('accepts appeal_category', () => {
    expect(classifyDepartment({ appeal_category: 'Legacy Program' })).toBe('Legacy Giving');
  });

  it('accepts fund_category', () => {
    expect(classifyDepartment({ fund_category: 'Event Sponsorship' })).toBe('Events');
  });

  it('accepts gift_code', () => {
    expect(classifyDepartment({ gift_code: 'estate-2025' })).toBe('Legacy Giving');
  });

  it('accepts appeal_description', () => {
    expect(classifyDepartment({ appeal_description: 'Annual Gala' })).toBe('Events');
  });

  it('accepts campaign_description', () => {
    expect(classifyDepartment({ campaign_description: 'Transform Initiative' })).toBe('Major Gifts');
  });

  it('accepts fund_description', () => {
    expect(classifyDepartment({ fund_description: 'Golf Tournament' })).toBe('Events');
  });

  it('accepts gift_amount', () => {
    expect(classifyDepartment({ gift_amount: 20000 })).toBe('Major Gifts');
  });
});
