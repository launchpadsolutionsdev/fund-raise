/**
 * Blackbaud SKY API Client
 *
 * Handles OAuth token management and authenticated API requests
 * to the Blackbaud RE NXT API.
 *
 * Required env vars:
 *   BLACKBAUD_CLIENT_ID
 *   BLACKBAUD_CLIENT_SECRET
 *   BLACKBAUD_REDIRECT_URI       (e.g. https://fund-raise.ca/auth/blackbaud/callback)
 *   BLACKBAUD_PRIMARY_ACCESS     (SKY API subscription key)
 */

const { BlackbaudToken, User, Tenant } = require('../models');
const emailService = require('./emailService');

const BB_AUTH_BASE = 'https://oauth2.sky.blackbaud.com';
const BB_API_BASE = 'https://api.sky.blackbaud.com';

// ---------------------------------------------------------------------------
// In-memory response cache (10-minute TTL)
// ---------------------------------------------------------------------------

const responseCache = new Map();
const RESPONSE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key) {
  const entry = responseCache.get(key);
  if (entry && Date.now() - entry.timestamp < RESPONSE_CACHE_TTL) {
    console.log(`[BLACKBAUD CACHE] Hit: ${key}`);
    return entry.data;
  }
  if (entry) responseCache.delete(key); // expired
  return null;
}

function setCache(key, data) {
  responseCache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Daily API call counter (resets at midnight)
// ---------------------------------------------------------------------------

const DAILY_LIMIT = 1000;
const DAILY_WARN_THRESHOLD = 0.8; // 80%
let dailyCallCount = 0;
let dailyCountDate = new Date().toDateString();

let quotaWarningEmailed = false;

function incrementDailyCount(tenantId) {
  const today = new Date().toDateString();
  if (today !== dailyCountDate) {
    dailyCallCount = 0;
    dailyCountDate = today;
    quotaWarningEmailed = false;
  }
  dailyCallCount++;
  if (dailyCallCount === Math.floor(DAILY_LIMIT * DAILY_WARN_THRESHOLD)) {
    console.warn(`[BLACKBAUD] WARNING: Daily API usage at 80% (${dailyCallCount}/${DAILY_LIMIT})`);
    if (!quotaWarningEmailed && tenantId) {
      quotaWarningEmailed = true;
      // Send email to admins (fire-and-forget)
      Promise.all([
        User.findAll({ where: { tenantId, role: 'admin', isActive: true }, attributes: ['email'] }),
        Tenant.findByPk(tenantId, { attributes: ['name'] }),
      ]).then(([admins, tenant]) => {
        if (admins.length && tenant) {
          emailService.sendQuotaWarning({
            to: admins.map(a => a.email),
            orgName: tenant.name,
            usagePercent: Math.round((dailyCallCount / DAILY_LIMIT) * 100),
            count: dailyCallCount,
            limit: DAILY_LIMIT,
          }).catch(err => console.error('[EMAIL] Quota warning failed:', err.message));
        }
      }).catch(() => {});
    }
  }
  if (dailyCallCount >= DAILY_LIMIT) {
    console.error(`[BLACKBAUD] Daily API limit reached (${dailyCallCount}/${DAILY_LIMIT})`);
  }
}

function isDailyLimitReached() {
  const today = new Date().toDateString();
  if (today !== dailyCountDate) {
    dailyCallCount = 0;
    dailyCountDate = today;
  }
  return dailyCallCount >= DAILY_LIMIT;
}

function getDailyUsage() {
  return { count: dailyCallCount, limit: DAILY_LIMIT, pct: Math.round((dailyCallCount / DAILY_LIMIT) * 100) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConfigured() {
  return !!(
    process.env.BLACKBAUD_CLIENT_ID &&
    process.env.BLACKBAUD_CLIENT_SECRET &&
    process.env.BLACKBAUD_PRIMARY_ACCESS
  );
}

function getRedirectUri() {
  return process.env.BLACKBAUD_REDIRECT_URI ||
    (process.env.APP_URL ? process.env.APP_URL + '/auth/blackbaud/callback' : '/auth/blackbaud/callback');
}

/**
 * Build the authorization URL the admin visits to grant access.
 */
function getAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.BLACKBAUD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    state: state || 'blackbaud',
  });
  return `${BB_AUTH_BASE}/authorization?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange & refresh
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for access + refresh tokens.
 */
async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    client_id: process.env.BLACKBAUD_CLIENT_ID,
    client_secret: process.env.BLACKBAUD_CLIENT_SECRET,
  });

  const res = await fetch(`${BB_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blackbaud token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: data.expires_in, // seconds
  };
}

/**
 * Refresh an expired access token using the refresh token.
 */
