jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, _res, next) => {
    req.user = { id: 42, tenantId: 7, role: 'admin' };
    next();
  },
  ensureAdmin: (_req, _res, next) => next(),
  ensureUploader: (_req, _res, next) => next(),
}));

jest.mock('../../src/models', () => {
  const findOne = jest.fn();
  const findAndCountAll = jest.fn();
  const findAll = jest.fn();
  return {
    WritingOutput: { findOne, findAndCountAll },
    WritingTemplate: { findAll },
  };
});

const express = require('express');
const request = require('supertest');
const { Op } = require('sequelize');
const { WritingOutput, WritingTemplate } = require('../../src/models');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', require('../../src/routes/writingLibrary'));
  return app;
}

function makeOutput(overrides = {}) {
  const row = {
    id: 'abc-123',
    tenantId: 7,
    userId: 42,
    feature: 'thankYou',
    params: { letterStyle: 'warm' },
    generatedText: 'Thank you for your generosity.',
    model: 'claude-sonnet-4-6',
    rating: null,
    feedbackNote: null,
    isSaved: false,
    savedName: null,
    isHidden: false,
    createdAt: new Date('2026-04-14T12:00:00Z'),
    updatedAt: new Date('2026-04-14T12:00:00Z'),
    ...overrides,
  };
  // Sequelize rows expose .save() in real code; stub it here.
  row.save = jest.fn().mockImplementation(async function save() { return this; });
  return row;
}

describe('GET /api/writing/library', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('returns paginated list scoped to the current user', async () => {
    WritingOutput.findAndCountAll.mockResolvedValue({ rows: [makeOutput()], count: 1 });

    const res = await request(app).get('/api/writing/library');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);

    const args = WritingOutput.findAndCountAll.mock.calls[0][0];
    expect(args.where).toMatchObject({ tenantId: 7, userId: 42, isHidden: false });
    expect(args.limit).toBe(50);
    expect(args.offset).toBe(0);
    // Body is intentionally omitted from list payloads
    expect(args.attributes).not.toContain('generatedText');
  });

  it('filters by feature when given a valid feature', async () => {
    WritingOutput.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await request(app).get('/api/writing/library?feature=thankYou');
    expect(WritingOutput.findAndCountAll.mock.calls[0][0].where.feature).toBe('thankYou');
  });

  it('ignores an unknown feature filter', async () => {
    WritingOutput.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await request(app).get('/api/writing/library?feature=bogus');
    expect(WritingOutput.findAndCountAll.mock.calls[0][0].where.feature).toBeUndefined();
  });

  it('applies the saved-only filter', async () => {
    WritingOutput.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await request(app).get('/api/writing/library?saved=true');
    expect(WritingOutput.findAndCountAll.mock.calls[0][0].where.isSaved).toBe(true);
  });

  it('clamps limit to the 100 max', async () => {
    WritingOutput.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    await request(app).get('/api/writing/library?limit=9999');
    expect(WritingOutput.findAndCountAll.mock.calls[0][0].limit).toBe(100);
  });
});

describe('GET /api/writing/library/:id', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('returns the output when owned by the user', async () => {
    WritingOutput.findOne.mockResolvedValue(makeOutput());
    const res = await request(app).get('/api/writing/library/abc-123');
    expect(res.status).toBe(200);
    expect(res.body.generatedText).toContain('Thank you');
    expect(WritingOutput.findOne.mock.calls[0][0].where).toMatchObject({
      id: 'abc-123', tenantId: 7, userId: 42, isHidden: false,
    });
  });

  it('404s for missing or cross-tenant rows', async () => {
    WritingOutput.findOne.mockResolvedValue(null);
    const res = await request(app).get('/api/writing/library/missing');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/writing/library/:id/rate', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('sets a valid rating and feedback note', async () => {
    const row = makeOutput();
    WritingOutput.findOne.mockResolvedValue(row);

    const res = await request(app)
      .post('/api/writing/library/abc-123/rate')
      .send({ rating: 'helpful', feedbackNote: 'Perfect tone.' });

    expect(res.status).toBe(200);
    expect(row.rating).toBe('helpful');
    expect(row.feedbackNote).toBe('Perfect tone.');
    expect(row.save).toHaveBeenCalled();
  });

  it('accepts null to clear a rating', async () => {
    const row = makeOutput({ rating: 'helpful' });
    WritingOutput.findOne.mockResolvedValue(row);

    const res = await request(app)
      .post('/api/writing/library/abc-123/rate')
      .send({ rating: null });

    expect(res.status).toBe(200);
    expect(row.rating).toBeNull();
  });

  it('rejects invalid ratings', async () => {
    const res = await request(app)
      .post('/api/writing/library/abc-123/rate')
      .send({ rating: 'super-helpful' });

    expect(res.status).toBe(400);
    expect(WritingOutput.findOne).not.toHaveBeenCalled();
  });

  it('truncates feedback notes over 2000 chars', async () => {
    const row = makeOutput();
    WritingOutput.findOne.mockResolvedValue(row);
    const huge = 'x'.repeat(3000);

    await request(app)
      .post('/api/writing/library/abc-123/rate')
      .send({ rating: 'helpful', feedbackNote: huge });

    expect(row.feedbackNote.length).toBe(2000);
  });
});

