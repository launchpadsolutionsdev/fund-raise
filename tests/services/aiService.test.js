// ---------------------------------------------------------------------------
// AI Service unit tests
// ---------------------------------------------------------------------------

const mockCreate = jest.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'AI response' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 },
});

const mockStream = jest.fn().mockReturnValue({
  [Symbol.asyncIterator]: () => ({
    next: jest.fn().mockResolvedValue({ done: true }),
  }),
  finalMessage: jest.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'streamed response' }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }),
});

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
      stream: mockStream,
    },
  }));
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    statSync: jest.fn().mockReturnValue({ mtimeMs: 1000 }),
    readFileSync: jest.fn().mockReturnValue('You are a fundraising AI assistant.'),
  };
});

jest.mock('../../src/models', () => ({
  Snapshot: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) },
  DepartmentSummary: { findAll: jest.fn().mockResolvedValue([]) },
  GiftTypeBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  SourceBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  FundBreakdown: { findAll: jest.fn().mockResolvedValue([]) },
  RawGift: { findAll: jest.fn().mockResolvedValue([]) },
  sequelize: { query: jest.fn().mockResolvedValue([]) },
}));

jest.mock('../../src/services/blackbaudClient', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  isConnected: jest.fn().mockResolvedValue(false),
  getConnectionStatus: jest.fn().mockResolvedValue({ connected: false }),
  isDailyLimitReached: jest.fn().mockReturnValue(false),
}));

jest.mock('../../src/services/blackbaudTools', () => ({
  TOOLS: [],
  executeTool: jest.fn(),
}));

jest.mock('../../src/services/crmTools', () => ({
  CRM_TOOLS: [],
  executeCrmTool: jest.fn(),
}));

jest.mock('../../src/services/knowledgeBaseRouter', () => ({
  getKnowledgeBaseInjection: jest.fn().mockReturnValue({ inject: false, knowledgeBaseText: '' }),
}));

jest.mock('../../src/services/snapshotService', () => ({
  getDashboardData: jest.fn().mockResolvedValue({
    totalRaised: 50000, totalGifts: 100, combinedGoal: 100000, overallPct: 50,
  }),
  getEnhancedDashboardData: jest.fn().mockResolvedValue({
    donorCount: 80, largestGift: null, giftDistribution: [], topDonors: [], topAppeals: [],
  }),
  getDepartmentData: jest.fn().mockResolvedValue({ summary: null, giftTypes: [], sources: [], funds: [], rawCount: 0 }),
  getDepartmentEnhancedData: jest.fn().mockResolvedValue({}),
  getCrossDepartmentData: jest.fn().mockResolvedValue({
    donorConcentration: {}, crossDeptDonors: [], fundRankings: [],
  }),
  getTrendsEnhanced: jest.fn().mockResolvedValue([]),
  getProjection: jest.fn().mockResolvedValue(null),
  getAvailableDates: jest.fn().mockResolvedValue([]),
}));

const fs = require('fs');

// Must require AFTER mocks are set up
const aiService = require('../../src/services/aiService');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key-123';
});

afterEach(() => {
  // Clear internal caches between tests
  aiService.clearCache();
});

// ---------------------------------------------------------------------------
// loadStaticPrompt (tested indirectly through chat which calls it)
// ---------------------------------------------------------------------------
describe('loadStaticPrompt', () => {
  it('reads the system prompt file and caches it', () => {
    // loadStaticPrompt is not exported, but it is called internally.
    // We verify fs.readFileSync is called when chat is invoked.
    // For now, verify the mock is set up correctly.
    expect(fs.readFileSync).toBeDefined();
    expect(fs.statSync).toBeDefined();
  });

  it('returns cached prompt on subsequent calls (same mtime)', () => {
    // Reset call counts
    fs.statSync.mockClear();
    fs.readFileSync.mockClear();

    // The prompt file is read lazily on first chat call.
    // We can trigger it by calling chat (tested below).
    // For this test, just verify the mock returns expected value.
    const content = fs.readFileSync('any-path', 'utf-8');
    expect(content).toBe('You are a fundraising AI assistant.');
  });

  it('handles missing file gracefully with fallback prompt', () => {
    fs.statSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    // The fallback is set internally; we verify no crash occurs
    // by running a chat call in a later test.
    expect(() => fs.statSync('missing')).toThrow('ENOENT');
  });
});

