jest.mock('../../src/models', () => ({
  WritingOutput: { findAll: jest.fn() },
  TenantBrandVoice: { findOne: jest.fn() },
}));

// We use Sequelize.literal for CASE-style ordering inside getExemplars; mock
// it here so the test environment doesn't need the real sequelize module
// resolved (matches the pattern used by other DB-touching service tests).
jest.mock('sequelize', () => ({
  Sequelize: { literal: jest.fn((s) => ({ __literal: s })) },
}), { virtual: true });

const { WritingOutput, TenantBrandVoice } = require('../../src/models');
const {
  getExemplars,
  buildExemplarsBlock,
  getExemplarsBlock,
  _internals,
} = require('../../src/services/exemplars');

describe('exemplars._internals', () => {
  test('caps the number of exemplars at 3', () => {
    expect(_internals.MAX_EXEMPLARS).toBe(3);
  });

  test('caps each exemplar at 4 KB and the block at 10 KB', () => {
    expect(_internals.MAX_EXEMPLAR_CHARS).toBe(4000);
    expect(_internals.MAX_BLOCK_CHARS).toBe(10000);
  });
});

describe('exemplars.getExemplars', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns [] when tenantId or feature is missing', async () => {
    expect(await getExemplars(null, 'thankYou')).toEqual([]);
    expect(await getExemplars(7, null)).toEqual([]);
    expect(WritingOutput.findAll).not.toHaveBeenCalled();
  });

  test('queries with tenant + feature + isSaved + isHidden filters', async () => {
    WritingOutput.findAll.mockResolvedValue([]);
    await getExemplars(7, 'thankYou');
    const args = WritingOutput.findAll.mock.calls[0][0];
    expect(args.where).toMatchObject({
      tenantId: 7,
      feature: 'thankYou',
      isSaved: true,
      isHidden: false,
    });
  });

  test('orders helpful rows first, then by recency', async () => {
    WritingOutput.findAll.mockResolvedValue([]);
    await getExemplars(7, 'thankYou');
    const order = WritingOutput.findAll.mock.calls[0][0].order;
    // First sort key prefers helpful rows; second is created_at DESC.
    expect(order[0][1]).toBe('ASC');
    expect(order[1]).toEqual(['createdAt', 'DESC']);
  });

  test('clamps user-supplied limit to MAX_EXEMPLARS', async () => {
    WritingOutput.findAll.mockResolvedValue([]);
    await getExemplars(7, 'thankYou', { limit: 99 });
    expect(WritingOutput.findAll.mock.calls[0][0].limit).toBe(3);
  });

  test('returns the rows the model returned', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    WritingOutput.findAll.mockResolvedValue(rows);
    expect(await getExemplars(7, 'thankYou')).toEqual(rows);
  });

  test('swallows DB errors and returns []', async () => {
    WritingOutput.findAll.mockRejectedValue(new Error('boom'));
    expect(await getExemplars(7, 'thankYou')).toEqual([]);
  });
});

describe('exemplars.buildExemplarsBlock', () => {
  test('returns null for empty / missing input', () => {
    expect(buildExemplarsBlock(null, 'thankYou')).toBeNull();
    expect(buildExemplarsBlock([], 'thankYou')).toBeNull();
  });

  test('returns null when every row has empty text', () => {
    const block = buildExemplarsBlock([
      { generatedText: '' },
      { generatedText: '   ' },
    ], 'thankYou');
    expect(block).toBeNull();
  });

  test('frames the block with a header naming the feature', () => {
    const block = buildExemplarsBlock([
      { generatedText: 'Dear Margaret, thank you for your gift.' },
    ], 'thankYou');
    expect(block).toContain('## Examples');
    expect(block).toContain('thankYou');
    expect(block).toContain('Dear Margaret, thank you for your gift.');
  });

  test('uses the savedName when present, otherwise a numbered fallback', () => {
    const block = buildExemplarsBlock([
      { generatedText: 'A.', savedName: 'Donor wall acceptance' },
      { generatedText: 'B.' },
    ], 'thankYou');
    expect(block).toContain('### Donor wall acceptance');
    expect(block).toContain('### Example 2');
  });

  test('truncates a single overlarge exemplar to MAX_EXEMPLAR_CHARS', () => {
    // Use a marker char ('z') the header text doesn't contain, so we can
    // count exactly how much of the body survived without false hits.
    const long = 'z'.repeat(_internals.MAX_EXEMPLAR_CHARS + 500);
    const block = buildExemplarsBlock([{ generatedText: long }], 'thankYou');
    expect(block).toContain('[…truncated]');
    const zCount = (block.match(/z/g) || []).length;
    expect(zCount).toBe(_internals.MAX_EXEMPLAR_CHARS);
  });

  test('stops adding exemplars once the running total would exceed MAX_BLOCK_CHARS', () => {
    const big = 'a'.repeat(_internals.MAX_EXEMPLAR_CHARS);
    const rows = [
      { generatedText: big, savedName: 'one' },
      { generatedText: big, savedName: 'two' },
      { generatedText: big, savedName: 'three' },
    ];
    const block = buildExemplarsBlock(rows, 'thankYou');
    // Two exemplars * 4000 chars = 8000 chars of body. Adding a third
    // would push past the 10 KB block ceiling, so it should be skipped.
    expect(block).toContain('### one');
    expect(block).toContain('### two');
    expect(block).not.toContain('### three');
  });
});

describe('exemplars.getExemplarsBlock', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null without tenantId or feature', async () => {
    expect(await getExemplarsBlock(null, 'thankYou')).toBeNull();
    expect(await getExemplarsBlock(7, null)).toBeNull();
  });

  test('returns null when the tenant has explicitly opted out', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ useExemplars: false });
    expect(await getExemplarsBlock(7, 'thankYou')).toBeNull();
    expect(WritingOutput.findAll).not.toHaveBeenCalled();
  });

  test('treats missing brand voice row as opted-in (default true)', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    WritingOutput.findAll.mockResolvedValue([
      { generatedText: 'Saved exemplar body.' },
    ]);
    const block = await getExemplarsBlock(7, 'thankYou');
    expect(block).toContain('Saved exemplar body.');
  });

  test('treats useExemplars=true as opted-in', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ useExemplars: true });
    WritingOutput.findAll.mockResolvedValue([
      { generatedText: 'Saved exemplar body.' },
    ]);
    const block = await getExemplarsBlock(7, 'thankYou');
    expect(block).toContain('Saved exemplar body.');
  });

  test('returns null when the tenant is opted-in but has no saved rows', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ useExemplars: true });
    WritingOutput.findAll.mockResolvedValue([]);
    expect(await getExemplarsBlock(7, 'thankYou')).toBeNull();
  });

  test('continues even when the kill-switch lookup throws', async () => {
    TenantBrandVoice.findOne.mockRejectedValue(new Error('DB hiccup'));
    WritingOutput.findAll.mockResolvedValue([
      { generatedText: 'Saved exemplar body.' },
    ]);
    const block = await getExemplarsBlock(7, 'thankYou');
    expect(block).toContain('Saved exemplar body.');
  });
});