describe('POST /api/writing/library/:id/save', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('marks the output saved and uses the provided name', async () => {
    const row = makeOutput();
    WritingOutput.findOne.mockResolvedValue(row);

    const res = await request(app)
      .post('/api/writing/library/abc-123/save')
      .send({ name: 'Thompson family — Cancer Care' });

    expect(res.status).toBe(200);
    expect(row.isSaved).toBe(true);
    expect(row.savedName).toBe('Thompson family — Cancer Care');
  });

  it('falls back to a default name when none provided', async () => {
    const row = makeOutput({ feature: 'thankYou' });
    WritingOutput.findOne.mockResolvedValue(row);

    await request(app).post('/api/writing/library/abc-123/save').send({});

    expect(row.isSaved).toBe(true);
    expect(row.savedName).toMatch(/Thank-You Letter/);
  });
});

describe('POST /api/writing/library/:id/unsave', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('clears the saved flag and name', async () => {
    const row = makeOutput({ isSaved: true, savedName: 'Keep me' });
    WritingOutput.findOne.mockResolvedValue(row);

    const res = await request(app).post('/api/writing/library/abc-123/unsave').send({});

    expect(res.status).toBe(200);
    expect(row.isSaved).toBe(false);
    expect(row.savedName).toBeNull();
  });
});

describe('DELETE /api/writing/library/:id', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('soft-deletes the row by setting is_hidden', async () => {
    const row = makeOutput({ isSaved: true });
    WritingOutput.findOne.mockResolvedValue(row);

    const res = await request(app).delete('/api/writing/library/abc-123');

    expect(res.status).toBe(200);
    expect(row.isHidden).toBe(true);
    expect(row.isSaved).toBe(false);
    expect(row.save).toHaveBeenCalled();
  });

  it('404s for a row owned by another user', async () => {
    WritingOutput.findOne.mockResolvedValue(null);
    const res = await request(app).delete('/api/writing/library/abc-123');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/writing/templates', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('rejects requests without a feature param', async () => {
    const res = await request(app).get('/api/writing/templates');
    expect(res.status).toBe(400);
    expect(WritingTemplate.findAll).not.toHaveBeenCalled();
  });

  it('rejects an unknown feature', async () => {
    const res = await request(app).get('/api/writing/templates?feature=bogus');
    expect(res.status).toBe(400);
    expect(WritingTemplate.findAll).not.toHaveBeenCalled();
  });

  it('returns merged platform + tenant templates for a known feature', async () => {
    WritingTemplate.findAll.mockResolvedValue([
      { id: 't1', scope: 'platform', name: 'Major Donor — Warm', icon: 'gem', params: { letterStyle: 'warm' }, sortOrder: 10 },
      { id: 't2', scope: 'tenant',   name: 'Our Custom Preset',  icon: null,  params: { letterStyle: 'formal' }, sortOrder: 5 },
    ]);

    const res = await request(app).get('/api/writing/templates?feature=thankYou');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].name).toBe('Major Donor — Warm');

    const where = WritingTemplate.findAll.mock.calls[0][0].where;
    expect(where.feature).toBe('thankYou');
    expect(where.isArchived).toBe(false);
    // The Op.or branch should match either platform rows, or tenant rows
    // scoped to the caller's tenantId (7 from our auth mock).
    expect(where[Op.or]).toEqual(expect.arrayContaining([
      { scope: 'platform' },
      { scope: 'tenant', tenantId: 7 },
    ]));
  });
});
