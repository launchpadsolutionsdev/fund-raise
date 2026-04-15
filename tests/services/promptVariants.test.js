const {
  VARIANTS,
  DEFAULT_VARIANT_NAME,
  selectVariant,
  getVariant,
} = require('../../src/services/promptVariants');

describe('promptVariants registry', () => {
  test('every writing feature has at least one variant registered', () => {
    for (const feature of ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest']) {
      expect(Array.isArray(VARIANTS[feature])).toBe(true);
      expect(VARIANTS[feature].length).toBeGreaterThan(0);
    }
  });

  test('every registered variant has a name and a callable builder', () => {
    for (const [feature, list] of Object.entries(VARIANTS)) {
      list.forEach((v) => {
        expect(typeof v.name).toBe('string');
        expect(v.name.length).toBeGreaterThan(0);
        expect(v.name.length).toBeLessThanOrEqual(32); // fits prompt_version column
        expect(typeof v.builder).toBe('function');
        // Builder must at least accept an empty params object without throwing.
        const out = v.builder({});
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
        // Misuse-proofing: feature string round-trips via the registry.
        expect(VARIANTS[feature]).toContain(v);
      });
    }
  });
});

describe('promptVariants.selectVariant', () => {
  test('returns the single registered variant when only one exists', () => {
    // All shipped features currently have one variant each.
    expect(selectVariant('writing').name).toBe(DEFAULT_VARIANT_NAME);
    expect(selectVariant('thankYou').name).toBe(DEFAULT_VARIANT_NAME);
  });

  test('throws for an unknown feature', () => {
    expect(() => selectVariant('bogus')).toThrow();
  });

  test('weighted pick honours relative weights', () => {
    // We can't mutate the shipped registry without breaking the other tests,
    // so we validate the selection algorithm against a local list via the
    // second-argument rng.
    const local = [
      { name: 'A', weight: 1, builder: () => 'A' },
      { name: 'B', weight: 3, builder: () => 'B' },
    ];
    // Inline reimplementation mirrors selectVariant; the point of this test
    // is that the EXPORTED algorithm behaves the way documented. Drive it
    // via the registry by temporarily swapping in a known list.
    const feature = '__test__';
    VARIANTS[feature] = local;
    try {
      // Cumulative weights: A [0..1), B [1..4). total=4.
      expect(selectVariant(feature, () => 0).name).toBe('A');
      expect(selectVariant(feature, () => 0.24).name).toBe('A'); // 0.24*4=0.96 → A
      expect(selectVariant(feature, () => 0.25).name).toBe('B'); // 0.25*4=1.0 → B
      expect(selectVariant(feature, () => 0.99).name).toBe('B');
    } finally {
      delete VARIANTS[feature];
    }
  });

  test('falls back to the first variant when every weight is zero', () => {
    const feature = '__test_zero__';
    VARIANTS[feature] = [
      { name: 'A', weight: 0, builder: () => '' },
      { name: 'B', weight: 0, builder: () => '' },
    ];
    try {
      expect(selectVariant(feature).name).toBe('A');
    } finally {
      delete VARIANTS[feature];
    }
  });

  test('skips variants with missing / zero weight when others have weight', () => {
    const feature = '__test_mixed__';
    VARIANTS[feature] = [
      { name: 'A', weight: 0, builder: () => '' },
      { name: 'B', weight: 5, builder: () => '' },
      { name: 'C', builder: () => '' }, // no weight
    ];
    try {
      // Only B has positive weight, so every draw should select B.
      for (let i = 0; i < 5; i++) {
        expect(selectVariant(feature, () => i / 5).name).toBe('B');
      }
    } finally {
      delete VARIANTS[feature];
    }
  });
});

describe('promptVariants.getVariant', () => {
  test('finds a registered variant by name', () => {
    const v = getVariant('thankYou', DEFAULT_VARIANT_NAME);
    expect(v).not.toBeNull();
    expect(v.name).toBe(DEFAULT_VARIANT_NAME);
  });

  test('returns null for unknown names', () => {
    expect(getVariant('thankYou', 'does-not-exist')).toBeNull();
  });

  test('returns null for unknown features', () => {
    expect(getVariant('bogus', DEFAULT_VARIANT_NAME)).toBeNull();
  });
});
