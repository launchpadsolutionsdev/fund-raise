// Mock the models module so we can exercise the rendering helpers
// without a running database. Only the functions that touch the DB
// (pickTemplateForGift / renderForGift) use these mocks.
jest.mock('../../src/models', () => {
  return {
    ThankYouTemplate: { findOne: jest.fn() },
    Tenant: { findByPk: jest.fn() },
    CrmGift: { findOne: jest.fn() },
  };
});

const { ThankYouTemplate, Tenant, CrmGift } = require('../../src/models');
const svc = require('../../src/services/thankYouTemplateService');

describe('renderTemplateString', () => {
  test('substitutes known tokens', () => {
    expect(svc.renderTemplateString('Dear {{donor_first_name}},', { donor_first_name: 'Marian' }))
      .toBe('Dear Marian,');
  });

  test('tolerates whitespace inside braces', () => {
    expect(svc.renderTemplateString('{{ donor_name }}', { donor_name: 'Marian Boxer' }))
      .toBe('Marian Boxer');
  });

  test('unknown tokens become empty string (no raw leak)', () => {
    expect(svc.renderTemplateString('Hello {{unknown_token}}!', {})).toBe('Hello !');
  });

  test('null/undefined/empty input', () => {
    expect(svc.renderTemplateString('', {})).toBe('');
    expect(svc.renderTemplateString(null, {})).toBe('');
    expect(svc.renderTemplateString('no tokens here', {})).toBe('no tokens here');
  });

  test('resolves dot paths like gift.amount', () => {
    expect(svc.renderTemplateString('{{gift.amount}}', { gift: { amount: '$500' } }))
      .toBe('$500');
  });
});

describe('renderTemplate', () => {
  test('renders subject + body and lists missing tokens', () => {
    const r = svc.renderTemplate(
      { subject: 'Thanks for your gift to {{fund_name}}', body: 'Dear {{donor_first_name}},\n{{unknown_token}}' },
      { donor_first_name: 'Ali', fund_name: 'Cardiology Fund' }
    );
    expect(r.subject).toBe('Thanks for your gift to Cardiology Fund');
    expect(r.body).toBe('Dear Ali,\n');
    expect(r.missingTokens).toContain('unknown_token');
    expect(r.missingTokens).not.toContain('donor_first_name');
  });
});

describe('buildSampleContext', () => {
  test('includes all catalog tokens with non-empty values', () => {
    const ctx = svc.buildSampleContext('TBRHSF');
    const fields = svc.getSupportedMergeFields();
    for (const f of fields) {
      expect(ctx[f.token]).toBeDefined();
      expect(String(ctx[f.token]).length).toBeGreaterThan(0);
    }
    expect(ctx.organization_name).toBe('TBRHSF');
  });

  test('falls back to "Your Organization" when tenant name missing', () => {
    expect(svc.buildSampleContext().organization_name).toBe('Your Organization');
  });
});

describe('buildContextFromGift', () => {
  test('composes donor name + formats money & date', () => {
    const gift = {
      firstName: 'Marian', lastName: 'Boxer',
      giftAmount: 1500, giftDate: '2026-04-12',
      fundDescription: 'Cardiology Fund', campaignDescription: 'Cap Camp',
      appealDescription: 'Spring 2026', giftType: 'Cash',
      constituentCity: 'Thunder Bay', constituentState: 'ON',
    };
    const ctx = svc.buildContextFromGift(gift, { name: 'TBRHSF' });
    expect(ctx.donor_name).toBe('Marian Boxer');
    expect(ctx.donor_first_name).toBe('Marian');
    expect(ctx.donor_salutation).toBe('Dear Marian');
    expect(ctx.gift_amount).toMatch(/^\$1,500\.00$/);
    expect(ctx.gift_amount_plain).toBe('1500.00');
    expect(ctx.gift_date).toMatch(/April 12, 2026/);
    expect(ctx.fund_name).toBe('Cardiology Fund');
    expect(ctx.campaign_name).toBe('Cap Camp');
    expect(ctx.appeal_name).toBe('Spring 2026');
    expect(ctx.organization_name).toBe('TBRHSF');
  });

  test('falls back to Constituent #<id> when names blank', () => {
    const ctx = svc.buildContextFromGift({ constituentId: 'C-42' });
    expect(ctx.donor_name).toBe('Constituent #C-42');
    expect(ctx.donor_salutation).toBe('Dear Friend');
  });

  test('handles snake_case shapes from raw:true queries', () => {
    const ctx = svc.buildContextFromGift({
      first_name: 'A', last_name: 'B', gift_amount: 10, gift_date: '2026-01-01',
      fund_description: 'F',
    });
    expect(ctx.donor_name).toBe('A B');
    expect(ctx.gift_amount).toBe('$10.00');
    expect(ctx.fund_name).toBe('F');
  });
});

