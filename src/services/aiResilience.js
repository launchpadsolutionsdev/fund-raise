/**
 * AI Resilience Utilities
 *
 * Provides retry with exponential backoff and circuit breaker pattern
 * for Claude API calls.
 */
const config = require('./aiConfig');

// ---------------------------------------------------------------------------
// Retry with exponential backoff
// ---------------------------------------------------------------------------

/**
 * Wrap a promise-returning function with retry logic.
 * Only retries on specific HTTP status codes (429, 500, 502, 503, 529).
 *
 * @param {Function} fn - Async function to retry
 * @param {Object} opts
 * @param {string} opts.label - Description for logging
 * @param {number} [opts.maxRetries] - Override config.maxRetries
 * @returns {Promise<*>} Result of fn()
 */
async function withRetry(fn, { label = 'API call', maxRetries = config.maxRetries } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Check if error is retryable
      const status = err.status || err.statusCode || (err.error && err.error.status);
      const isRetryable = config.retryableStatusCodes.includes(status);
      const isOverloaded = err.message && (
        err.message.includes('overloaded') ||
        err.message.includes('rate_limit') ||
        err.message.includes('529')
      );

      if ((isRetryable || isOverloaded) && attempt < maxRetries) {
        const delay = config.retryBaseDelay * Math.pow(2, attempt);
        // Add jitter: 0.5x to 1.5x
        const jitter = delay * (0.5 + Math.random());
        console.warn(`[AI Retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(jitter)}ms: ${err.message}`);
        await sleep(jitter);
        continue;
      }

      // Non-retryable error or exhausted retries
      break;
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.threshold = options.threshold || config.circuitBreakerThreshold;
    this.resetMs = options.resetMs || config.circuitBreakerResetMs;

    this.failures = 0;
    this.state = 'closed';     // closed | open | half-open
    this.openedAt = null;
    this.lastFailure = null;
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn - Async function to execute
   * @returns {Promise<*>}
   */
  async execute(fn) {
    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      if (Date.now() - this.openedAt >= this.resetMs) {
        this.state = 'half-open';
        console.log(`[Circuit Breaker] ${this.name}: half-open, allowing probe request`);
      } else {
        const remaining = Math.round((this.resetMs - (Date.now() - this.openedAt)) / 1000);
        throw new Error(`AI service temporarily unavailable. Please try again in ~${remaining}s.`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  onSuccess() {
    if (this.state === 'half-open') {
      console.log(`[Circuit Breaker] ${this.name}: recovered, closing circuit`);
    }
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure(err) {
    // Only count API-level failures (not tool execution errors or validation errors)
    const status = err.status || err.statusCode;
    const isApiError = status >= 500 || status === 429 || status === 529 ||
      (err.message && (err.message.includes('overloaded') || err.message.includes('timed out')));

    if (!isApiError) return;

    this.failures++;
    this.lastFailure = err;

    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      console.error(`[Circuit Breaker] ${this.name}: OPEN after ${this.failures} failures. Will retry in ${this.resetMs / 1000}s`);
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt,
    };
  }
}

// Singleton circuit breaker for Claude API
const claudeCircuitBreaker = new CircuitBreaker('Claude API');

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

module.exports = {
  withRetry,
  withTimeout,
  CircuitBreaker,
  claudeCircuitBreaker,
};