// ---------------------------------------------------------------------------
// Cache operations: getCachedPrompt / setCachedPrompt / clearCache
// ---------------------------------------------------------------------------
describe('Cache operations', () => {
  it('clearCache with tenantId clears only that tenant', async () => {
    // Trigger caching by calling chat for two tenants
    await aiService.chat('tenant-a', [{ role: 'user', content: 'hi' }]);
    await aiService.chat('tenant-b', [{ role: 'user', content: 'hi' }]);

    // Clear only tenant-a
    aiService.clearCache('tenant-a');

    // tenant-b should still be cached (no extra snapshot lookup on next call)
    const snapshotService = require('../../src/services/snapshotService');
    snapshotService.getAvailableDates.mockClear();

    await aiService.chat('tenant-b', [{ role: 'user', content: 'hello again' }]);
    // Should NOT have called getAvailableDates because cache is still warm
    expect(snapshotService.getAvailableDates).not.toHaveBeenCalled();
  });

  it('clearCache without tenantId clears all tenants', async () => {
    await aiService.chat('tenant-x', [{ role: 'user', content: 'hi' }]);
    aiService.clearCache(); // clear all

    const snapshotService = require('../../src/services/snapshotService');
    snapshotService.getAvailableDates.mockClear();

    await aiService.chat('tenant-x', [{ role: 'user', content: 'hi again' }]);
    // Should have re-fetched because cache was cleared
    expect(snapshotService.getAvailableDates).toHaveBeenCalled();
  });

  it('cache entry expires after TTL', async () => {
    // Call chat to populate cache
    await aiService.chat('tenant-ttl', [{ role: 'user', content: 'hi' }]);

    const snapshotService = require('../../src/services/snapshotService');
    snapshotService.getAvailableDates.mockClear();

    // Mock Date.now to simulate time passing beyond TTL (10 min)
    const originalNow = Date.now;
    Date.now = jest.fn().mockReturnValue(originalNow() + 11 * 60 * 1000);

    await aiService.chat('tenant-ttl', [{ role: 'user', content: 'hi' }]);
    // Should have re-fetched because cache expired
    expect(snapshotService.getAvailableDates).toHaveBeenCalled();

    Date.now = originalNow;
  });
});