describe('pickTemplateForGift scope resolution', () => {
  beforeEach(() => {
    ThankYouTemplate.findOne.mockReset();
  });

  test('prefers fund match over campaign/appeal/default', async () => {
    ThankYouTemplate.findOne.mockResolvedValueOnce({ id: 'fund-tpl', scopeType: 'fund' });
    const t = await svc.pickTemplateForGift(1, { fundId: 'F1', campaignId: 'C1', appealId: 'A1' });
    expect(t.id).toBe('fund-tpl');
    expect(ThankYouTemplate.findOne).toHaveBeenCalledTimes(1);
    expect(ThankYouTemplate.findOne.mock.calls[0][0].where).toMatchObject({
      tenantId: 1, scopeType: 'fund', fundId: 'F1', isArchived: false,
    });
  });

  test('falls through to campaign when no fund match', async () => {
    ThankYouTemplate.findOne
      .mockResolvedValueOnce(null)                        // fund: none
      .mockResolvedValueOnce({ id: 'camp-tpl', scopeType: 'campaign' });
    const t = await svc.pickTemplateForGift(1, { fundId: 'F1', campaignId: 'C1', appealId: 'A1' });
    expect(t.id).toBe('camp-tpl');
    expect(ThankYouTemplate.findOne).toHaveBeenCalledTimes(2);
  });

  test('falls through to appeal when no fund/campaign match', async () => {
    ThankYouTemplate.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'app-tpl', scopeType: 'appeal' });
    const t = await svc.pickTemplateForGift(1, { fundId: 'F1', campaignId: 'C1', appealId: 'A1' });
    expect(t.id).toBe('app-tpl');
  });

  test('returns default when no scope matches', async () => {
    ThankYouTemplate.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'def-tpl', scopeType: 'default' });
    const t = await svc.pickTemplateForGift(1, { fundId: 'F1', campaignId: 'C1', appealId: 'A1' });
    expect(t.id).toBe('def-tpl');
  });

  test('returns null when no template exists at all', async () => {
    ThankYouTemplate.findOne.mockResolvedValue(null);
    expect(await svc.pickTemplateForGift(1, {})).toBeNull();
  });

  test('skips scope probes when the gift lacks that id', async () => {
    ThankYouTemplate.findOne.mockResolvedValueOnce({ id: 'def-tpl', scopeType: 'default' });
    await svc.pickTemplateForGift(1, {}); // no fund/campaign/appeal
    // Should jump straight to the default lookup (one call).
    expect(ThankYouTemplate.findOne).toHaveBeenCalledTimes(1);
    expect(ThankYouTemplate.findOne.mock.calls[0][0].where).toMatchObject({
      tenantId: 1, scopeType: 'default', isArchived: false,
    });
  });
});

describe('renderForGift end-to-end', () => {
  beforeEach(() => {
    CrmGift.findOne.mockReset();
    Tenant.findByPk.mockReset();
    ThankYouTemplate.findOne.mockReset();
  });

  test('returns fully-rendered letter', async () => {
    CrmGift.findOne.mockResolvedValue({
      tenantId: 1, giftId: 'G1', fundId: 'F1',
      firstName: 'Marian', lastName: 'Boxer',
      giftAmount: '1500', giftDate: '2026-04-12',
      fundDescription: 'Cardiology Fund',
    });
    Tenant.findByPk.mockResolvedValue({ name: 'TBRHSF' });
    ThankYouTemplate.findOne.mockResolvedValueOnce({
      id: 't1', scopeType: 'fund',
      subject: 'Thank you for supporting {{fund_name}}',
      body: 'Dear {{donor_first_name}},\nThank you for your {{gift_amount}} gift.',
    });

    const result = await svc.renderForGift(1, 'G1');
    expect(result.rendered.subject).toContain('Cardiology Fund');
    expect(result.rendered.body).toContain('Dear Marian');
    expect(result.rendered.body).toContain('$1,500.00');
  });

  test('returns null when gift not found', async () => {
    CrmGift.findOne.mockResolvedValue(null);
    expect(await svc.renderForGift(1, 'missing')).toBeNull();
  });

  test('returns template:null when no template matches', async () => {
    CrmGift.findOne.mockResolvedValue({ tenantId: 1, giftId: 'G1' });
    Tenant.findByPk.mockResolvedValue({ name: 'TBRHSF' });
    ThankYouTemplate.findOne.mockResolvedValue(null);
    const result = await svc.renderForGift(1, 'G1');
    expect(result.template).toBeNull();
    expect(result.rendered).toBeNull();
  });
});

describe('getSupportedMergeFields', () => {
  test('returns a catalog with non-empty entries', () => {
    const fields = svc.getSupportedMergeFields();
    expect(fields.length).toBeGreaterThan(5);
    for (const f of fields) {
      expect(f.token).toMatch(/^[a-z_]+$/);
      expect(f.label).toBeTruthy();
      expect(f.example).toBeTruthy();
    }
  });

  test('returns a fresh copy (mutations don\'t affect future calls)', () => {
    const a = svc.getSupportedMergeFields();
    a[0].token = 'mutated';
    const b = svc.getSupportedMergeFields();
    expect(b[0].token).not.toBe('mutated');
  });
});
