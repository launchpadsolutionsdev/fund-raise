const { checkRateLimit, recordRequest, aiRateLimitMiddleware } = require('../../src/services/aiRateLimit');

// We need to reset the internal requestLog between tests.
// Since it's module-scoped, we clear it by requiring fresh or testing behavior in sequence.

describe('aiRateLimit', () => {
  // Use a unique userId per test to avoid cross-test pollution
  let userCounter = 1000;

  function uniqueUserId() {
    return userCounter++;
  }

  describe('checkRateLimit', () => {
    test('allows requests under the limit', () => {
      const userId = uniqueUserId();
      const result = checkRateLimit(userId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeNull();
    });

    test('blocks requests over the limit', () => {
      const userId = uniqueUserId();
      // Record enough requests to hit the limit (default 20)
      for (let i = 0; i < 20; i++) {
        recordRequest(userId);
      }

      const result = checkRateLimit(userId);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    test('tracks remaining count accurately', () => {
      const userId = uniqueUserId();
      recordRequest(userId);
      recordRequest(userId);

      const result = checkRateLimit(userId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(18); // 20 - 2
    });
  });

  describe('recordRequest', () => {
    test('increments the request count for a user', () => {
      const userId = uniqueUserId();
      expect(checkRateLimit(userId).remaining).toBe(20);

      recordRequest(userId);
      expect(checkRateLimit(userId).remaining).toBe(19);

      recordRequest(userId);
      expect(checkRateLimit(userId).remaining).toBe(18);
    });
  });

  describe('aiRateLimitMiddleware', () => {
    function mockReq(userId) {
      return { user: userId ? { id: userId } : null };
    }

    function mockRes() {
      const res = {
        headers: {},
        statusCode: null,
        body: null,
        setHeader(key, value) {
          res.headers[key] = value;
        },
        status(code) {
          res.statusCode = code;
          return res;
        },
        json(data) {
          res.body = data;
          return res;
        },
      };
      return res;
    }

    test('calls next() when under limit', () => {
      const userId = uniqueUserId();
      const req = mockReq(userId);
      const res = mockRes();
      const next = jest.fn();

      aiRateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.headers['X-RateLimit-Limit']).toBe(20);
      expect(res.headers['X-RateLimit-Remaining']).toBe(20); // Header set before recording this request
    });

    test('returns 429 when over limit', () => {
      const userId = uniqueUserId();
      // Exhaust the limit
      for (let i = 0; i < 20; i++) {
        recordRequest(userId);
      }

      const req = mockReq(userId);
      const res = mockRes();
      const next = jest.fn();

      aiRateLimitMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(429);
      expect(res.body.error).toMatch(/Rate limit exceeded/);
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
      expect(res.headers['Retry-After']).toBeGreaterThan(0);
    });

    test('passes through when no user is present', () => {
      const req = mockReq(null);
      const res = mockRes();
      const next = jest.fn();

      aiRateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('sets rate limit headers', () => {
      const userId = uniqueUserId();
      const req = mockReq(userId);
      const res = mockRes();
      const next = jest.fn();

      aiRateLimitMiddleware(req, res, next);

      expect(res.headers['X-RateLimit-Limit']).toBeDefined();
      expect(res.headers['X-RateLimit-Remaining']).toBeDefined();
    });
  });
});
