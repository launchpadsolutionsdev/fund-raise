// Route-level tests for the brand voice admin API. Covers normalisation,
// admin gating, and the upsert code path.

jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, _res, next) => {
    req.user = req._testUser || { id: 42, tenantId: 7, role: 'admin' };
    next();
  },
  ensureAdmin: (_req, _res, next) => next(),
  ensureUploader: (_req, _res, next) => next(),
}));

jest.mock('../../src/models', () => ({
  TenantBrandVoice: {
    findOne: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
}));

const express = require('express');
const request = require('supertest');
const { TenantBrandVoice } = require('../../src/models');

function createApp(user) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => { req._testUser = user; next(); });
  }
  app.use('/', require('../../src/routes/brandVoice'));
  return app;
}

describe('GET /api/brand-voice', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns the current voice row', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ toneDescription: 'warm' });
    const res = await request(createApp()).get('/api/brand-voice');
    expect(res.status).toBe(200);
    expect(res.body.voice.toneDescription).toBe('warm');
  });

  it('returns null voice when none configured', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    const res = await request(createApp()).get('/api/brand-voice');
    expect(res.status).toBe(200);
    expect(res.body.voice).toBeNull();
  });

  it('is readable by non-admins (writing generation needs this)', async () => {
    TenantBrandVoice.findOne.mockResolvedValue({ toneDescription: 'warm' });
    const res = await request(createApp({ id: 1, tenantId: 7, role: 'staff' }))
      .get('/api/brand-voice');
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/brand-voice', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('rejects non-admins', async () => {
    const res = await request(createApp({ id: 1, tenantId: 7, role: 'staff' }))
      .put('/api/brand-voice')
      .send({ toneDescription: 'warm' });
    expect(res.status).toBe(403);
    expect(TenantBrandVoice.findOne).not.toHaveBeenCalled();
  });

  it('creates a new row when none exists', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    const res = await request(createApp())
      .put('/api/brand-voice')
      .send({
        toneDescription: 'Warm and direct.',
        organizationValues: ['community-first'],
      });

    expect(res.status).toBe(200);
    const payload = TenantBrandVoice.create.mock.calls[0][0];
    expect(payload.tenantId).toBe(7);
    expect(payload.toneDescription).toBe('Warm and direct.');
    expect(payload.organizationValues).toEqual(['community-first']);
    expect(payload.updatedById).toBe(42);
    expect(payload.isActive).toBe(true);
  });

  it('updates the existing row in place', async () => {
    const updateFn = jest.fn(async function (data) { return { ...this, ...data }; });
    const existing = { tenantId: 7, toneDescription: 'old', update: updateFn };
    TenantBrandVoice.findOne.mockResolvedValue(existing);

    const res = await request(createApp())
      .put('/api/brand-voice')
      .send({ toneDescription: 'new' });

    expect(res.status).toBe(200);
    expect(updateFn).toHaveBeenCalledTimes(1);
    expect(TenantBrandVoice.create).not.toHaveBeenCalled();
    expect(updateFn.mock.calls[0][0].toneDescription).toBe('new');
  });

  it('clamps overlong strings and oversized lists', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    const hugeTone = 'x'.repeat(5000);
    const hugeList = Array.from({ length: 500 }, (_, i) => 'item-' + i);

    await request(createApp())
      .put('/api/brand-voice')
      .send({
        toneDescription: hugeTone,
        organizationValues: hugeList,
        bannedPhrases: hugeList,
      });

    const payload = TenantBrandVoice.create.mock.calls[0][0];
    // Tone clamped to MAX_TONE (2000)
    expect(payload.toneDescription.length).toBe(2000);
    // Lists clamped to MAX_LIST_ITEMS (100)
    expect(payload.organizationValues.length).toBe(100);
    expect(payload.bannedPhrases.length).toBe(100);
  });

  it('normalises preferred terms and drops incomplete pairs', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    await request(createApp())
      .put('/api/brand-voice')
      .send({
        preferredTerms: [
          { from: 'donor', to: 'partner' },
          { from: 'donation', to: '' },
          { from: '', to: 'gift' },
          null,
          'not-an-object',
        ],
      });

    const payload = TenantBrandVoice.create.mock.calls[0][0];
    expect(payload.preferredTerms).toEqual([{ from: 'donor', to: 'partner' }]);
  });

  it('treats isActive=false as explicit kill switch', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    await request(createApp())
      .put('/api/brand-voice')
      .send({ toneDescription: 'x', isActive: false });

    expect(TenantBrandVoice.create.mock.calls[0][0].isActive).toBe(false);
  });

  it('defaults useExemplars to true when not specified in the payload', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    await request(createApp())
      .put('/api/brand-voice')
      .send({ toneDescription: 'x' });

    expect(TenantBrandVoice.create.mock.calls[0][0].useExemplars).toBe(true);
  });

  it('persists useExemplars=false when admin opts the tenant out', async () => {
    TenantBrandVoice.findOne.mockResolvedValue(null);
    TenantBrandVoice.create.mockImplementation(async (data) => ({ id: 'new', ...data }));

    await request(createApp())
      .put('/api/brand-voice')
      .send({ toneDescription: 'x', useExemplars: false });

    expect(TenantBrandVoice.create.mock.calls[0][0].useExemplars).toBe(false);
  });
});

describe('DELETE /api/brand-voice', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('rejects non-admins', async () => {
    const res = await request(createApp({ id: 1, tenantId: 7, role: 'staff' }))
      .delete('/api/brand-voice');
    expect(res.status).toBe(403);
    expect(TenantBrandVoice.destroy).not.toHaveBeenCalled();
  });

  it('deletes the row scoped to the caller\'s tenant', async () => {
    TenantBrandVoice.destroy.mockResolvedValue(1);
    const res = await request(createApp()).delete('/api/brand-voice');
    expect(res.status).toBe(200);
    expect(TenantBrandVoice.destroy).toHaveBeenCalledWith({ where: { tenantId: 7 } });
  });
});
