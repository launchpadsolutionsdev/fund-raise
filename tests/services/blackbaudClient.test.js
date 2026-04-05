jest.mock('../../src/models', () => ({
  BlackbaudToken: {
    findOne: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue([{}, true]),
    destroy: jest.fn().mockResolvedValue(1),
  },
}));

describe('blackbaudClient', () => {
  let client;
  const origEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    // Reset env
    delete process.env.BLACKBAUD_CLIENT_ID;
    delete process.env.BLACKBAUD_CLIENT_SECRET;
    delete process.env.BLACKBAUD_PRIMARY_ACCESS;
    delete process.env.BLACKBAUD_REDIRECT_URI;
    delete process.env.APP_URL;
    client = require('../../src/services/blackbaudClient');
  });

  afterAll(() => {
    Object.assign(process.env, origEnv);
  });

  describe('isConfigured', () => {
    it('returns false when env vars are not set', () => {
      expect(client.isConfigured()).toBe(false);
    });

    it('returns true when all required env vars are set', () => {
      process.env.BLACKBAUD_CLIENT_ID = 'id';
      process.env.BLACKBAUD_CLIENT_SECRET = 'secret';
      process.env.BLACKBAUD_PRIMARY_ACCESS = 'key';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      expect(client.isConfigured()).toBe(true);
    });

    it('returns false when only some env vars are set', () => {
      process.env.BLACKBAUD_CLIENT_ID = 'id';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      expect(client.isConfigured()).toBe(false);
    });
  });

  describe('getRedirectUri', () => {
    it('returns BLACKBAUD_REDIRECT_URI env var when set', () => {
      process.env.BLACKBAUD_REDIRECT_URI = 'https://example.com/callback';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      expect(client.getRedirectUri()).toBe('https://example.com/callback');
    });

    it('falls back to APP_URL + path', () => {
      process.env.APP_URL = 'https://app.example.com';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      expect(client.getRedirectUri()).toBe('https://app.example.com/auth/blackbaud/callback');
    });

    it('returns default path when no env vars set', () => {
      expect(client.getRedirectUri()).toBe('/auth/blackbaud/callback');
    });
  });

  describe('getAuthorizeUrl', () => {
    it('returns authorization URL with params', () => {
      process.env.BLACKBAUD_CLIENT_ID = 'test-client-id';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      const url = client.getAuthorizeUrl('my-state');
      expect(url).toContain('oauth2.sky.blackbaud.com/authorization');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('state=my-state');
      expect(url).toContain('response_type=code');
    });

    it('uses default state when none provided', () => {
      process.env.BLACKBAUD_CLIENT_ID = 'test-client-id';
      jest.resetModules();
      client = require('../../src/services/blackbaudClient');
      const url = client.getAuthorizeUrl();
      expect(url).toContain('state=blackbaud');
    });
  });

  describe('getDailyUsage', () => {
    it('returns usage object with count, limit, pct', () => {
      const usage = client.getDailyUsage();
      expect(usage).toHaveProperty('count');
      expect(usage).toHaveProperty('limit');
      expect(usage).toHaveProperty('pct');
      expect(typeof usage.count).toBe('number');
      expect(usage.limit).toBe(1000);
    });
  });

  describe('isDailyLimitReached', () => {
    it('returns false when under limit', () => {
      expect(client.isDailyLimitReached()).toBe(false);
    });
  });

  describe('getConnectionStatus', () => {
    it('returns disconnected when no token found', async () => {
      const { BlackbaudToken } = require('../../src/models');
      BlackbaudToken.findOne.mockResolvedValue(null);
      const status = await client.getConnectionStatus('tenant-1');
      expect(status.connected).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('destroys token for tenant', async () => {
      const { BlackbaudToken } = require('../../src/models');
      BlackbaudToken.destroy.mockResolvedValue(1);
      await client.disconnect('tenant-1');
      expect(BlackbaudToken.destroy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 'tenant-1' } })
      );
    });
  });
});