async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: process.env.BLACKBAUD_CLIENT_ID,
    client_secret: process.env.BLACKBAUD_CLIENT_SECRET,
  });

  const res = await fetch(`${BB_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blackbaud token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    tokenType: data.token_type || 'Bearer',
    expiresIn: data.expires_in,
  };
}

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------

/**
 * Save or update a token record for a tenant.
 * Only one active connection per tenant.
 */
async function saveToken(tenantId, userId, tokenData) {
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

  // Delete any existing token and create fresh
  await BlackbaudToken.destroy({ where: { tenantId } });

  const token = await BlackbaudToken.create({
    tenantId,
    connectedBy: userId,
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    tokenType: tokenData.tokenType,
    expiresAt,
    connectedAt: new Date(),
  });

  return token;
}

/**
 * Get a valid (auto-refreshed) access token for a tenant.
 * Returns null if no connection exists.
 */
async function getValidToken(tenantId) {
  const token = await BlackbaudToken.findOne({ where: { tenantId } });
  if (!token) return null;

  // Refresh if expired or expiring within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (token.expiresAt <= fiveMinFromNow) {
    try {
      const refreshed = await refreshAccessToken(token.refreshToken);
      await token.update({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        lastRefreshedAt: new Date(),
      });
    } catch (err) {
      console.error('[BLACKBAUD] Token refresh failed:', err.message);
      return null; // Connection is broken, admin needs to re-authorize
    }
  }

  return token;
}

/**
 * Check if a tenant has an active Blackbaud connection.
 */
async function getConnectionStatus(tenantId) {
  const token = await BlackbaudToken.findOne({
    where: { tenantId },
    include: [{ association: 'connector', attributes: ['name', 'email'] }],
  });

  if (!token) {
    return { connected: false };
  }

  return {
    connected: true,
    connectedAt: token.connectedAt,
    connectedBy: token.connector ? (token.connector.name || token.connector.email) : 'Unknown',
    environmentName: token.environmentName,
    expiresAt: token.expiresAt,
    isExpired: token.isExpired(),
    lastRefreshed: token.lastRefreshedAt,
  };
}

/**
 * Disconnect (remove token) for a tenant.
 */
async function disconnect(tenantId) {
  await BlackbaudToken.destroy({ where: { tenantId } });
}

// ---------------------------------------------------------------------------
// Authenticated API requests
// ---------------------------------------------------------------------------

/**
 * Make an authenticated request to the Blackbaud SKY API.
 */
async function apiRequest(tenantId, endpoint, options = {}) {
  // Check daily rate limit
  if (isDailyLimitReached()) {
    throw new Error('Daily Blackbaud API limit reached. This resets overnight — in the meantime, Ask Fund-Raise can still help with RE NXT questions and fundraising analytics.');
  }

  const token = await getValidToken(tenantId);
  if (!token) {
    throw new Error('No active Blackbaud connection. Please connect first.');
  }

  // Check response cache for GET requests
  const method = options.method || 'GET';
  const url = endpoint.startsWith('http') ? endpoint : `${BB_API_BASE}${endpoint}`;
  const cacheKey = `${tenantId}:${method}:${url}`;

  if (method === 'GET') {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  incrementDailyCount(tenantId);

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Authorization': `Bearer ${token.accessToken}`,
      'Bb-Api-Subscription-Key': process.env.BLACKBAUD_PRIMARY_ACCESS,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    // Token might be stale despite our refresh — try one more refresh
    try {
      const refreshed = await refreshAccessToken(token.refreshToken);
      await token.update({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        lastRefreshedAt: new Date(),
      });
      // Retry the request
      const retry = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Authorization': `Bearer ${refreshed.accessToken}`,
          'Bb-Api-Subscription-Key': process.env.BLACKBAUD_PRIMARY_ACCESS,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      if (!retry.ok) {
        const text = await retry.text();
        throw new Error(`Blackbaud API error (${retry.status}): ${text}`);
      }
      if (retry.status === 204 || (method !== 'GET' && retry.headers.get('content-length') === '0')) {
        return { success: true };
      }
      const retryText = await retry.text();
      if (!retryText) return { success: true };
      return JSON.parse(retryText);
    } catch (refreshErr) {
      throw new Error('Blackbaud session expired. Please reconnect.');
    }
  }

  if (res.status === 429) {
    // Rate limited — wait for retry-after and retry once
    const retryAfter = parseInt(res.headers.get('retry-after')) || 5;
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return apiRequest(tenantId, endpoint, options);
  }

  if (res.status === 500) {
    // Server error — wait 5s and retry once (guard against infinite loop)
    if (!options._retried500) {
      await new Promise(r => setTimeout(r, 5000));
      return apiRequest(tenantId, endpoint, { ...options, _retried500: true });
    }
    const text = await res.text();
    throw new Error(`Blackbaud server error (500): ${text}`);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blackbaud API error (${res.status}): ${text}`);
  }

  // DELETE and PATCH often return empty bodies (200/204)
  if (res.status === 204 || (method !== 'GET' && res.headers.get('content-length') === '0')) {
    return { success: true };
  }

  const text = await res.text();
  if (!text) return { success: true };

  const data = JSON.parse(text);

  // Cache GET responses
  if (method === 'GET') {
    setCache(cacheKey, data);
  }

  return data;
}

/**
 * Fetch all pages from a paginated Blackbaud endpoint.
 * Uses cursor-based pagination via next_link.
 */
async function apiRequestAll(tenantId, endpoint, dataKey, maxPages = 20) {
  const results = [];
  let url = endpoint;
  let page = 0;

  while (url && page < maxPages) {
    const data = await apiRequest(tenantId, url);
    if (data[dataKey] && Array.isArray(data[dataKey])) {
      results.push(...data[dataKey]);
    }
    url = data.next_link || null;
    page++;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  isConfigured,
  getAuthorizeUrl,
  getRedirectUri,
  exchangeCodeForTokens,
  saveToken,
  getValidToken,
  getConnectionStatus,
  disconnect,
  apiRequest,
  apiRequestAll,
  isDailyLimitReached,
  getDailyUsage,
};
