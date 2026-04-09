/**
 * AI Rate Limiting
 *
 * In-memory sliding window rate limiter for AI chat endpoints.
 * Tracks per-user request counts within a configurable time window.
 */
const config = require('./aiConfig');

// Map<userId, Array<timestamp>>
const requestLog = new Map();

// Periodic cleanup of stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of requestLog) {
    const valid = timestamps.filter(t => now - t < config.rateLimitWindowMs);
    if (valid.length === 0) {
      requestLog.delete(userId);
    } else {
      requestLog.set(userId, valid);
    }
  }
}, 5 * 60 * 1000);

/**
 * Check if a user has exceeded their rate limit.
 *
 * @param {number} userId
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs: number|null }}
 */
function checkRateLimit(userId) {
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;

  let timestamps = requestLog.get(userId) || [];
  // Trim old entries
  timestamps = timestamps.filter(t => t >= windowStart);

  if (timestamps.length >= config.rateLimitMaxRequests) {
    // Find when the oldest request in the window will expire
    const oldestInWindow = timestamps[0];
    const retryAfterMs = (oldestInWindow + config.rateLimitWindowMs) - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    };
  }

  return {
    allowed: true,
    remaining: config.rateLimitMaxRequests - timestamps.length,
    retryAfterMs: null,
  };
}

/**
 * Record a request for rate limiting.
 *
 * @param {number} userId
 */
function recordRequest(userId) {
  const timestamps = requestLog.get(userId) || [];
  timestamps.push(Date.now());
  requestLog.set(userId, timestamps);
}

/**
 * Express middleware for AI rate limiting.
 * Attach to AI chat endpoints.
 */
function aiRateLimitMiddleware(req, res, next) {
  const userId = req.user && req.user.id;
  if (!userId) return next();

  const { allowed, remaining, retryAfterMs } = checkRateLimit(userId);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', config.rateLimitMaxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);

  if (!allowed) {
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    res.setHeader('Retry-After', retryAfterSec);
    return res.status(429).json({
      error: `Rate limit exceeded. Please wait ${retryAfterSec} seconds before trying again.`,
      retryAfterMs,
    });
  }

  recordRequest(userId);
  next();
}

module.exports = {
  checkRateLimit,
  recordRequest,
  aiRateLimitMiddleware,
};
