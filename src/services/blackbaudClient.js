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

const { BlackbaudToken } = require('../models');

const BB_AUTH_BASE = 'https://oauth2.sky.blackbaud.com';
const BB_API_BASE = 'https://api.sky.blackbaud.com';

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

  const [token] = await BlackbaudToken.findOrCreate({
    where: { tenantId },
    defaults: {
      tenantId,
      connectedBy: userId,
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenType: tokenData.tokenType,
      expiresAt,
      connectedAt: new Date(),
    },
  });

  // If record already existed, update it
  if (token.accessToken !== tokenData.accessToken) {
    await token.update({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      tokenType: tokenData.tokenType,
      expiresAt,
      connectedBy: userId,
      connectedAt: new Date(),
      lastRefreshedAt: null,
    });
  }

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
  const token = await getValidToken(tenantId);
  if (!token) {
    throw new Error('No active Blackbaud connection. Please connect first.');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${BB_API_BASE}${endpoint}`;

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
      return retry.json();
    } catch (refreshErr) {
      throw new Error('Blackbaud session expired. Please reconnect.');
    }
  }

  if (res.status === 429) {
    throw new Error('Blackbaud API rate limit reached. Please try again later.');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Blackbaud API error (${res.status}): ${text}`);
  }

  return res.json();
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
};
