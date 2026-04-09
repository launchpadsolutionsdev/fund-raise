const { UsageTracker } = require('../../src/services/aiUsageTracker');

describe('UsageTracker', () => {
  test('initializes with zero counters', () => {
    const tracker = new UsageTracker({
      tenantId: 1,
      userId: 2,
      conversationId: 'abc-123',
      model: 'claude-sonnet-4-6',
    });

    expect(tracker.inputTokens).toBe(0);
    expect(tracker.outputTokens).toBe(0);
    expect(tracker.cacheReadTokens).toBe(0);
    expect(tracker.cacheCreationTokens).toBe(0);
    expect(tracker.toolRounds).toBe(0);
    expect(tracker.toolsUsed).toEqual([]);
    expect(tracker.success).toBe(true);
    expect(tracker.errorMessage).toBeNull();
  });

  describe('recordResponse', () => {
    test('accumulates token counts from API responses', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordResponse({
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      tracker.recordResponse({
        usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 30 },
      });

      expect(tracker.inputTokens).toBe(300);
      expect(tracker.outputTokens).toBe(130);
      expect(tracker.cacheReadTokens).toBe(30);
    });

    test('handles missing usage gracefully', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordResponse(null);
      tracker.recordResponse({});
      tracker.recordResponse({ usage: {} });

      expect(tracker.inputTokens).toBe(0);
      expect(tracker.outputTokens).toBe(0);
    });

    test('tracks cache creation tokens', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordResponse({
        usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 500 },
      });

      expect(tracker.cacheCreationTokens).toBe(500);
    });
  });

  describe('recordToolRound', () => {
    test('increments round count and tracks unique tool names', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordToolRound(['search_donors', 'get_gift_history']);
      expect(tracker.toolRounds).toBe(1);
      expect(tracker.toolsUsed).toEqual(['search_donors', 'get_gift_history']);

      tracker.recordToolRound(['search_donors', 'create_action']);
      expect(tracker.toolRounds).toBe(2);
      expect(tracker.toolsUsed).toEqual(['search_donors', 'get_gift_history', 'create_action']);
    });

    test('deduplicates tool names', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordToolRound(['tool_a']);
      tracker.recordToolRound(['tool_a']);
      tracker.recordToolRound(['tool_a']);

      expect(tracker.toolsUsed).toEqual(['tool_a']);
      expect(tracker.toolRounds).toBe(3);
    });
  });

  describe('recordError', () => {
    test('marks request as failed with error message', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordError(new Error('API timeout'));

      expect(tracker.success).toBe(false);
      expect(tracker.errorMessage).toBe('API timeout');
    });

    test('truncates long error messages to 500 chars', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });
      const longMessage = 'x'.repeat(1000);

      tracker.recordError(new Error(longMessage));

      expect(tracker.errorMessage.length).toBe(500);
    });

    test('handles errors without a message', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      tracker.recordError({});

      expect(tracker.success).toBe(false);
      expect(tracker.errorMessage).toBe('Unknown error');
    });
  });

  describe('log', () => {
    test('logs usage summary to console', () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });
      tracker.recordResponse({ usage: { input_tokens: 100, output_tokens: 50 } });
      tracker.recordToolRound(['search_donors']);

      const spy = jest.spyOn(console, 'log').mockImplementation();
      tracker.log();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatch(/input: 100/);
      expect(spy.mock.calls[0][0]).toMatch(/output: 50/);
      expect(spy.mock.calls[0][0]).toMatch(/search_donors/);
      expect(spy.mock.calls[0][0]).toMatch(/OK/);

      spy.mockRestore();
    });
  });

  describe('save', () => {
    test('does not throw when AiUsageLog model is unavailable', async () => {
      const tracker = new UsageTracker({ tenantId: 1, userId: 2, model: 'test' });

      // save() catches errors internally — this should not throw
      await expect(tracker.save()).resolves.not.toThrow();
    });
  });
});
