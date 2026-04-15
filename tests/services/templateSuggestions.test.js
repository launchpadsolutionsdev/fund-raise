jest.mock('../../src/models', () => ({
  WritingOutput: { findAll: jest.fn() },
  WritingTemplate: { findAll: jest.fn() },
}));

const { WritingOutput, WritingTemplate } = require('../../src/models');
const {
  getSuggestions,
  paramsSignature,
  MIN_CLUSTER_SIZE,
  _internals,
} = require('../../src/services/templateSuggestions');

function row(overrides) {
  return {
    id: Math.random().toString(36).slice(2),
    feature: 'thankYou',
    params: {},
    savedName: null,
    createdAt: new Date('2026-04-10T00:00:00Z'),
    ...overrides,
  };
}

describe('templateSuggestions._internals.canonicalise', () => {
  test('strips empty strings, nulls, and undefineds recursively', () => {
    const out = _internals.canonicalise({ a: 'x', b: '', c: null, d: undefined, e: '   y  ' });
    expect(out).toEqual({ a: 'x', e: 'y' });
  });

  test('returns undefined for an entirely-empty object', () => {
    expect(_internals.canonicalise({ a: '', b: null })).toBeUndefined();
  });

  test('sorts keys alphabetically', () => {
    const out = _internals.canonicalise({ z: 1, a: 2, m: 3 });
    expect(Object.keys(out)).toEqual(['a', 'm', 'z']);
  });

  test('drops empty arrays and trims string array entries', () => {
    expect(_internals.canonicalise({ arr: [' ', '', null] })).toBeUndefined();
    expect(_internals.canonicalise({ arr: ['  hi  ', '', 'there'] })).toEqual({ arr: ['hi', 'there'] });
  });
});

describe('templateSuggestions.paramsSignature', () => {
  test('returns identical signatures for functionally equal params', () => {
    expect(paramsSignature({ a: 1, b: 'x' })).toBe(paramsSignature({ b: 'x', a: 1 }));
    expect(paramsSignature({ a: 1, b: 'x' })).toBe(paramsSignature({ a: 1, b: 'x', c: '' }));
    expect(paramsSignature({ a: 1, b: 'x' })).toBe(paramsSignature({ a: 1, b: '   x  ', c: null }));
  });

  test('returns distinct signatures for genuinely different params', () => {
    expect(paramsSignature({ a: 1 })).not.toBe(paramsSignature({ a: 2 }));
    expect(paramsSignature({ a: 1 })).not.toBe(paramsSignature({ b: 1 }));
  });

  test('returns null for empty / non-object inputs', () => {
    expect(paramsSignature(null)).toBeNull();
    expect(paramsSignature({})).toBeNull();
    expect(paramsSignature({ a: '', b: null })).toBeNull();
    expect(paramsSignature('a string')).toBeNull();
  });
});

describe('templateSuggestions.getSuggestions', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns [] without a tenantId', async () => {
    expect(await getSuggestions(null)).toEqual([]);
    expect(WritingOutput.findAll).not.toHaveBeenCalled();
  });

  test('always scopes the saved-rows query to the tenant + saved + visible', async () => {
    WritingOutput.findAll.mockResolvedValue([]);
    WritingTemplate.findAll.mockResolvedValue([]);
    await getSuggestions(7);
    const args = WritingOutput.findAll.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: 7, isSaved: true, isHidden: false });
  });

  test('returns clusters that meet the minimum cluster size, sorted by count', async () => {
    const p = { letterStyle: 'warm', donorName: 'Margaret' };
    WritingOutput.findAll.mockResolvedValue([
      row({ id: '1', params: p }),
      row({ id: '2', params: p }),
      row({ id: '3', params: p }),
      row({ id: '4', feature: 'impact', params: { format: 'Newsletter', focus: 'Research' } }),
      row({ id: '5', feature: 'impact', params: { format: 'Newsletter', focus: 'Research' } }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([]);

    const out = await getSuggestions(7);
    // Only the thankYou cluster has 3 members → impact pair is dropped
    expect(out).toHaveLength(1);
    expect(out[0].feature).toBe('thankYou');
    expect(out[0].count).toBe(3);
    expect(out[0].params).toEqual(p);
  });

  test('treats functionally-equal params as the same cluster', async () => {
    WritingOutput.findAll.mockResolvedValue([
      row({ id: '1', params: { letterStyle: 'warm', donorName: 'Pat' } }),
      row({ id: '2', params: { donorName: 'Pat', letterStyle: 'warm', tone: '' } }),
      row({ id: '3', params: { letterStyle: '   warm  ', donorName: 'Pat' } }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([]);

    const out = await getSuggestions(7);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(3);
  });

  test('drops clusters that already exist as a tenant template', async () => {
    const p = { letterStyle: 'warm', donorName: 'Pat' };
    WritingOutput.findAll.mockResolvedValue([
      row({ params: p }), row({ params: p }), row({ params: p }), row({ params: p }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([
      // Existing tenant template covers the same combo → cluster should be filtered out
      { feature: 'thankYou', params: { donorName: 'Pat', letterStyle: 'warm' } },
    ]);

    const out = await getSuggestions(7);
    expect(out).toEqual([]);
  });

  test('skips rows whose params are functionally empty', async () => {
    WritingOutput.findAll.mockResolvedValue([
      row({ params: {} }), row({ params: {} }), row({ params: { x: '' } }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([]);

    const out = await getSuggestions(7);
    expect(out).toEqual([]);
  });

  test('attaches up to 3 example IDs and the most-recent saved name + date', async () => {
    const p = { letterStyle: 'warm' };
    WritingOutput.findAll.mockResolvedValue([
      row({ id: 'newest', params: p, savedName: 'Latest', createdAt: new Date('2026-04-12') }),
      row({ id: 'middle', params: p, savedName: 'Older one', createdAt: new Date('2026-04-10') }),
      row({ id: 'oldest', params: p, savedName: 'Oldest', createdAt: new Date('2026-04-01') }),
      row({ id: 'extra',  params: p, savedName: 'Extra',  createdAt: new Date('2026-03-30') }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([]);

    const out = await getSuggestions(7);
    expect(out[0].count).toBe(4);
    expect(out[0].exampleIds).toHaveLength(3);
    expect(out[0].latestSavedName).toBe('Latest');
  });

  test('higher-count clusters appear before lower-count ones', async () => {
    const a = { letterStyle: 'warm' };
    const b = { letterStyle: 'formal' };
    WritingOutput.findAll.mockResolvedValue([
      row({ params: a }), row({ params: a }), row({ params: a }),
      row({ params: b }), row({ params: b }), row({ params: b }), row({ params: b }), row({ params: b }),
    ]);
    WritingTemplate.findAll.mockResolvedValue([]);

    const out = await getSuggestions(7);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(5);
    expect(out[0].params.letterStyle).toBe('formal');
    expect(out[1].count).toBe(3);
  });

  test('returns [] (and does not throw) when the DB lookup fails', async () => {
    WritingOutput.findAll.mockRejectedValue(new Error('DB down'));
    WritingTemplate.findAll.mockResolvedValue([]);
    const out = await getSuggestions(7);
    expect(out).toEqual([]);
  });

  test('honours the minimum cluster size constant', () => {
    expect(MIN_CLUSTER_SIZE).toBeGreaterThanOrEqual(2);
  });
});
