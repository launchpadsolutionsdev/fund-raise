const { truncateConversation, validateMessageLength, estimateTokens, estimateConversationTokens } = require('../../src/services/conversationManager');

describe('conversationManager', () => {
  describe('truncateConversation', () => {
    test('returns messages unchanged when under limit', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];
      const result = truncateConversation(messages);
      expect(result).toEqual(messages);
    });

    test('returns null/undefined as-is', () => {
      expect(truncateConversation(null)).toBeNull();
      expect(truncateConversation(undefined)).toBeUndefined();
    });

    test('truncates long conversations preserving first and recent messages', () => {
      // Create 110 messages (above the default 100 limit)
      const messages = [];
      for (let i = 0; i < 110; i++) {
        messages.push({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
        });
      }

      const result = truncateConversation(messages);

      // Should be at most maxConversationMessages (100)
      expect(result.length).toBeLessThanOrEqual(100);

      // First message should be preserved
      expect(result[0]).toEqual(messages[0]);

      // Second message should be a summary marker
      expect(result[1].role).toBe('user');
      expect(result[1].content).toMatch(/messages were trimmed/);

      // Last message should be the last original message
      expect(result[result.length - 1]).toEqual(messages[messages.length - 1]);
    });

    test('includes trimmed count in summary marker', () => {
      const messages = [];
      for (let i = 0; i < 110; i++) {
        messages.push({ role: 'user', content: `Msg ${i}` });
      }

      const result = truncateConversation(messages);
      const summaryMsg = result[1];
      // 110 total - 98 recent - 1 first = 11 trimmed
      expect(summaryMsg.content).toMatch(/\d+ earlier messages were trimmed/);
    });
  });

  describe('validateMessageLength', () => {
    test('accepts normal-length messages', () => {
      const result = validateMessageLength('Hello, how are you?');
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    test('rejects empty/null content', () => {
      expect(validateMessageLength(null).valid).toBe(false);
      expect(validateMessageLength('').valid).toBe(false);
      expect(validateMessageLength(undefined).valid).toBe(false);
    });

    test('rejects content over the max length', () => {
      const longContent = 'x'.repeat(60000); // Default max is 50000
      const result = validateMessageLength(longContent);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/too long/);
    });

    test('handles non-string content by serializing', () => {
      const objectContent = { blocks: [{ type: 'text', text: 'hello' }] };
      const result = validateMessageLength(objectContent);
      expect(result.valid).toBe(true);
    });
  });

  describe('estimateTokens', () => {
    test('estimates ~4 chars per token for strings', () => {
      // 100 chars → ~25 tokens
      const text = 'a'.repeat(100);
      expect(estimateTokens(text)).toBe(25);
    });

    test('returns 0 for empty/null input', () => {
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens('')).toBe(0);
    });

    test('handles array content blocks', () => {
      const blocks = [
        { type: 'text', text: 'Hello world' }, // 11 chars → 3 tokens
        { type: 'image' }, // ~1000 tokens
      ];
      const result = estimateTokens(blocks);
      expect(result).toBeGreaterThan(1000);
    });

    test('handles objects by serializing to JSON', () => {
      const obj = { key: 'value' };
      const result = estimateTokens(obj);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe('estimateConversationTokens', () => {
    test('sums token estimates across all messages', () => {
      const messages = [
        { role: 'user', content: 'a'.repeat(100) },     // 25 tokens
        { role: 'assistant', content: 'b'.repeat(200) }, // 50 tokens
      ];
      const result = estimateConversationTokens(messages);
      expect(result).toBe(75);
    });
  });
});
