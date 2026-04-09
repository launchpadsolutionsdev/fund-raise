const { withRetry, withTimeout, CircuitBreaker } = require('../../src/services/aiResilience');

describe('aiResilience', () => {
  describe('withRetry', () => {
    test('returns result on first success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, { label: 'test', maxRetries: 3 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on retryable errors and eventually succeeds', async () => {
      const error = new Error('overloaded');
      error.status = 529;
      const fn = jest.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('recovered');

      const result = await withRetry(fn, { label: 'test', maxRetries: 2 });
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('does not retry non-retryable errors', async () => {
      const error = new Error('invalid request');
      error.status = 400;
      const fn = jest.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { label: 'test', maxRetries: 3 })).rejects.toThrow('invalid request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('throws after exhausting retries', async () => {
      const error = new Error('overloaded');
      error.status = 529;
      const fn = jest.fn().mockRejectedValue(error);

      await expect(withRetry(fn, { label: 'test', maxRetries: 1 })).rejects.toThrow('overloaded');
      expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    });
  });

  describe('withTimeout', () => {
    test('resolves if promise completes within timeout', async () => {
      const result = await withTimeout(Promise.resolve('fast'), 1000, 'test');
      expect(result).toBe('fast');
    });

    test('rejects if promise exceeds timeout', async () => {
      const slow = new Promise(resolve => setTimeout(() => resolve('slow'), 5000));
      await expect(withTimeout(slow, 10, 'test')).rejects.toThrow('test timed out after 0.01s');
    });
  });

  describe('CircuitBreaker', () => {
    test('starts in closed state', () => {
      const cb = new CircuitBreaker('test', { threshold: 3, resetMs: 100 });
      expect(cb.getState().state).toBe('closed');
    });

    test('passes through on success', async () => {
      const cb = new CircuitBreaker('test', { threshold: 3, resetMs: 100 });
      const result = await cb.execute(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    test('opens after threshold failures', async () => {
      const cb = new CircuitBreaker('test', { threshold: 2, resetMs: 100 });
      const error = new Error('overloaded');
      error.status = 500;

      // Two API failures should open the circuit
      await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');

      // Next call should be rejected immediately
      await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('AI service temporarily unavailable');
    });

    test('transitions to half-open after reset period', async () => {
      const cb = new CircuitBreaker('test', { threshold: 1, resetMs: 50 });
      const error = new Error('overloaded');
      error.status = 500;

      await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow();
      expect(cb.getState().state).toBe('open');

      // Wait for reset
      await new Promise(r => setTimeout(r, 60));

      // Should allow a probe request
      const result = await cb.execute(() => Promise.resolve('recovered'));
      expect(result).toBe('recovered');
      expect(cb.getState().state).toBe('closed');
    });

    test('ignores non-API errors for failure count', async () => {
      const cb = new CircuitBreaker('test', { threshold: 2, resetMs: 100 });
      const validationError = new Error('invalid input');
      validationError.status = 400;

      await expect(cb.execute(() => Promise.reject(validationError))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(validationError))).rejects.toThrow();
      // Should still be closed — 400s don't count
      expect(cb.getState().state).toBe('closed');
    });
  });
});
