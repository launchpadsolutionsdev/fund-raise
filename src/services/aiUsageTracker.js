/**
 * AI Usage Tracker
 *
 * Tracks token usage per-request and persists to the database.
 * Accumulates token counts across multiple API calls within
 * a single chat request (agentic tool rounds).
 */

class UsageTracker {
  constructor({ tenantId, userId, conversationId, model }) {
    this.tenantId = tenantId;
    this.userId = userId;
    this.conversationId = conversationId;
    this.model = model;
    this.startTime = Date.now();

    // Accumulated totals across all API calls in this request
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheCreationTokens = 0;
    this.toolRounds = 0;
    this.toolsUsed = [];

    this.success = true;
    this.errorMessage = null;
  }

  /**
   * Record token usage from a single Claude API response.
   */
  recordResponse(response) {
    if (response && response.usage) {
      const u = response.usage;
      this.inputTokens += u.input_tokens || 0;
      this.outputTokens += u.output_tokens || 0;
      this.cacheReadTokens += (u.cache_read_input_tokens || 0);
      this.cacheCreationTokens += (u.cache_creation_input_tokens || 0);
    }
  }

  /**
   * Record a tool round with the names of tools executed.
   */
  recordToolRound(toolNames) {
    this.toolRounds++;
    for (const name of toolNames) {
      if (!this.toolsUsed.includes(name)) {
        this.toolsUsed.push(name);
      }
    }
  }

  /**
   * Mark the request as failed.
   */
  recordError(err) {
    this.success = false;
    this.errorMessage = err.message ? err.message.substring(0, 500) : 'Unknown error';
  }

  /**
   * Persist the usage record to the database.
   * Non-blocking — errors are logged but don't propagate.
   */
  async save() {
    try {
      const { AiUsageLog } = require('../models');
      if (!AiUsageLog) return; // Model not yet registered (e.g., during migration)

      await AiUsageLog.create({
        tenantId: this.tenantId,
        userId: this.userId,
        conversationId: this.conversationId,
        model: this.model,
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        cacheReadTokens: this.cacheReadTokens,
        cacheCreationTokens: this.cacheCreationTokens,
        toolRounds: this.toolRounds,
        toolsUsed: this.toolsUsed,
        durationMs: Date.now() - this.startTime,
        success: this.success,
        errorMessage: this.errorMessage,
      });
    } catch (err) {
      console.error('[AI Usage] Failed to save usage log:', err.message);
    }
  }

  /**
   * Log usage to console (existing behavior, now with more detail).
   */
  log() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(
      `[Ask Fund-Raise] Tokens — input: ${this.inputTokens}, output: ${this.outputTokens}, ` +
      `cache_read: ${this.cacheReadTokens}, cache_create: ${this.cacheCreationTokens} | ` +
      `Tools: ${this.toolRounds} rounds (${this.toolsUsed.join(', ') || 'none'}) | ` +
      `${duration}s | ${this.success ? 'OK' : 'ERROR'}`
    );
  }
}

module.exports = { UsageTracker };
