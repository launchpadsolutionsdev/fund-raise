const mockQuery = jest.fn().mockResolvedValue([]);

jest.mock('../../src/models', () => ({
  sequelize: {
    query: mockQuery,
  },
}));

const {
  createMaterializedViews,
  refreshMaterializedViews,
  dropMaterializedViews,
} = require('../../src/services/crmMaterializedViews');

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// refreshMaterializedViews
// ---------------------------------------------------------------------------

describe('refreshMaterializedViews', () => {
  test('does not throw on success', async () => {
    await expect(refreshMaterializedViews()).resolves.toBeUndefined();
  });

  test('calls sequelize.query multiple times', async () => {
    await refreshMaterializedViews();
    // 1 base view + 10 dependent views = 11 total queries
    expect(mockQuery).toHaveBeenCalledTimes(11);
  });

  test('refreshes the base gift view first', async () => {
    await refreshMaterializedViews();
    expect(mockQuery.mock.calls[0][0]).toContain('mv_crm_gift_fy');
  });

  test('uses CONCURRENTLY for all refreshes', async () => {
    await refreshMaterializedViews();
    for (const call of mockQuery.mock.calls) {
      expect(call[0]).toContain('CONCURRENTLY');
    }
  });

  test('propagates errors from sequelize.query', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(refreshMaterializedViews()).rejects.toThrow('DB connection lost');
  });
});

// ---------------------------------------------------------------------------
// createMaterializedViews
// ---------------------------------------------------------------------------

describe('createMaterializedViews', () => {
  test('does not throw on success', async () => {
    await expect(createMaterializedViews()).resolves.toBeUndefined();
  });

  test('calls sequelize.query many times for CREATE and INDEX statements', async () => {
    await createMaterializedViews();
    // Multiple CREATE MATERIALIZED VIEW + CREATE INDEX calls
    expect(mockQuery.mock.calls.length).toBeGreaterThan(10);
  });

  test('creates the base mv_crm_gift_fy view', async () => {
    await createMaterializedViews();
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n');
    expect(allSql).toContain('mv_crm_gift_fy');
  });
});

// ---------------------------------------------------------------------------
// dropMaterializedViews
// ---------------------------------------------------------------------------

describe('dropMaterializedViews', () => {
  test('does not throw on success', async () => {
    await expect(dropMaterializedViews()).resolves.toBeUndefined();
  });

  test('drops all materialized views', async () => {
    await dropMaterializedViews();
    const allSql = mockQuery.mock.calls.map(c => c[0]).join('\n');
    expect(allSql).toContain('DROP MATERIALIZED VIEW');
    expect(allSql).toContain('mv_crm_gift_fy');
    expect(allSql).toContain('mv_crm_fiscal_years');
  });
});
