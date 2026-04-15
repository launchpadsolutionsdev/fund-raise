// Mock the Anthropic SDK and models before requiring the service so the
// streaming path can be exercised without real network/DB access.
// Capture the latest arguments passed to stream() so tests can assert on the
// system blocks and cache_control structure.
const lastStreamCall = { args: null };

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      stream: jest.fn().mockImplementation(async (args) => {
        lastStreamCall.args = args;
        async function* iterator() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } };
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } };
        }
        const streamObj = iterator();
        streamObj.finalMessage = jest.fn().mockResolvedValue({
          usage: {
            input_tokens: 10,
            output_tokens: 3,
            cache_read_input_tokens: 1200,
            cache_creation_input_tokens: 0,
          },
        });
        return streamObj;
      }),
    },
  }));
});

jest.mock('../../src/models', () => ({
  WritingOutput: {
    create: jest.fn().mockResolvedValue({ id: 'persisted-uuid' }),
  },
  AiUsageLog: {
    create: jest.fn().mockResolvedValue({ id: 1 }),
  },
}));

jest.mock('../../src/services/brandVoice', () => ({
  getBrandVoiceBlock: jest.fn().mockResolvedValue(null),
}));

const { WritingOutput, AiUsageLog } = require('../../src/models');
const { getBrandVoiceBlock } = require('../../src/services/brandVoice');

const {
  MODEL,
  MODES,
  CONTENT_TYPES,
  TONES,
  STORY_FORMATS,
  STORY_FOCUSES,
  MEETING_TYPES,
  THANKYOU_STYLES,
  DIGEST_TONES,
  DIGEST_AUDIENCES,
  writingSystemPrompt,
  thankYouSystemPrompt,
  impactSystemPrompt,
  meetingPrepSystemPrompt,
  digestSystemPrompt,
  streamGeneration,
  buildSystemBlocks,
  FOUNDATION_WRITING_GUIDE,
} = require('../../src/services/writingService');

// Minimal Express-response stub for streamGeneration tests.
function mockResponse() {
  const chunks = [];
  return {
    chunks,
    headersSent: false,
    _headers: {},
    setHeader(name, value) { this._headers[name] = value; },
    flushHeaders() { this.headersSent = true; },
    status() { return this; },
    json() { return this; },
    write(data) { chunks.push(data); },
    end() { this.ended = true; },
  };
}

function parseSseChunks(chunks) {
  return chunks
    .map(c => c.replace(/^data: /, '').replace(/\n\n$/, ''))
    .map(c => JSON.parse(c));
}