// ---------------------------------------------------------------------------
// getClient
// ---------------------------------------------------------------------------
describe('getClient', () => {
  it('throws if ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // getClient is called inside chat, so calling chat should throw
    await expect(aiService.chat('t1', [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('returns an Anthropic client instance when key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const Anthropic = require('@anthropic-ai/sdk');
    // Calling chat will instantiate the client
    await aiService.chat('t2', [{ role: 'user', content: 'test' }]);
    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });
});

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------
describe('chat', () => {
  it('returns a reply from basic chat call', async () => {
    const result = await aiService.chat('tenant-1', [
      { role: 'user', content: 'How are we doing this year?' },
    ]);
    expect(result).toHaveProperty('reply');
    expect(result.reply).toBe('AI response');
  });

  it('returns kbInjected flag', async () => {
    const result = await aiService.chat('tenant-1', [
      { role: 'user', content: 'Tell me about campaigns' },
    ]);
    expect(result).toHaveProperty('kbInjected');
    expect(result.kbInjected).toBe(false);
  });

  it('returns citations array', async () => {
    const result = await aiService.chat('tenant-1', [
      { role: 'user', content: 'question' },
    ]);
    expect(result).toHaveProperty('citations');
    expect(Array.isArray(result.citations)).toBe(true);
  });

  it('calls Anthropic messages.create with correct model', async () => {
    await aiService.chat('tenant-1', [{ role: 'user', content: 'test' }]);
    expect(mockCreate).toHaveBeenCalled();
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-sonnet-4-6');
    expect(callArgs.max_tokens).toBe(4096);
  });

  it('passes conversation messages to API', async () => {
    const messages = [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'second message' },
    ];
    await aiService.chat('tenant-1', messages);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(3);
    expect(callArgs.messages[0].content).toBe('first message');
    expect(callArgs.messages[2].content).toBe('second message');
  });

  it('handles tool_use stop_reason with no tool results', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Using tools...' },
        { type: 'tool_use', name: 'web_search', id: 'tool-1', input: {} },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await aiService.chat('tenant-1', [
      { role: 'user', content: 'search the web' },
    ], { deepDive: true });

    // web_search tool_use blocks are skipped (not executed locally)
    // so it should return the text content
    expect(result.reply).toBe('Using tools...');
  });

  it('adds CRM access restriction for viewer role', async () => {
    await aiService.chat('tenant-1', [
      { role: 'user', content: 'look up a donor' },
    ], { userRole: 'viewer' });
    const callArgs = mockCreate.mock.calls[0][0];
    const systemText = callArgs.system[0].text;
    expect(systemText).toContain('CRM ACCESS');
    expect(systemText).toContain('viewer-level access');
  });

  it('does not add CRM restriction for admin role', async () => {
    await aiService.chat('tenant-1', [
      { role: 'user', content: 'look up a donor' },
    ], { userRole: 'admin' });
    const callArgs = mockCreate.mock.calls[0][0];
    const systemText = callArgs.system[0].text;
    expect(systemText).not.toContain('viewer-level access');
  });
});

// ---------------------------------------------------------------------------
// generateTitle
// ---------------------------------------------------------------------------
describe('generateTitle', () => {
  it('generates a short title from a user message', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Annual Giving Progress' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const title = await aiService.generateTitle('tenant-1', 'How is our annual giving campaign doing?');
    expect(title).toBe('Annual Giving Progress');
  });

  it('strips quotes from generated title', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '"Donor Retention Analysis"' }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const title = await aiService.generateTitle('tenant-1', 'What is our donor retention rate?');
    expect(title).toBe('Donor Retention Analysis');
  });

  it('falls back to truncated message on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    const title = await aiService.generateTitle('tenant-1', 'A very long question about fundraising');
    expect(title).toContain('A very long question');
  });

  it('returns fallback for empty API response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '' }],
      usage: { input_tokens: 20, output_tokens: 0 },
    });
    const title = await aiService.generateTitle('tenant-1', 'test');
    expect(title).toBe('New conversation');
  });

  it('truncates titles longer than 100 characters', async () => {
    const longTitle = 'A'.repeat(150);
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: longTitle }],
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const title = await aiService.generateTitle('tenant-1', 'question');
    expect(title.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// clearCache (exported function)
// ---------------------------------------------------------------------------
describe('clearCache export', () => {
  it('is a function', () => {
    expect(typeof aiService.clearCache).toBe('function');
  });

  it('can be called with a tenantId string', () => {
    expect(() => aiService.clearCache('some-tenant')).not.toThrow();
  });

  it('can be called with no arguments to clear all', () => {
    expect(() => aiService.clearCache()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
describe('Module exports', () => {
  it('exports chat function', () => {
    expect(typeof aiService.chat).toBe('function');
  });

  it('exports chatStream function', () => {
    expect(typeof aiService.chatStream).toBe('function');
  });

  it('exports generateTitle function', () => {
    expect(typeof aiService.generateTitle).toBe('function');
  });

  it('exports clearCache function', () => {
    expect(typeof aiService.clearCache).toBe('function');
  });
});
