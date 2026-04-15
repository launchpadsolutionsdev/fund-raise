jest.mock('../../src/models', () => ({
  TenantBrandVoice: {
    findOne: jest.fn(),
  },
}));

const { TenantBrandVoice } = require('../../src/models');
const {
  getBrandVoice,
  buildBrandVoiceBlock,
  getBrandVoiceBlock,
} = require('../../src/services/brandVoice');

describe('brandVoice.buildBrandVoiceBlock', () => {
  test('returns null for empty / null voice', () => {
    expect(buildBrandVoiceBlock(null)).toBeNull();
    expect(buildBrandVoiceBlock({})).toBeNull();
    expect(buildBrandVoiceBlock({
      toneDescription: '',
      organizationValues: [],
      preferredTerms: [],
      bannedPhrases: [],
    })).toBeNull();
  });

  test('includes tone description when present', () => {
    const block = buildBrandVoiceBlock({ toneDescription: 'Warm and conversational.' });
    expect(block).toContain('## Organisation voice');
    expect(block).toContain('Warm and conversational.');
  });

  test('formats organization values as a bulleted list', () => {
    const block = buildBrandVoiceBlock({
      organizationValues: ['community-first', 'radical transparency'],
    });
    expect(block).toContain('## Core values');
    expect(block).toContain('- community-first');
    expect(block).toContain('- radical transparency');
  });

  test('formats preferred terms as "use X instead of Y"', () => {
    const block = buildBrandVoiceBlock({
      preferredTerms: [{ from: 'donor', to: 'partner' }, { from: 'donation', to: 'gift' }],
    });
    expect(block).toContain('Preferred vocabulary');
    expect(block).toContain('Use "partner" instead of "donor"');
    expect(block).toContain('Use "gift" instead of "donation"');
  });

  test('skips preferred-term entries missing from or to', () => {
    const block = buildBrandVoiceBlock({
      preferredTerms: [
        { from: 'donor', to: 'partner' },
        { from: 'donation', to: '' },
        { from: '', to: 'gift' },
        null,
      ],
    });
    expect(block).toContain('Use "partner" instead of "donor"');
    expect(block).not.toContain('Use "" instead');
    expect(block).not.toContain('instead of ""');
  });

  test('formats banned phrases as a bulleted list', () => {
    const block = buildBrandVoiceBlock({ bannedPhrases: ['truly', 'amazing'] });
    expect(block).toContain('Never use these words or phrases');
    expect(block).toContain('- truly');
    expect(block).toContain('- amazing');
  });

  test('includes signature block with an "exactly this" preamble', () => {
    const block = buildBrandVoiceBlock({
      signatureBlock: 'With gratitude,\nJane Smith\nPresident',
    });
    expect(block).toContain('## Signature block');
    expect(block).toContain('use exactly this');
    expect(block).toContain('Jane Smith');
  });

  test('includes additional guidance verbatim', () => {
    const block = buildBrandVoiceBlock({
      additionalGuidance: "We refer to our hospital as 'the General'.",
    });
    expect(block).toContain('## Additional guidance');
    expect(block).toContain("the General");
  });

  test('composes multiple sections with blank lines between them', () => {
    const block = buildBrandVoiceBlock({
      toneDescription: 'Warm and direct.',
      organizationValues: ['community-first'],
      bannedPhrases: ['truly'],
    });
    // Sections separated by blank lines
    expect(block.split('\n\n').length).toBeGreaterThanOrEqual(3);
  });
});

describe('brandVoice.getBrandVoice', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null when no row exists', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    expect(await getBrandVoice(7)).toBeNull();
  });

  test('returns null when row is marked inactive', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ isActive: false, toneDescription: 'x' });
    expect(await getBrandVoice(7)).toBeNull();
  });

  test('returns the row when active', async () => {
    const row = { isActive: true, toneDescription: 'Warm.' };
    TenantBrandVoice.findOne.mockResolvedValue(row);
    expect(await getBrandVoice(7)).toBe(row);
  });

  test('returns null and logs when the DB throws', async () => {
    TenantBrandVoice.findOne.mockRejectedValue(new Error('DB down'));
    expect(await getBrandVoice(7)).toBeNull();
  });

  test('returns null when tenantId is missing', async () => {
    expect(await getBrandVoice(null)).toBeNull();
    expect(TenantBrandVoice.findOne).not.toHaveBeenCalled();
  });
});

describe('brandVoice.getBrandVoiceBlock', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null when no active voice exists', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    expect(await getBrandVoiceBlock(7)).toBeNull();
  });

  test('returns formatted block when voice is present', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({
      isActive: true,
      toneDescription: 'Direct and warm.',
      organizationValues: ['community-first'],
    });
    const block = await getBrandVoiceBlock(7);
    expect(block).toContain('Direct and warm.');
    expect(block).toContain('community-first');
  });
});
