/**
 * Tests for pure utility functions in crmDashboardService.
 *
 * We extract the logic of dateWhere, dateReplacements, and fyFromDateRange
 * directly (they are simple, pure functions) so we can test them without
 * requiring a database connection.
 */

// Replicate the pure helper functions from the service
// (the module itself requires('../models') at the top level, so we test the logic directly)

function dateWhere(dateRange, alias) {
  if (!dateRange) return '';
  const col = alias ? `${alias}.gift_date` : 'gift_date';
  return ` AND ${col} >= :startDate AND ${col} < :endDate`;
}

function dateReplacements(dateRange) {
  if (!dateRange) return {};
  return { startDate: dateRange.startDate, endDate: dateRange.endDate };
}

function fyFromDateRange(dateRange) {
  if (!dateRange) return null;
  return Number(dateRange.endDate.split('-')[0]);
}

describe('dateWhere', () => {
  it('should return empty string when dateRange is null', () => {
    expect(dateWhere(null)).toBe('');
  });

  it('should return empty string when dateRange is undefined', () => {
    expect(dateWhere(undefined)).toBe('');
  });

  it('should return SQL fragment without alias', () => {
    const result = dateWhere({ startDate: '2024-04-01', endDate: '2025-04-01' });
    expect(result).toBe(' AND gift_date >= :startDate AND gift_date < :endDate');
  });

  it('should return SQL fragment with alias', () => {
    const result = dateWhere({ startDate: '2024-04-01', endDate: '2025-04-01' }, 'g');
    expect(result).toBe(' AND g.gift_date >= :startDate AND g.gift_date < :endDate');
  });
});

describe('dateReplacements', () => {
  it('should return empty object when dateRange is null', () => {
    expect(dateReplacements(null)).toEqual({});
  });

  it('should return startDate and endDate from dateRange', () => {
    const range = { startDate: '2024-04-01', endDate: '2025-04-01' };
    expect(dateReplacements(range)).toEqual({
      startDate: '2024-04-01',
      endDate: '2025-04-01',
    });
  });
});

describe('fyFromDateRange', () => {
  it('should return null when dateRange is null', () => {
    expect(fyFromDateRange(null)).toBeNull();
  });

  it('should extract FY year from endDate (FY2025 ends 2025-04-01)', () => {
    expect(fyFromDateRange({ startDate: '2024-04-01', endDate: '2025-04-01' })).toBe(2025);
  });

  it('should extract FY year from endDate (FY2026 ends 2026-04-01)', () => {
    expect(fyFromDateRange({ startDate: '2025-04-01', endDate: '2026-04-01' })).toBe(2026);
  });
});
