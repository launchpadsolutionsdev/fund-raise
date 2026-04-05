const mockApiRequest = jest.fn().mockResolvedValue({ value: [] });
const mockApiRequestAll = jest.fn().mockResolvedValue([]);
const mockIsDailyLimitReached = jest.fn().mockReturnValue(false);

jest.mock('../../src/services/blackbaudClient', () => ({
  apiRequest: mockApiRequest,
  apiRequestAll: mockApiRequestAll,
  isDailyLimitReached: mockIsDailyLimitReached,
}));

jest.mock('../../src/models', () => ({
  Snapshot: { findAll: jest.fn().mockResolvedValue([]) },
  RawGift: { findAll: jest.fn().mockResolvedValue([]) },
  Sequelize: { Op: { gte: Symbol('gte'), lte: Symbol('lte') } },
}));

jest.mock('../../src/services/snapshotService', () => ({
  getAvailableDates: jest.fn().mockResolvedValue([]),
}));

const { TOOLS, executeTool } = require('../../src/services/blackbaudTools');

const TENANT_ID = 'tenant-abc';

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// TOOLS array validation
// ---------------------------------------------------------------------------

describe('TOOLS array', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  test('each tool has name, description, and input_schema', () => {
    for (const tool of TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  test('all tool names are unique', () => {
    const names = TOOLS.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  test('includes known tool names', () => {
    const names = TOOLS.map(t => t.name);
    expect(names).toContain('search_constituents');
    expect(names).toContain('get_constituent_profile');
    expect(names).toContain('get_donor_giving_history');
    expect(names).toContain('search_gifts');
    expect(names).toContain('get_gift_details');
  });
});

// ---------------------------------------------------------------------------
// executeTool - unknown tool
// ---------------------------------------------------------------------------

describe('executeTool - unknown tool', () => {
  test('returns error for unknown tool name', async () => {
    const result = await executeTool(TENANT_ID, 'nonexistent_tool', {});
    expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' });
  });
});

// ---------------------------------------------------------------------------
// executeTool - search_constituents
// ---------------------------------------------------------------------------

describe('executeTool - search_constituents', () => {
  test('returns error when search_text is empty', async () => {
    const result = await executeTool(TENANT_ID, 'search_constituents', { search_text: '' });
    expect(result).toEqual({ error: 'Search text is required' });
  });

  test('returns error when search_text is whitespace only', async () => {
    const result = await executeTool(TENANT_ID, 'search_constituents', { search_text: '   ' });
    expect(result).toEqual({ error: 'Search text is required' });
  });

  test('calls apiRequest for valid search', async () => {
    mockApiRequest.mockResolvedValue({
      count: 1,
      value: [{ id: '123', first: 'John', last: 'Doe' }],
    });

    const result = await executeTool(TENANT_ID, 'search_constituents', { search_text: 'John Doe' });
    expect(mockApiRequest).toHaveBeenCalled();
    expect(result).toBeDefined();
    // Should not be an error
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// executeTool - get_constituent_profile
// ---------------------------------------------------------------------------

describe('executeTool - get_constituent_profile', () => {
  test('calls apiRequest with constituent ID', async () => {
    mockApiRequest.mockResolvedValue({
      id: '456',
      first: 'Jane',
      last: 'Smith',
      email: { address: 'jane@example.com' },
    });

    const result = await executeTool(TENANT_ID, 'get_constituent_profile', { constituent_id: '456' });
    expect(mockApiRequest).toHaveBeenCalledWith(
      TENANT_ID,
      expect.stringContaining('456'),
    );
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// executeTool - get_donor_giving_history
// ---------------------------------------------------------------------------

describe('executeTool - get_donor_giving_history', () => {
  test('returns giving history structure', async () => {
    mockApiRequestAll.mockResolvedValue([
      { id: '1', amount: { value: 100 }, date: '2024-01-15', type: 'Cash', gift_splits: [] },
      { id: '2', amount: { value: 250 }, date: '2024-06-01', type: 'Check', gift_splits: [] },
    ]);

    const result = await executeTool(TENANT_ID, 'get_donor_giving_history', { constituent_id: '789' });
    expect(result).toBeDefined();
    // Should have summary or constituent_id
    expect(result.constituent_id || result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// executeTool - list_campaigns
// ---------------------------------------------------------------------------

describe('executeTool - list_campaigns', () => {
  test('returns campaigns from apiRequest', async () => {
    mockApiRequest.mockResolvedValue({
      value: [
        { id: '1', description: 'Annual Campaign', inactive: false },
        { id: '2', description: 'Capital Campaign', inactive: true },
      ],
    });

    const result = await executeTool(TENANT_ID, 'list_campaigns', {});
    expect(result.total).toBe(1); // inactive filtered out by default
    expect(result.campaigns).toHaveLength(1);
  });

  test('includes inactive campaigns when requested', async () => {
    mockApiRequest.mockResolvedValue({
      value: [
        { id: '1', description: 'Annual Campaign', inactive: false },
        { id: '2', description: 'Capital Campaign', inactive: true },
      ],
    });

    const result = await executeTool(TENANT_ID, 'list_campaigns', { include_inactive: true });
    expect(result.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// executeTool - list_funds
// ---------------------------------------------------------------------------

describe('executeTool - list_funds', () => {
  test('returns funds from apiRequest', async () => {
    mockApiRequest.mockResolvedValue({
      value: [
        { id: '10', description: 'General Fund', type: 'Unrestricted' },
      ],
    });

    const result = await executeTool(TENANT_ID, 'list_funds', {});
    expect(result.total).toBe(1);
    expect(result.funds[0].description).toBe('General Fund');
  });
});

// ---------------------------------------------------------------------------
// executeTool - get_gift_details
// ---------------------------------------------------------------------------

describe('executeTool - get_gift_details', () => {
  test('returns gift details', async () => {
    mockApiRequest.mockResolvedValue({
      id: '999',
      amount: { value: 5000 },
      date: '2024-03-15',
      type: 'Cash',
      constituent_id: '123',
      gift_splits: [],
    });
    // apiRequestAll for funds
    mockApiRequestAll.mockResolvedValue([]);

    const result = await executeTool(TENANT_ID, 'get_gift_details', { gift_id: '999' });
    expect(result.id).toBe('999');
    expect(result.amount).toBe(5000);
  });

  test('handles API error gracefully', async () => {
    mockApiRequest.mockRejectedValue(new Error('Not found'));

    const result = await executeTool(TENANT_ID, 'get_gift_details', { gift_id: 'bad-id' });
    expect(result.error).toContain('Failed to load gift details');
  });
});
