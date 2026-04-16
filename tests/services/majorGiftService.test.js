jest.mock('../../src/models', () => {
  const findByPk = jest.fn();
  return { Tenant: { findByPk }, __findByPk: findByPk };
});

const { Tenant } = require('../../src/models');
const mgService = require('../../src/services/majorGiftService');
const {
  DEFAULT_MAJOR_GIFT_THRESHOLD,
  getMajorGiftThreshold,
  clearMajorGiftThresholdCache,
  formatThresholdLabel,
} = mgService;

describe('majorGiftService.getMajorGiftThreshold', () => {
  beforeEach(() => {
    Tenant.findByPk.mockReset();
    clearMajorGiftThresholdCache();
  });

  test('returns configured value for a tenant', async () => {
    Tenant.findByPk.mockResolvedValue({ majorGiftThreshold: '500000' });
    expect(await getMajorGiftThreshold(42)).toBe(500000);
  });

  test('returns the default when tenant row has null threshold', async () => {
    Tenant.findByPk.mockResolvedValue({ majorGiftThreshold: null });
    expect(await getMajorGiftThreshold(42)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
  });

  test('returns the default when tenant is missing', async () => {
    Tenant.findByPk.mockResolvedValue(null);
    expect(await getMajorGiftThreshold(999)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
  });

  test('returns the default on DB error (never throws)', async () => {
    Tenant.findByPk.mockRejectedValue(new Error('db down'));
    expect(await getMajorGiftThreshold(7)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
  });

  test('rejects non-positive values (→ default)', async () => {
    Tenant.findByPk.mockResolvedValue({ majorGiftThreshold: '-1' });
    expect(await getMajorGiftThreshold(42)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
    clearMajorGiftThresholdCache();
    Tenant.findByPk.mockResolvedValue({ majorGiftThreshold: '0' });
    expect(await getMajorGiftThreshold(42)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
  });

  test('returns default when called with no tenantId', async () => {
    expect(await getMajorGiftThreshold(null)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
    expect(await getMajorGiftThreshold(undefined)).toBe(DEFAULT_MAJOR_GIFT_THRESHOLD);
    expect(Tenant.findByPk).not.toHaveBeenCalled();
  });

  test('caches results (only hits DB once per tenant within TTL)', async () => {
    Tenant.findByPk.mockResolvedValue({ majorGiftThreshold: '25000' });
    await getMajorGiftThreshold(1);
    await getMajorGiftThreshold(1);
    await getMajorGiftThreshold(1);
    expect(Tenant.findByPk).toHaveBeenCalledTimes(1);
  });

  test('clearMajorGiftThresholdCache(tenantId) forces refresh', async () => {
    Tenant.findByPk.mockResolvedValueOnce({ majorGiftThreshold: '25000' });
    expect(await getMajorGiftThreshold(1)).toBe(25000);

    clearMajorGiftThresholdCache(1);
    Tenant.findByPk.mockResolvedValueOnce({ majorGiftThreshold: '50000' });
    expect(await getMajorGiftThreshold(1)).toBe(50000);
  });
});

describe('formatThresholdLabel', () => {
  test.each([
    [10000, '$10,000+'],
    [500000, '$500,000+'],
    [5000, '$5,000+'],
    [1234.56, '$1,234.56+'],
    [100, '$100+'],
  ])('%s → %s', (input, expected) => {
    expect(formatThresholdLabel(input)).toBe(expected);
  });

  test('returns empty string for non-numeric input', () => {
    expect(formatThresholdLabel(NaN)).toBe('');
    expect(formatThresholdLabel(null)).toBe('');
    expect(formatThresholdLabel('abc')).toBe('');
  });
});
