// Mock all tool modules to avoid deep dependency chains (sequelize, nodemailer, etc.)
jest.mock('../../src/services/crmTools', () => ({
  CRM_TOOLS: [{ name: 'search_donors', description: 'Search donors' }],
  executeCrmTool: jest.fn().mockResolvedValue({ donors: [] }),
}));

jest.mock('../../src/services/actionTools', () => ({
  ACTION_TOOLS: [{ name: 'create_action', description: 'Create action' }],
  ACTION_TOOL_NAMES: ['create_action'],
  executeActionToolDispatch: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../src/services/analyticsTools', () => ({
  ANALYTICS_TOOLS: [{ name: 'donor_retention', description: 'Donor retention' }],
  ANALYTICS_TOOL_NAMES: ['donor_retention'],
  executeAnalyticsTool: jest.fn().mockResolvedValue({ data: [] }),
}));

jest.mock('../../src/services/teamTools', () => ({
  TEAM_TOOLS: [{ name: 'list_team', description: 'List team' }],
  TEAM_TOOL_NAMES: ['list_team'],
  executeTeamTool: jest.fn().mockResolvedValue({ team: [] }),
}));

jest.mock('../../src/services/operationalTools', () => ({
  OPERATIONAL_TOOLS: [{ name: 'get_config', description: 'Get config' }],
  OPERATIONAL_TOOL_NAMES: ['get_config'],
  executeOperationalTool: jest.fn().mockResolvedValue({ config: {} }),
}));

jest.mock('../../src/services/blackbaudTools', () => ({
  TOOLS: [{ name: 'bb_search', description: 'Blackbaud search' }],
  executeTool: jest.fn().mockResolvedValue({ results: [] }),
}));

const { executeTool, getStandardTools, getBlackbaudTools, getWebSearchTool } = require('../../src/services/toolDispatcher');

describe('toolDispatcher', () => {
  describe('getStandardTools', () => {
    test('returns an array of tool definitions', () => {
      const tools = getStandardTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('each tool has a name and description', () => {
      const tools = getStandardTools();
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
      }
    });

    test('includes tools from all categories', () => {
      const tools = getStandardTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('search_donors');
      expect(names).toContain('create_action');
      expect(names).toContain('donor_retention');
      expect(names).toContain('list_team');
      expect(names).toContain('get_config');
    });
  });

  describe('getBlackbaudTools', () => {
    test('returns an array of Blackbaud tool definitions', () => {
      const tools = getBlackbaudTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('returns a new array each time (no shared references)', () => {
      const a = getBlackbaudTools();
      const b = getBlackbaudTools();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('getWebSearchTool', () => {
    test('returns a web search tool definition', () => {
      const tool = getWebSearchTool();
      expect(tool.type).toBe('web_search_20250305');
      expect(tool.name).toBe('web_search');
    });
  });

  describe('executeTool', () => {
    const { executeActionToolDispatch } = require('../../src/services/actionTools');
    const { executeCrmTool } = require('../../src/services/crmTools');
    const { executeAnalyticsTool } = require('../../src/services/analyticsTools');
    const { executeTeamTool } = require('../../src/services/teamTools');
    const { executeOperationalTool } = require('../../src/services/operationalTools');
    const { executeTool: executeBlackbaudTool } = require('../../src/services/blackbaudTools');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('routes action tools to action dispatcher', async () => {
      await executeTool('create_action', { title: 'Follow up' }, 1, 2);
      expect(executeActionToolDispatch).toHaveBeenCalledWith(1, 2, 'create_action', { title: 'Follow up' });
    });

    test('routes CRM tools to CRM executor', async () => {
      await executeTool('search_donors', { query: 'Smith' }, 1, 2);
      expect(executeCrmTool).toHaveBeenCalledWith(1, 'search_donors', { query: 'Smith' });
    });

    test('routes analytics tools to analytics executor', async () => {
      await executeTool('donor_retention', {}, 1, 2);
      expect(executeAnalyticsTool).toHaveBeenCalledWith(1, 'donor_retention', {});
    });

    test('routes team tools to team executor', async () => {
      await executeTool('list_team', {}, 1, 2);
      expect(executeTeamTool).toHaveBeenCalledWith(1, 'list_team', {});
    });

    test('routes operational tools to operational executor', async () => {
      await executeTool('get_config', {}, 1, 2);
      expect(executeOperationalTool).toHaveBeenCalledWith(1, 'get_config', {});
    });

    test('falls back to Blackbaud for unknown tools', async () => {
      await executeTool('unknown_tool', { param: 1 }, 1, 2);
      expect(executeBlackbaudTool).toHaveBeenCalledWith(1, 'unknown_tool', { param: 1 });
    });
  });
});
