/**
 * Conversation Manager
 *
 * Handles conversation truncation to prevent context window overflow.
 * Uses a sliding window strategy that preserves the system instruction
 * quality while keeping conversations within token budget.
 */
const config = require('./aiConfig');

/**
 * Estimate token count from text (rough: ~4 chars per token for English).
 * This is a fast heuristic, not a precise tokenizer.
 */
function estimateTokens(text) {
  if (!text) return 0;
  if (typeof text === 'string') return Math.ceil(text.length / 4);
  if (Array.isArray(text)) {
    return text.reduce((sum, block) => {
      if (block.type === 'text') return sum + Math.ceil((block.text || '').length / 4);
      if (block.type === 'image') return sum + 1000; // images are ~1K tokens
      if (block.type === 'tool_result') return sum + Math.ceil((block.content || '').length / 4);
      return sum;
    }, 0);
  }
  return Math.ceil(JSON.stringify(text).length / 4);
}

/**
 * Truncate a conversation to fit within the configured message limit.
 *
 * Strategy:
 * 1. Always keep the first user message (provides context about what the user started with)
 * 2. Keep the most recent N messages (sliding window)
 * 3. Insert a summary marker so the AI knows history was trimmed
 *
 * @param {Array} messages - Full message history
 * @returns {Array} Truncated message array
 */
function truncateConversation(messages) {
  if (!messages || messages.length <= config.maxConversationMessages) {
    return messages;
  }

  const maxMessages = config.maxConversationMessages;
  const firstMsg = messages[0];
  const recentMessages = messages.slice(-(maxMessages - 2)); // Reserve 2 slots: first msg + summary

  const trimmedCount = messages.length - recentMessages.length - 1;

  const summaryMsg = {
    role: 'user',
    content: `[System note: ${trimmedCount} earlier messages were trimmed to stay within context limits. The conversation started with the question above. Continuing from the most recent messages below.]`,
  };

  return [firstMsg, summaryMsg, ...recentMessages];
}

/**
 * Validate individual message content length.
 *
 * @param {string} content - Message content
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateMessageLength(content) {
  if (!content) {
    return { valid: false, error: 'Message content is required.' };
  }

  const length = typeof content === 'string' ? content.length : JSON.stringify(content).length;

  if (length > config.maxMessageLength) {
    return {
      valid: false,
      error: `Message is too long (${length.toLocaleString()} characters). Maximum is ${config.maxMessageLength.toLocaleString()} characters.`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Estimate total token cost for a message array.
 */
function estimateConversationTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

module.exports = {
  truncateConversation,
  validateMessageLength,
  estimateTokens,
  estimateConversationTokens,
};
