const { buildDisplayName, decorateDonorRows } = require('../../src/services/donorDisplayName');

describe('buildDisplayName', () => {
  test('uses first + last name when present', () => {
    expect(buildDisplayName({ first_name: 'Marian', last_name: 'Boxer' })).toBe('Marian Boxer');
  });

  test('trims and joins partial names', () => {
    expect(buildDisplayName({ first_name: '', last_name: ' Jones ' })).toBe('Jones');
    expect(buildDisplayName({ first_name: 'Alex ' })).toBe('Alex');
  });

  test('prefers donor_name / constituent_name when populated', () => {
    expect(buildDisplayName({ donor_name: 'Marian Boxer' })).toBe('Marian Boxer');
    expect(buildDisplayName({ constituent_name: 'Jean Drapeau' })).toBe('Jean Drapeau');
  });

  test('ignores placeholder names like "Anonymous"', () => {
    expect(buildDisplayName({ donor_name: 'Anonymous', constituent_id: 99 })).toBe('Constituent #99');
    expect(buildDisplayName({ constituent_name: 'UNKNOWN', constituent_id: 'C7' })).toBe('Constituent #C7');
  });

  test('falls back to Constituent #<id> when names are blank', () => {
    expect(buildDisplayName({ constituent_id: 12345 })).toBe('Constituent #12345');
    expect(buildDisplayName({ constituent_id: 'LID-001', first_name: null, last_name: '' })).toBe('Constituent #LID-001');
  });

  test('understands recipient_id shapes (soft credits)', () => {
    expect(buildDisplayName({ recipient_id: 42 })).toBe('Constituent #42');
    expect(buildDisplayName({ recipient_first_name: 'Jan', recipient_last_name: 'Smith' })).toBe('Jan Smith');
  });

  test('understands fundraiser_name shapes', () => {
    expect(buildDisplayName({ fundraiser_name: 'Parveen Kumar' })).toBe('Parveen Kumar');
    expect(buildDisplayName({ fundraiser_first_name: 'Amy', fundraiser_last_name: 'Li' })).toBe('Amy Li');
  });

  test('returns empty string only when we truly have nothing to show', () => {
    expect(buildDisplayName({})).toBe('');
    expect(buildDisplayName(null)).toBe('');
  });
});

describe('decorateDonorRows', () => {
  test('stamps display_name on each donor-shaped row', () => {
    const rows = [
      { constituent_id: 1, first_name: 'Marian', last_name: 'Boxer' },
      { constituent_id: 2, first_name: '', last_name: '' },
      { constituent_id: 'XYZ' },
    ];
    decorateDonorRows(rows);
    expect(rows[0].display_name).toBe('Marian Boxer');
    expect(rows[1].display_name).toBe('Constituent #2');
    expect(rows[2].display_name).toBe('Constituent #XYZ');
  });

  test('walks nested analytics tool result shapes', () => {
    const result = {
      summary: { total: 5 },
      donors: [
        { constituent_id: 10, first_name: 'A' },
        { constituent_id: 11 },
      ],
      segments: {
        champion: { donors: [{ constituent_id: 20, first_name: null, last_name: null }] },
      },
    };
    decorateDonorRows(result);
    expect(result.donors[0].display_name).toBe('A');
    expect(result.donors[1].display_name).toBe('Constituent #11');
    expect(result.segments.champion.donors[0].display_name).toBe('Constituent #20');
  });

  test('does not touch rows without constituent_id / recipient_id', () => {
    const rows = [
      { fund_id: 'F1', total: 1000 },
      { campaign_description: 'Spring Appeal', gift_count: 50 },
    ];
    decorateDonorRows(rows);
    expect(rows[0].display_name).toBeUndefined();
    expect(rows[1].display_name).toBeUndefined();
  });

  test('preserves existing display_name when already set', () => {
    const row = { constituent_id: 5, display_name: 'Custom Label' };
    decorateDonorRows(row);
    expect(row.display_name).toBe('Custom Label');
  });

  test('handles null / primitives / circular refs gracefully', () => {
    expect(() => decorateDonorRows(null)).not.toThrow();
    expect(() => decorateDonorRows(42)).not.toThrow();
    const a = { constituent_id: 1 };
    a.self = a;
    decorateDonorRows(a);
    expect(a.display_name).toBe('Constituent #1');
  });
});
