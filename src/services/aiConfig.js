/**
 * AI Service Configuration
 *
 * Centralizes all configurable values for the Ask Fund-Raise AI system.
 * Values can be overridden via environment variables.
 */

module.exports = {
  // Claude API
  model: process.env.AI_MODEL || 'claude-sonnet-4-6',
  maxTokens: parseInt(process.env.AI_MAX_TOKENS, 10) || 4096,
  titleMaxTokens: 30,
  titleModel: process.env.AI_MODEL || 'claude-sonnet-4-6',

  // Agentic loop
  maxToolRounds: parseInt(process.env.AI_MAX_TOOL_ROUNDS, 10) || 10,
  apiTimeout: parseInt(process.env.AI_API_TIMEOUT, 10) || 90000,      // 90s per API call
  toolTimeout: parseInt(process.env.AI_TOOL_TIMEOUT, 10) || 60000,    // 60s per tool execution

  // Retry / resilience
  maxRetries: parseInt(process.env.AI_MAX_RETRIES, 10) || 3,
  retryBaseDelay: 1000,   // 1s base for exponential backoff
  retryableStatusCodes: [429, 500, 502, 503, 529],

  // Circuit breaker
  circuitBreakerThreshold: parseInt(process.env.AI_CB_THRESHOLD, 10) || 5,  // failures before opening
  circuitBreakerResetMs: parseInt(process.env.AI_CB_RESET_MS, 10) || 60000, // 60s cool-down

  // Rate limiting (per-user)
  rateLimitWindowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW, 10) || 60000,   // 1 minute window
  rateLimitMaxRequests: parseInt(process.env.AI_RATE_LIMIT_MAX, 10) || 20,       // 20 requests/min/user

  // Conversation management
  maxConversationMessages: parseInt(process.env.AI_MAX_CONV_MESSAGES, 10) || 100,
  maxMessageLength: parseInt(process.env.AI_MAX_MESSAGE_LENGTH, 10) || 50000,    // ~50K chars

  // System prompt cache
  cacheTtl: parseInt(process.env.AI_CACHE_TTL, 10) || 10 * 60 * 1000,           // 10 minutes
  maxCacheEntries: parseInt(process.env.AI_MAX_CACHE_ENTRIES, 10) || 100,

  // Blackbaud
  blackbaudDailyLimit: parseInt(process.env.BLACKBAUD_DAILY_LIMIT, 10) || 1000,

  // Image upload
  maxImageSize: 5 * 1024 * 1024, // 5MB
};