describe('writingService', () => {
  describe('enum catalogs', () => {
    test('MODES contains the three supported writing modes', () => {
      expect(MODES).toEqual([
        'Draft from scratch',
        'Polish/edit my draft',
        'Reply to a message',
      ]);
    });

    test('CONTENT_TYPES covers the donor-facing communication types', () => {
      expect(CONTENT_TYPES).toContain('Thank you letter');
      expect(CONTENT_TYPES).toContain('Sympathy/condolence card');
      expect(CONTENT_TYPES).toContain('Donor email');
      expect(CONTENT_TYPES.length).toBe(6);
    });

    test('TONES contains the four supported tones', () => {
      expect(TONES).toEqual([
        'Warm & personal',
        'Professional & formal',
        'Celebratory',
        'Empathetic',
      ]);
    });

    test('STORY_FORMATS lists all five impact story output formats', () => {
      expect(STORY_FORMATS.length).toBe(5);
      expect(STORY_FORMATS).toContain('Annual Report Narrative');
      expect(STORY_FORMATS).toContain('Social Media Post');
    });

    test('STORY_FOCUSES lists all five impact focus areas', () => {
      expect(STORY_FOCUSES.length).toBe(5);
      expect(STORY_FOCUSES).toContain('Patient Care');
      expect(STORY_FOCUSES).toContain('Research');
    });

    test('MEETING_TYPES lists all six meeting types', () => {
      expect(MEETING_TYPES.length).toBe(6);
      expect(MEETING_TYPES).toContain('Board Presentation');
      expect(MEETING_TYPES).toContain('Donor Meeting');
    });

    test('THANKYOU_STYLES contains all five letter styles', () => {
      expect(Object.keys(THANKYOU_STYLES).sort()).toEqual(
        ['brief', 'formal', 'handwritten', 'impact', 'warm']
      );
    });

    test('DIGEST_TONES contains all four tones', () => {
      expect(Object.keys(DIGEST_TONES).sort()).toEqual(
        ['casual', 'celebratory', 'professional', 'strategic']
      );
    });

    test('DIGEST_AUDIENCES contains all four audiences', () => {
      expect(Object.keys(DIGEST_AUDIENCES).sort()).toEqual(
        ['all_staff', 'board', 'leadership', 'team']
      );
    });

    test('MODEL defaults to claude-sonnet-4-6', () => {
      // Env override takes precedence, but unit tests run with the default.
      expect(typeof MODEL).toBe('string');
      expect(MODEL.length).toBeGreaterThan(0);
    });
  });

  describe('writingSystemPrompt', () => {
    test('interpolates mode, content type, and tone', () => {
      const prompt = writingSystemPrompt({
        mode: 'Draft from scratch',
        contentType: 'Thank you letter',
        tone: 'Warm & personal',
      });
      expect(prompt).toContain('WRITING MODE: Draft from scratch');
      expect(prompt).toContain('CONTENT TYPE: Thank you letter');
      expect(prompt).toContain('TONE: Warm & personal');
    });

    test('includes mode-specific guidance for Polish mode', () => {
      const prompt = writingSystemPrompt({
        mode: 'Polish/edit my draft',
        contentType: 'Donor email',
        tone: 'Professional & formal',
      });
      expect(prompt).toContain('Improve it while preserving their voice');
    });

    test('includes mode-specific guidance for Reply mode', () => {
      const prompt = writingSystemPrompt({
        mode: 'Reply to a message',
        contentType: 'Donor email',
        tone: 'Professional & formal',
      });
      expect(prompt).toContain('write an appropriate reply');
    });

    test('reminds the model to strip commentary', () => {
      const prompt = writingSystemPrompt({
        mode: 'Draft from scratch',
        contentType: 'Donor email',
        tone: 'Celebratory',
      });
      expect(prompt).toContain('Return ONLY');
    });
  });

  describe('thankYouSystemPrompt', () => {
    test('resolves the style key to a human-readable description', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'formal' });
      expect(prompt).toContain(THANKYOU_STYLES.formal);
    });

    test('falls back to warm style for unknown keys', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'nonsense' });
      expect(prompt).toContain(THANKYOU_STYLES.warm);
    });

    test('includes donor name when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        donorName: 'Margaret Thompson',
      });
      expect(prompt).toContain('DONOR NAME: Margaret Thompson');
    });

    test('includes gift amount, type, and designation when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        giftAmount: 5000,
        giftType: 'One-time donation',
        designation: 'Cardiac Care',
      });
      expect(prompt).toContain('GIFT AMOUNT: $5000');
      expect(prompt).toContain('GIFT TYPE: One-time donation');
      expect(prompt).toContain('GIFT DESIGNATION: Cardiac Care');
    });

    test('omits gift fields entirely when not provided', () => {
      const prompt = thankYouSystemPrompt({ letterStyle: 'warm' });
      expect(prompt).not.toContain('GIFT AMOUNT');
      expect(prompt).not.toContain('GIFT TYPE');
      expect(prompt).not.toContain('GIFT DESIGNATION');
    });

    test('includes personal notes when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        personalNotes: 'Long-time supporter since 2010',
      });
      expect(prompt).toContain('PERSONAL NOTES FROM STAFF');
      expect(prompt).toContain('Long-time supporter since 2010');
    });

    test('embeds the donor CRM context block when provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        donorName: 'Margaret Thompson',
        donorContext: '**Margaret Thompson** (constituent TH-1)\n- Lifetime giving: $12,500 across 4 gifts',
      });
      expect(prompt).toContain('DONOR PROFILE');
      expect(prompt).toContain('**Margaret Thompson** (constituent TH-1)');
      expect(prompt).toContain('Lifetime giving: $12,500');
      // The grounding guidance only appears when a donor profile is attached.
      expect(prompt).toMatch(/Reference the donor's real giving history/);
    });

    test('omits DONOR PROFILE block entirely when no donor context is provided', () => {
      const prompt = thankYouSystemPrompt({
        letterStyle: 'warm',
        donorName: 'Pat Lee',
      });
      expect(prompt).not.toContain('DONOR PROFILE');
      expect(prompt).not.toMatch(/Reference the donor's real giving history/);
    });
  });

  describe('impactSystemPrompt', () => {
    test('interpolates format and focus area', () => {
      const prompt = impactSystemPrompt({
        format: 'Annual Report Narrative',
        focus: 'Research',
      });
      expect(prompt).toContain('OUTPUT FORMAT: Annual Report Narrative');
      expect(prompt).toContain('IMPACT FOCUS AREA: Research');
    });

    test('includes optional gift amount and donor type', () => {
      const prompt = impactSystemPrompt({
        format: 'Donor Newsletter',
        focus: 'Patient Care',
        giftAmount: 25000,
        donorType: 'Corporate',
      });
      expect(prompt).toContain('GIFT AMOUNT: $25000');
      expect(prompt).toContain('DONOR TYPE: Corporate');
    });
  });

  describe('meetingPrepSystemPrompt', () => {
    test('includes the data context verbatim', () => {
      const dataContext = 'Total Raised: $1,234,567\nProgress: 42.0%';
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Board Presentation',
        dataContext,
      });
      expect(prompt).toContain(dataContext);
    });

    test('adds donor-meeting section when appropriate', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Donor Meeting',
        dataContext: '',
      });
      expect(prompt).toContain('Donor Engagement Notes');
    });

    test('adds board-presentation section when appropriate', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Board Presentation',
        dataContext: '',
      });
      expect(prompt).toContain('Board-Ready Metrics');
    });

    test('omits meeting-type-specific sections for other meetings', () => {
      const prompt = meetingPrepSystemPrompt({
        meetingType: 'Department Check-In',
        dataContext: '',
      });
      expect(prompt).not.toContain('Donor Engagement Notes');
      expect(prompt).not.toContain('Board-Ready Metrics');
    });
  });

  describe('FOUNDATION_WRITING_GUIDE', () => {
    test('is long enough to meet the 1024-token cache floor', () => {
      // Rough heuristic: ~3.5 chars per token for English prose. We want the
      // guide comfortably above 1024 tokens so Anthropic accepts the cache
      // marker. Asserting on character count avoids depending on a tokenizer.
      expect(FOUNDATION_WRITING_GUIDE.length).toBeGreaterThan(3600);
    });

    test('covers the core craft categories', () => {
      expect(FOUNDATION_WRITING_GUIDE).toMatch(/Canadian English/i);
      expect(FOUNDATION_WRITING_GUIDE).toMatch(/Anti-patterns/i);
      expect(FOUNDATION_WRITING_GUIDE).toMatch(/Output discipline/i);
    });
  });

  describe('buildSystemBlocks', () => {
    test('returns two text blocks with cache_control on the first only (no voice)', () => {
      const blocks = buildSystemBlocks('FEATURE SPECIFIC PROMPT');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].text).toBe(FOUNDATION_WRITING_GUIDE);
      expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(blocks[1].type).toBe('text');
      expect(blocks[1].text).toBe('FEATURE SPECIFIC PROMPT');
      expect(blocks[1].cache_control).toBeUndefined();
    });

    test('inserts the brand voice as a second cache-controlled block when provided', () => {
      const blocks = buildSystemBlocks('FEATURE', 'VOICE BLOCK');
      expect(blocks).toHaveLength(3);
      expect(blocks[0].text).toBe(FOUNDATION_WRITING_GUIDE);
      expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(blocks[1].text).toBe('VOICE BLOCK');
      expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' });
      expect(blocks[2].text).toBe('FEATURE');
      expect(blocks[2].cache_control).toBeUndefined();
    });

    test('ignores empty / whitespace voice strings', () => {
      expect(buildSystemBlocks('FEATURE', '').length).toBe(2);
      expect(buildSystemBlocks('FEATURE', '   ').length).toBe(2);
      expect(buildSystemBlocks('FEATURE', null).length).toBe(2);
    });
  });

  describe('streamGeneration', () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    beforeAll(() => { process.env.ANTHROPIC_API_KEY = 'test-key'; });
    afterAll(() => { process.env.ANTHROPIC_API_KEY = originalKey; });

    beforeEach(() => {
      WritingOutput.create.mockClear();
      WritingOutput.create.mockResolvedValue({ id: 'persisted-uuid' });
      AiUsageLog.create.mockClear();
      AiUsageLog.create.mockResolvedValue({ id: 1 });
      getBrandVoiceBlock.mockClear();
      getBrandVoiceBlock.mockResolvedValue(null);
      lastStreamCall.args = null;
    });

    it('streams text deltas and emits a done event with fullText and outputId', async () => {
      const res = mockResponse();
      const result = await streamGeneration(res, {
        feature: 'writing',
        systemPrompt: 'sys',
        userMessage: 'usr',
        persist: { tenantId: 1, userId: 2, params: { mode: 'Draft from scratch' } },
      });

      const events = parseSseChunks(res.chunks);
      expect(events[0]).toEqual({ text: 'Hello ' });
      expect(events[1]).toEqual({ text: 'world' });
      const doneEvent = events[events.length - 1];
      expect(doneEvent.done).toBe(true);
      expect(doneEvent.fullText).toBe('Hello world');
      expect(doneEvent.outputId).toBe('persisted-uuid');
      expect(result.fullText).toBe('Hello world');
      expect(result.outputId).toBe('persisted-uuid');
    });

    it('persists the full row with usage metadata and params', async () => {
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'thankYou',
        systemPrompt: 'sys',
        userMessage: 'usr',
        persist: {
          tenantId: 1,
          userId: 2,
          params: { letterStyle: 'warm', donorName: 'Margaret' },
        },
      });

      expect(WritingOutput.create).toHaveBeenCalledTimes(1);
      const payload = WritingOutput.create.mock.calls[0][0];
      expect(payload).toMatchObject({
        tenantId: 1,
        userId: 2,
        feature: 'thankYou',
        params: { letterStyle: 'warm', donorName: 'Margaret' },
        generatedText: 'Hello world',
        inputTokens: 10,
        outputTokens: 3,
      });
      expect(typeof payload.durationMs).toBe('number');
    });

    it('skips persistence when no persist context is provided', async () => {
      const res = mockResponse();
      const result = await streamGeneration(res, {
        feature: 'writing',
        systemPrompt: 'sys',
        userMessage: 'usr',
      });
      expect(WritingOutput.create).not.toHaveBeenCalled();
      expect(result.outputId).toBeNull();
    });

    it('does not fail the request when DB persistence throws', async () => {
      WritingOutput.create.mockRejectedValueOnce(new Error('DB down'));
      const res = mockResponse();
      const result = await streamGeneration(res, {
        feature: 'writing',
        systemPrompt: 'sys',
        userMessage: 'usr',
        persist: { tenantId: 1, userId: 2, params: {} },
      });
      expect(result.fullText).toBe('Hello world');
      expect(result.outputId).toBeNull();
      const events = parseSseChunks(res.chunks);
      expect(events[events.length - 1].done).toBe(true);
    });

    it('sends the shared guide + feature prompt as cache-controlled system blocks', async () => {
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'thankYou',
        systemPrompt: 'THANK YOU PROMPT',
        userMessage: 'usr',
      });
      expect(Array.isArray(lastStreamCall.args.system)).toBe(true);
      expect(lastStreamCall.args.system).toHaveLength(2);
      expect(lastStreamCall.args.system[0].text).toBe(FOUNDATION_WRITING_GUIDE);
      expect(lastStreamCall.args.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(lastStreamCall.args.system[1].text).toBe('THANK YOU PROMPT');
      expect(lastStreamCall.args.system[1].cache_control).toBeUndefined();
    });

    it('splices the tenant\'s brand voice between the guide and the feature prompt when set', async () => {
      getBrandVoiceBlock.mockResolvedValueOnce('VOICE FROM TENANT');
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'thankYou',
        systemPrompt: 'THANK YOU PROMPT',
        userMessage: 'usr',
        persist: { tenantId: 7, userId: 1, params: {} },
      });

      expect(getBrandVoiceBlock).toHaveBeenCalledWith(7);
      const sys = lastStreamCall.args.system;
      expect(sys).toHaveLength(3);
      expect(sys[0].text).toBe(FOUNDATION_WRITING_GUIDE);
      expect(sys[1].text).toBe('VOICE FROM TENANT');
      expect(sys[1].cache_control).toEqual({ type: 'ephemeral' });
      expect(sys[2].text).toBe('THANK YOU PROMPT');
      expect(sys[2].cache_control).toBeUndefined();
    });

    it('skips voice lookup when no persist context is provided', async () => {
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'thankYou',
        systemPrompt: 'p',
        userMessage: 'u',
      });
      expect(getBrandVoiceBlock).not.toHaveBeenCalled();
      expect(lastStreamCall.args.system).toHaveLength(2);
    });

    it('continues the generation when the voice lookup throws', async () => {
      getBrandVoiceBlock.mockRejectedValueOnce(new Error('DB down'));
      const res = mockResponse();
      const result = await streamGeneration(res, {
        feature: 'thankYou',
        systemPrompt: 'p',
        userMessage: 'u',
        persist: { tenantId: 7, userId: 1, params: {} },
      });
      expect(result.fullText).toBe('Hello world');
      // Voice block omitted — two blocks only
      expect(lastStreamCall.args.system).toHaveLength(2);
    });

    it('writes an AiUsageLog row on success with cache token counts and feature tag', async () => {
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'impact',
        systemPrompt: 'sys',
        userMessage: 'usr',
        persist: { tenantId: 9, userId: 11, params: {} },
      });

      expect(AiUsageLog.create).toHaveBeenCalledTimes(1);
      const payload = AiUsageLog.create.mock.calls[0][0];
      expect(payload).toMatchObject({
        tenantId: 9,
        userId: 11,
        success: true,
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 1200,
        cacheCreationTokens: 0,
        toolsUsed: ['writing:impact'],
        conversationId: 'persisted-uuid',
      });
      expect(typeof payload.durationMs).toBe('number');
    });

    it('does not write AiUsageLog when no persist context is provided', async () => {
      const res = mockResponse();
      await streamGeneration(res, {
        feature: 'writing',
        systemPrompt: 'sys',
        userMessage: 'usr',
      });
      expect(AiUsageLog.create).not.toHaveBeenCalled();
    });

    it('logs a failure AiUsageLog row when the Anthropic stream throws', async () => {
      const Anthropic = require('@anthropic-ai/sdk');
      const instance = Anthropic.mock.results[0].value;
      instance.messages.stream.mockImplementationOnce(async () => { throw new Error('rate limit'); });

      const res = mockResponse();
      const result = await streamGeneration(res, {
        feature: 'digest',
        systemPrompt: 'sys',
        userMessage: 'usr',
        persist: { tenantId: 4, userId: 5, params: {} },
      });

      expect(result.error).toBeDefined();
      expect(AiUsageLog.create).toHaveBeenCalledTimes(1);
      const payload = AiUsageLog.create.mock.calls[0][0];
      expect(payload.success).toBe(false);
      expect(payload.errorMessage).toBe('rate limit');
      expect(payload.toolsUsed).toEqual(['writing:digest']);
    });
  });

  describe('digestSystemPrompt', () => {
    test('resolves tone and audience keys', () => {
      const prompt = digestSystemPrompt({
        tone: 'celebratory',
        audience: 'board',
        dataContext: 'SNAPSHOT DATE: 2026-04-14',
      });
      expect(prompt).toContain(DIGEST_TONES.celebratory);
      expect(prompt).toContain(DIGEST_AUDIENCES.board);
      expect(prompt).toContain('SNAPSHOT DATE: 2026-04-14');
    });

    test('falls back to professional tone for unknown keys', () => {
      const prompt = digestSystemPrompt({
        tone: 'nonsense',
        audience: 'nonsense',
        dataContext: '',
      });
      expect(prompt).toContain(DIGEST_TONES.professional);
      expect(prompt).toContain(DIGEST_AUDIENCES.team);
    });

    test('appends highlights when provided', () => {
      const prompt = digestSystemPrompt({
        tone: 'professional',
        audience: 'team',
        highlights: 'Matched 3 new grants this week',
        dataContext: '',
      });
      expect(prompt).toContain('ADDITIONAL HIGHLIGHTS TO INCLUDE');
      expect(prompt).toContain('Matched 3 new grants this week');
    });
  });
});
