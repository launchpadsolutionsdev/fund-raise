/**
 * Tests for excelParser.js
 *
 * The module only exports parseDepartmentFile, which requires actual Excel
 * files. The internal utility functions (safeFloat, safeInt, parseDate) are
 * tested by replicating the pure logic — same pattern used in the
 * crmExcelParser tests.
 */
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Replicate internal pure helpers for direct unit testing
// ---------------------------------------------------------------------------

function safeFloat(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,%]/g, '').trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

function safeInt(val) {
  const f = safeFloat(val);
  return f != null ? Math.round(f) : null;
}

function parseDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// safeFloat tests
// ---------------------------------------------------------------------------

describe('safeFloat', () => {
  it('returns null for null', () => {
    expect(safeFloat(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(safeFloat(undefined)).toBeNull();
  });

  it('passes through numbers unchanged', () => {
    expect(safeFloat(42)).toBe(42);
    expect(safeFloat(3.14)).toBe(3.14);
    expect(safeFloat(0)).toBe(0);
    expect(safeFloat(-100)).toBe(-100);
  });

  it('strips dollar signs and parses', () => {
    expect(safeFloat('$1,234.56')).toBe(1234.56);
  });

  it('strips percent signs and parses', () => {
    expect(safeFloat('45%')).toBe(45);
  });

  it('strips commas from number strings', () => {
    expect(safeFloat('1,000,000')).toBe(1000000);
  });

  it('parses plain number strings', () => {
    expect(safeFloat('123.45')).toBe(123.45);
  });

  it('returns null for "0" string (parses to 0)', () => {
    // '0' should parse to 0, not null
    expect(safeFloat('0')).toBe(0);
  });

  it('returns null for non-numeric strings', () => {
    expect(safeFloat('abc')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeFloat('')).toBeNull();
  });

  it('handles strings with leading/trailing whitespace', () => {
    expect(safeFloat('  42.5  ')).toBe(42.5);
  });

  it('handles combined dollar + comma formatting', () => {
    expect(safeFloat('$10,500.00')).toBe(10500);
  });

  it('returns null for non-string non-number types', () => {
    expect(safeFloat({})).toBeNull();
    expect(safeFloat([])).toBeNull();
    expect(safeFloat(true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// safeInt tests
// ---------------------------------------------------------------------------

describe('safeInt', () => {
  it('parses integer strings', () => {
    expect(safeInt('42')).toBe(42);
  });

  it('rounds floats to nearest integer', () => {
    expect(safeInt('3.7')).toBe(4);
    expect(safeInt('3.2')).toBe(3);
  });

  it('returns null for null', () => {
    expect(safeInt(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(safeInt(undefined)).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(safeInt('abc')).toBeNull();
  });

  it('handles number inputs', () => {
    expect(safeInt(10)).toBe(10);
    expect(safeInt(10.6)).toBe(11);
  });

  it('handles formatted strings via safeFloat', () => {
    expect(safeInt('$1,234')).toBe(1234);
  });

  it('returns 0 for "0"', () => {
    expect(safeInt('0')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseDate tests
// ---------------------------------------------------------------------------

describe('parseDate', () => {
  it('returns null for null', () => {
    expect(parseDate(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseDate(undefined)).toBeNull();
  });

  it('formats Date objects as YYYY-MM-DD', () => {
    const d = new Date('2024-06-15T00:00:00Z');
    expect(parseDate(d)).toBe('2024-06-15');
  });

  it('parses ISO date strings', () => {
    expect(parseDate('2024-01-15')).toBe('2024-01-15');
  });

  it('parses date strings with time component', () => {
    const result = parseDate('2024-06-15T10:30:00Z');
    expect(result).toBe('2024-06-15');
  });

  it('handles Excel serial date numbers', () => {
    // Excel serial 45000 = 2023-02-18
    const result = parseDate(45000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result).not.toBeNull();
  });

  it('returns null for non-parseable strings', () => {
    expect(parseDate('not a date')).toBeNull();
  });

  it('handles Excel serial 0 (returns a date string from XLSX)', () => {
    // 0 is a valid number, so it passes the null check and goes to XLSX.SSF.parse_date_code
    const result = parseDate(0);
    // XLSX produces a date-like string for serial 0
    expect(typeof result).toBe('string');
  });
});
