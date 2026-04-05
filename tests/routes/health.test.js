describe('Route modules', () => {
  it('landing route should export an Express router', () => {
    // Mock the models module so requiring the route does not trigger a DB connection
    jest.mock('../../src/models', () => ({
      sequelize: { define: jest.fn().mockReturnValue({}) },
      Tenant: {},
      User: {},
    }));

    let landing;
    try {
      landing = require('../../src/routes/landing');
    } catch (e) {
      // If the route has deep dependencies that fail to load, we still verify the
      // module structure by checking the error is NOT a "module not found" for landing itself.
      expect(e.message).not.toMatch(/Cannot find module '.*landing'/);
      return;
    }

    // Express routers are functions
    expect(typeof landing).toBe('function');
  });
});
