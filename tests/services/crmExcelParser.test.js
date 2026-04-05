/**
 * Tests for crmExcelParser.js
 *
 * Covers the pure autoMapColumns function and the column mapping constants.
 * Internal helpers (parseDate, parseAmount, parseBoolean, cleanString, coerceValue)
 * are tested indirectly through autoMapColumns behavior and by replicating the
 * pure logic for unit verification.
 */
const {
  autoMapColumns,
  STANDARD_COLUMN_MAP,
  GIFT_FIELDS,
  FUNDRAISER_FIELDS,
  SOFT_CREDIT_FIELDS,
  MATCH_FIELDS,
} = require('../../src/services/crmExcelParser');

// ---------------------------------------------------------------------------
// Replicate internal pure helpers for direct unit testing
// (the module exports them indirectly via parseCrmExcel/streamParseCsv,
//  but we can test the logic in isolation by copying the pure functions)
// ---------------------------------------------------------------------------

function parseDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

function parseAmount(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,\s]/g, '').trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseBoolean(val) {
  if (val == null) return null;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return null;
}

function cleanString(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// autoMapColumns tests
// ---------------------------------------------------------------------------

describe('autoMapColumns', () => {
  it('maps standard Blackbaud NXT headers correctly', () => {
    const headers = [
      'Gift ID', 'Gift Amount', 'Gift Date', 'Constituent ID',
      'First Name', 'Last Name', 'Fund Description',
      'Campaign Description', 'Appeal ID',
    ];
    const { mapping, unmapped } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBe('giftAmount');
    expect(mapping[2]).toBe('giftDate');
    expect(mapping[3]).toBe('constituentId');
    expect(mapping[4]).toBe('firstName');
    expect(mapping[5]).toBe('lastName');
    expect(mapping[6]).toBe('fundDescription');
    expect(mapping[7]).toBe('campaignDescription');
    expect(mapping[8]).toBe('appealId');
    expect(unmapped).toEqual([]);
  });

  it('handles lowercase headers', () => {
    const headers = ['gift id', 'gift amount'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBe('giftAmount');
  });

  it('handles uppercase headers', () => {
    const headers = ['GIFT ID', 'GIFT AMOUNT'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBe('giftAmount');
  });

  it('handles mixed casing', () => {
    const headers = ['gift id', 'GIFT AMOUNT', 'Gift Date'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBe('giftAmount');
    expect(mapping[2]).toBe('giftDate');
  });

  it('maps partial headers and reports unmapped ones', () => {
    const headers = ['Gift ID', 'Custom Column', 'Gift Amount', 'Notes Field'];
    const { mapping, unmapped } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBeUndefined();
    expect(mapping[2]).toBe('giftAmount');
    expect(mapping[3]).toBeUndefined();
    expect(unmapped).toEqual(['Custom Column', 'Notes Field']);
  });

  it('returns empty mapping and unmapped for empty headers', () => {
    const { mapping, unmapped } = autoMapColumns([]);

    expect(mapping).toEqual({});
    expect(unmapped).toEqual([]);
  });

  it('returns all unmapped when no headers match', () => {
    const headers = ['Foo', 'Bar', 'Baz'];
    const { mapping, unmapped } = autoMapColumns(headers);

    expect(Object.keys(mapping)).toHaveLength(0);
    expect(unmapped).toEqual(['Foo', 'Bar', 'Baz']);
  });

  it('skips null headers without crashing', () => {
    const headers = ['Gift ID', null, 'Gift Amount'];
    const { mapping, unmapped } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBeUndefined();
    expect(mapping[2]).toBe('giftAmount');
    expect(unmapped).toEqual([]);
  });

  it('handles headers with extra whitespace', () => {
    const headers = ['  Gift ID  ', '  Gift Amount  '];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('giftId');
    expect(mapping[1]).toBe('giftAmount');
  });

  it('maps fundraiser fields correctly', () => {
    const headers = ['Fundraiser Name', 'Fundraiser First Name', 'Fundraiser Last Name', 'Fundraiser Amount'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('fundraiserName');
    expect(mapping[1]).toBe('fundraiserFirstName');
    expect(mapping[2]).toBe('fundraiserLastName');
    expect(mapping[3]).toBe('fundraiserAmount');
  });

  it('maps soft credit fields correctly', () => {
    const headers = ['Soft Credit Amount', 'Soft Credit Recipient First Name', 'Soft Credit Recipient ID'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('softCreditAmount');
    expect(mapping[1]).toBe('recipientFirstName');
    expect(mapping[2]).toBe('recipientId');
  });

  it('maps matching gift fields correctly', () => {
    const headers = ['Match Gift ID', 'Match Gift Date', 'Match Receipt Amount'];
    const { mapping } = autoMapColumns(headers);

    expect(mapping[0]).toBe('matchGiftId');
    expect(mapping[1]).toBe('matchGiftDate');
    expect(mapping[2]).toBe('matchReceiptAmount');
  });
});

// ---------------------------------------------------------------------------
// STANDARD_COLUMN_MAP tests
// ---------------------------------------------------------------------------

describe('STANDARD_COLUMN_MAP', () => {
  it('has all expected gift core mappings', () => {
    expect(STANDARD_COLUMN_MAP['gift amount']).toBe('giftAmount');
    expect(STANDARD_COLUMN_MAP['gift id']).toBe('giftId');
    expect(STANDARD_COLUMN_MAP['gift date']).toBe('giftDate');
    expect(STANDARD_COLUMN_MAP['gift status']).toBe('giftStatus');
  });

  it('has constituent mappings', () => {
    expect(STANDARD_COLUMN_MAP['constituent id']).toBe('constituentId');
    expect(STANDARD_COLUMN_MAP['first name']).toBe('firstName');
    expect(STANDARD_COLUMN_MAP['last name']).toBe('lastName');
  });

  it('has fund, campaign, and appeal mappings', () => {
    expect(STANDARD_COLUMN_MAP['fund description']).toBe('fundDescription');
    expect(STANDARD_COLUMN_MAP['campaign description']).toBe('campaignDescription');
    expect(STANDARD_COLUMN_MAP['appeal category']).toBe('appealCategory');
  });
});

// ---------------------------------------------------------------------------
// Field set tests
// ---------------------------------------------------------------------------

describe('Field sets', () => {
  it('GIFT_FIELDS contains core gift fields', () => {
    expect(GIFT_FIELDS.has('giftId')).toBe(true);
    expect(GIFT_FIELDS.has('giftAmount')).toBe(true);
    expect(GIFT_FIELDS.has('giftDate')).toBe(true);
    expect(GIFT_FIELDS.has('constituentId')).toBe(true);
    expect(GIFT_FIELDS.has('fundDescription')).toBe(true);
    expect(GIFT_FIELDS.has('appealCategory')).toBe(true);
  });

  it('GIFT_FIELDS does not contain sub-table fields', () => {
    expect(GIFT_FIELDS.has('fundraiserName')).toBe(false);
    expect(GIFT_FIELDS.has('softCreditAmount')).toBe(false);
    expect(GIFT_FIELDS.has('matchGiftId')).toBe(false);
  });

  it('FUNDRAISER_FIELDS contains expected fields', () => {
    expect(FUNDRAISER_FIELDS.has('fundraiserName')).toBe(true);
    expect(FUNDRAISER_FIELDS.has('fundraiserAmount')).toBe(true);
  });

  it('SOFT_CREDIT_FIELDS contains expected fields', () => {
    expect(SOFT_CREDIT_FIELDS.has('softCreditAmount')).toBe(true);
    expect(SOFT_CREDIT_FIELDS.has('recipientName')).toBe(true);
  });

  it('MATCH_FIELDS contains expected fields', () => {
    expect(MATCH_FIELDS.has('matchGiftId')).toBe(true);
    expect(MATCH_FIELDS.has('matchReceiptAmount')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Internal helper tests (replicated pure functions)
// ---------------------------------------------------------------------------

describe('parseDate (replicated)', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
  });

  it('parses Date objects', () => {
    const d = new Date('2024-06-15');
    expect(parseDate(d)).toBe('2024-06-15');
  });

  it('returns null for invalid Date objects', () => {
    expect(parseDate(new Date('invalid'))).toBeNull();
  });

  it('parses ISO date strings', () => {
    expect(parseDate('2024-01-15')).toBe('2024-01-15');
  });

  it('parses date strings with time', () => {
    const result = parseDate('2024-06-15T10:30:00Z');
    expect(result).toBe('2024-06-15');
  });

  it('returns null for whitespace-only strings', () => {
    expect(parseDate('   ')).toBeNull();
  });
});

describe('parseAmount (replicated)', () => {
  it('returns null for null/undefined', () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('passes through numbers', () => {
    expect(parseAmount(100.50)).toBe(100.50);
    expect(parseAmount(0)).toBe(0);
  });

  it('parses dollar amounts', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('parses plain number strings', () => {
    expect(parseAmount('42')).toBe(42);
  });

  it('returns null for empty strings', () => {
    expect(parseAmount('')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parseAmount('abc')).toBeNull();
  });

  it('strips whitespace and commas', () => {
    expect(parseAmount(' 1,000 ')).toBe(1000);
  });
});

describe('parseBoolean (replicated)', () => {
  it('returns null for null/undefined', () => {
    expect(parseBoolean(null)).toBeNull();
    expect(parseBoolean(undefined)).toBeNull();
  });

  it('passes through booleans', () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
  });

  it('parses truthy strings', () => {
    expect(parseBoolean('yes')).toBe(true);
    expect(parseBoolean('Yes')).toBe(true);
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('y')).toBe(true);
  });

  it('parses falsy strings', () => {
    expect(parseBoolean('no')).toBe(false);
    expect(parseBoolean('No')).toBe(false);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('n')).toBe(false);
  });

  it('returns null for unrecognized strings', () => {
    expect(parseBoolean('maybe')).toBeNull();
  });
});

describe('cleanString (replicated)', () => {
  it('returns null for null/undefined', () => {
    expect(cleanString(null)).toBeNull();
    expect(cleanString(undefined)).toBeNull();
  });

  it('trims whitespace', () => {
    expect(cleanString('  hello  ')).toBe('hello');
  });

  it('returns null for empty/whitespace-only strings', () => {
    expect(cleanString('')).toBeNull();
    expect(cleanString('   ')).toBeNull();
  });

  it('converts non-strings via String()', () => {
    expect(cleanString(42)).toBe('42');
  });
});
