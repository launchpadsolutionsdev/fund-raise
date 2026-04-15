// Route-level tests for the donor search + profile endpoints. We mock the
// donor context service so we can focus on the route wiring: auth scoping,
// error paths, and parameter hand-off.

jest.mock('../../src/middleware/auth', () => ({
  ensureAuth: (req, _res, next) => {
    req.user = { id: 42, tenantId: 7, role: 'admin' };
    next();
  },
  ensureAdmin: (_req, _res, next) => next(),
  ensureUploader: (_req, _res, next) => next(),
}));

jest.mock('../../src/services/aiRateLimit', () => ({
  aiRateLimitMiddleware: (_req, _res, next) => next(),
}));

jest.mock('../../src/services/donorContext', () => ({
  searchDonors: jest.fn(),
  getDonorProfile: jest.fn(),
}));

// The generate route pulls these in; stub them to prevent real imports.
// The real streamGeneration writes the SSE response itself, so our mock must
// also close the response — otherwise supertest hangs waiting for headers.
jest.mock('../../src/services/writingService', () => ({
  streamGeneration: jest.fn().mockImplementation(async (res) => {
    res.status(200).end();
    return { fullText: '', outputId: null };
  }),
  thankYouSystemPrompt: jest.fn().mockReturnValue('system prompt'),
  THANKYOU_STYLES: { warm: 'Warm and personal', formal: 'Formal and traditional' },
}));

const express = require('express');
const request = require('supertest');
const { searchDonors, getDonorProfile } = require('../../src/services/donorContext');
const { streamGeneration, thankYouSystemPrompt } = require('../../src/services/writingService');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', require('../../src/routes/thankYou'));
  return app;
}

describe('GET /api/thank-you/donors', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('passes tenantId and query to the service and returns results', async () => {
    searchDonors.mockResolvedValue([
      { constituentId: 'TH-1', displayName: 'Margaret Thompson', totalGifts: 4, totalGiven: 12500 },
    ]);

    const res = await request(app).get('/api/thank-you/donors?q=Thompson');

    expect(res.status).toBe(200);
    expect(res.body.donors).toHaveLength(1);
    expect(res.body.donors[0].displayName).toBe('Margaret Thompson');
    expect(searchDonors).toHaveBeenCalledWith(7, 'Thompson', expect.objectContaining({ limit: undefined }));
  });

  it('returns 500 with a client-safe message when the service throws', async () => {
    searchDonors.mockRejectedValue(new Error('DB down'));
    const res = await request(app).get('/api/thank-you/donors?q=Thompson');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to search donors/);
    // Internal error text should not leak to the client
    expect(JSON.stringify(res.body)).not.toContain('DB down');
  });
});

describe('GET /api/thank-you/donors/:constituentId', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('returns the profile when found', async () => {
    getDonorProfile.mockResolvedValue({
      donor: { constituentId: 'TH-1', displayName: 'Margaret Thompson' },
      mostRecentGift: { amount: 5000 },
      topFunds: ['Cardiac Care'],
      contextString: '**Margaret Thompson**',
      uiPrefill: { donorName: 'Ms. Margaret Thompson', giftAmount: 5000, designation: 'Cardiac Care' },
    });

    const res = await request(app).get('/api/thank-you/donors/TH-1');

    expect(res.status).toBe(200);
    expect(res.body.donor.displayName).toBe('Margaret Thompson');
    expect(res.body.uiPrefill.giftAmount).toBe(5000);
    expect(getDonorProfile).toHaveBeenCalledWith(7, 'TH-1');
  });

  it('404s when the service returns null', async () => {
    getDonorProfile.mockResolvedValue(null);
    const res = await request(app).get('/api/thank-you/donors/TH-missing');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/thank-you/generate with constituentId', () => {
  let app;
  beforeEach(() => {
    jest.clearAllMocks();
    app = createApp();
  });

  it('looks up the donor, feeds context into the prompt, and persists constituentId', async () => {
    getDonorProfile.mockResolvedValue({
      donor: { constituentId: 'TH-1' },
      mostRecentGift: { amount: 5000 },
      topFunds: [],
      contextString: 'DONOR CONTEXT STRING',
      uiPrefill: { donorName: 'Ms. Margaret Thompson', giftAmount: 5000, designation: 'Cardiac Care' },
    });

    const res = await request(app)
      .post('/api/thank-you/generate')
      .send({
        letterStyle: 'warm',
        constituentId: 'TH-1',
        giftAmount: '5000',
      });

    // streamGeneration is mocked, so no SSE response body — but we can
    // verify the call shape.
    expect(res.status).toBe(200);
    expect(getDonorProfile).toHaveBeenCalledWith(7, 'TH-1');

    expect(thankYouSystemPrompt).toHaveBeenCalledTimes(1);
    const promptArgs = thankYouSystemPrompt.mock.calls[0][0];
    expect(promptArgs.donorContext).toBe('DONOR CONTEXT STRING');
    // Server-side resolved donor name wins when the form left it blank.
    expect(promptArgs.donorName).toBe('Ms. Margaret Thompson');

    expect(streamGeneration).toHaveBeenCalledTimes(1);
    const streamArgs = streamGeneration.mock.calls[0][1];
    expect(streamArgs.persist.params.constituentId).toBe('TH-1');
    expect(streamArgs.persist.params.donorName).toBe('Ms. Margaret Thompson');
  });

  it('prefers the form-entered donor name over the CRM-resolved one', async () => {
    getDonorProfile.mockResolvedValue({
      donor: { constituentId: 'TH-1' },
      mostRecentGift: null, topFunds: [],
      contextString: 'CTX',
      uiPrefill: { donorName: 'Ms. Margaret Thompson', giftAmount: null, designation: null },
    });

    await request(app)
      .post('/api/thank-you/generate')
      .send({
        letterStyle: 'warm',
        constituentId: 'TH-1',
        donorName: 'Margie',
      });

    expect(thankYouSystemPrompt.mock.calls[0][0].donorName).toBe('Margie');
  });

  it('falls back cleanly when the donor lookup fails', async () => {
    getDonorProfile.mockRejectedValue(new Error('DB down'));

    const res = await request(app)
      .post('/api/thank-you/generate')
      .send({
        letterStyle: 'warm',
        constituentId: 'TH-1',
        donorName: 'Margie',
      });

    // Still succeeds — just with no donor context
    expect(res.status).toBe(200);
    expect(streamGeneration).toHaveBeenCalledTimes(1);
    const promptArgs = thankYouSystemPrompt.mock.calls[0][0];
    expect(promptArgs.donorContext).toBeNull();
    expect(promptArgs.donorName).toBe('Margie');
  });

  it('rejects when letterStyle is missing', async () => {
    const res = await request(app)
      .post('/api/thank-you/generate')
      .send({ constituentId: 'TH-1' });
    expect(res.status).toBe(400);
    expect(streamGeneration).not.toHaveBeenCalled();
  });
});
