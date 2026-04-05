jest.mock('../../src/models', () => ({
  sequelize: { query: jest.fn().mockResolvedValue([]) },
  CrmGift: {},
  CrmGiftFundraiser: {},
  CrmGiftSoftCredit: {},
  CrmGiftMatch: {},
}));

const { sequelize } = require('../../src/models');
const { CRM_TOOLS, executeCrmTool } = require('../../src/services/crmTools');

describe('crmTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CRM_TOOLS', () => {
    it('exports an array of tool definitions', () => {
      expect(Array.isArray(CRM_TOOLS)).toBe(true);
      expect(CRM_TOOLS.length).toBeGreaterThanOrEqual(2);
    });

    it('each tool has name, description, and input_schema', () => {
      for (const tool of CRM_TOOLS) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('input_schema');
      }
    });

    it('includes query_crm_gifts tool', () => {
      expect(CRM_TOOLS.find(t => t.name === 'query_crm_gifts')).toBeDefined();
    });

    it('includes get_crm_summary tool', () => {
      expect(CRM_TOOLS.find(t => t.name === 'get_crm_summary')).toBeDefined();
    });
  });

  describe('executeCrmTool - query_crm_gifts', () => {
    it('executes a valid SELECT query', async () => {
      sequelize.query.mockResolvedValue([{ id: 1, gift_amount: 100 }]);
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT * FROM crm_gifts WHERE tenant_id = :tenantId LIMIT 10',
        description: 'Get gifts',
      });
      expect(result.row_count).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(sequelize.query).toHaveBeenCalled();
    });

    it('rejects non-SELECT queries', async () => {
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'DELETE FROM crm_gifts WHERE tenant_id = :tenantId',
        description: 'Delete gifts',
      });
      expect(result.error).toContain('Only SELECT');
    });

    it('blocks DROP keyword', async () => {
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT 1; DROP TABLE crm_gifts',
        description: 'Bad query',
      });
      expect(result.error).toContain('DROP');
    });

    it('blocks UPDATE keyword', async () => {
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT 1; UPDATE crm_gifts SET gift_amount = 0',
        description: 'Bad query',
      });
      expect(result.error).toContain('UPDATE');
    });

    it('blocks INSERT keyword', async () => {
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT 1; INSERT INTO crm_gifts VALUES (1)',
        description: 'Bad query',
      });
      expect(result.error).toContain('INSERT');
    });

    it('blocks ALTER keyword', async () => {
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT 1; ALTER TABLE crm_gifts ADD COLUMN x TEXT',
        description: 'Bad query',
      });
      expect(result.error).toContain('ALTER');
    });

    it('truncates results over 200 rows', async () => {
      const bigResult = Array.from({ length: 250 }, (_, i) => ({ id: i }));
      sequelize.query.mockResolvedValue(bigResult);
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT * FROM crm_gifts WHERE tenant_id = :tenantId',
        description: 'All gifts',
      });
      expect(result.row_count).toBe(250);
      expect(result.data).toHaveLength(200);
      expect(result.truncated).toBe(true);
    });

    it('handles query errors gracefully', async () => {
      sequelize.query.mockRejectedValue(new Error('syntax error'));
      const result = await executeCrmTool('tenant-1', 'query_crm_gifts', {
        sql: 'SELECT bad syntax FROM crm_gifts WHERE tenant_id = :tenantId',
        description: 'Bad query',
      });
      expect(result.error).toContain('Query failed');
    });
  });

  describe('executeCrmTool - get_crm_summary', () => {
    it('returns summary data', async () => {
      sequelize.query
        .mockResolvedValueOnce([{ total_gifts: 500, total_amount: 100000 }]) // totals
        .mockResolvedValueOnce([{ fund_description: 'General', total: 50000 }]) // topFunds
        .mockResolvedValueOnce([{ campaign_description: 'Annual', total: 40000 }]) // topCampaigns
        .mockResolvedValueOnce([{ appeal_description: 'Year End', total: 30000 }]) // topAppeals
        .mockResolvedValueOnce([{ count: 5 }]) // fundraiserCount
        .mockResolvedValueOnce([{ fundraiser_name: 'John', total: 20000 }]) // topFundraisers
        .mockResolvedValueOnce([{ year: 2025, total: 100000 }]); // giftsByYear

      const result = await executeCrmTool('tenant-1', 'get_crm_summary', {});
      expect(result.overview).toBeDefined();
      expect(result.overview.total_gifts).toBe(500);
      expect(result.top_funds).toHaveLength(1);
      expect(result.fundraiser_count).toBe(5);
    });

    it('handles errors gracefully', async () => {
      sequelize.query.mockRejectedValue(new Error('connection lost'));
      const result = await executeCrmTool('tenant-1', 'get_crm_summary', {});
      expect(result.error).toContain('Summary failed');
    });
  });

  describe('executeCrmTool - unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeCrmTool('tenant-1', 'nonexistent_tool', {});
      expect(result.error).toContain('Unknown CRM tool');
    });
  });
});
