/**
 * Blackbaud SKY API — Action Centre Integration
 *
 * Handles syncing Fund-Raise Action Centre tasks with
 * Raiser's Edge NXT Actions via the SKY Constituent API.
 *
 * Builds on top of blackbaudClient.js for auth / token management.
 * All calls are non-blocking — failures are logged and sync status
 * is tracked per action, but never prevent local saves.
 */

const blackbaudClient = require('./blackbaudClient');
const { ReNxtConfigCache } = require('../models');

// ---------------------------------------------------------------------------
// Field mapping: Fund-Raise action → SKY API action body
// ---------------------------------------------------------------------------

/**
 * Map a Fund-Raise action record to a SKY API Action request body.
 * Only includes fields that have values.
 */
function mapActionToSkyApi(action, opts = {}) {
  const body = {};

  // Required: constituent_id — use systemRecordId (RE NXT system record ID)
  const constituentId = action.systemRecordId || action.constituentId;
  if (constituentId) body.constituent_id = String(constituentId);

  // Required: date (the action / due date)
  if (action.dueDate) {
    body.date = new Date(action.dueDate).toISOString();
  } else {
    body.date = new Date().toISOString();
  }

  // Summary (max 255 chars)
  if (action.title) body.summary = action.title.substring(0, 255);

  // Description
  if (action.description) body.description = action.description;

  // Category — use RE NXT category if provided, else default
  if (opts.category) body.category = opts.category;

  // Type — optional sub-category
  if (opts.type) body.type = opts.type;

  // Status mapping: Fund-Raise open/pending → RE NXT status
  if (opts.status) {
    body.status = opts.status;
  }

  // Priority mapping
  if (action.priority) {
    const priorityMap = { normal: 'Normal', high: 'High', urgent: 'High' };
    body.priority = priorityMap[action.priority] || 'Normal';
  }

  // Completed status
  if (action.status === 'resolved') {
    body.completed = true;
    body.completed_date = action.resolvedAt
      ? new Date(action.resolvedAt).toISOString()
      : new Date().toISOString();
  } else {
    body.completed = false;
  }

  // Direction, location (optional passthrough)
  if (opts.direction) body.direction = opts.direction;
  if (opts.location) body.location = opts.location;

  // Fundraisers — array of RE NXT constituent IDs
  if (opts.fundraiserIds && opts.fundraiserIds.length > 0) {
    body.fundraisers = opts.fundraiserIds.map(String);
  }

  // Author tag
  body.author = 'Fund-Raise';

  return body;
}

// ---------------------------------------------------------------------------
// CRUD wrappers — all non-blocking (catch errors, return sync status)
// ---------------------------------------------------------------------------

/**
 * Create an action in RE NXT.
 * Returns { success, reNxtActionId, error }
 */
async function createAction(tenantId, action, opts = {}) {
  try {
    const body = mapActionToSkyApi(action, opts);
    if (!body.constituent_id) {
      return { success: false, reNxtActionId: null, error: 'No constituent ID (system_record_id) — cannot sync to RE NXT' };
    }

    // Auto-select default category from cached config if not provided
    if (!body.category) {
      try {
        const types = await getCachedConfig(tenantId, 'action_types');
        if (types && types.length > 0) {
          body.category = types[0].name || types[0];
        }
      } catch { /* ignore */ }
    }
    if (!body.category) {
      body.category = 'Task';
    }

    const result = await blackbaudClient.apiRequest(tenantId, '/constituent/v1/actions', {
      method: 'POST',
      body,
    });

    return {
      success: true,
      reNxtActionId: result.id ? String(result.id) : null,
      error: null,
    };
  } catch (err) {
    console.error('[BLACKBAUD ACTIONS] Create failed:', err.message);
    return { success: false, reNxtActionId: null, error: err.message };
  }
}

/**
 * Update an action in RE NXT.
 * Returns { success, error }
 */
async function updateAction(tenantId, reNxtActionId, action, opts = {}) {
  try {
    if (!reNxtActionId) {
      return { success: false, error: 'No RE NXT action ID to update' };
    }

    const body = mapActionToSkyApi(action, opts);
    // Remove constituent_id — not allowed on PATCH
    delete body.constituent_id;

    await blackbaudClient.apiRequest(tenantId, `/constituent/v1/actions/${reNxtActionId}`, {
      method: 'PATCH',
      body,
    });

    return { success: true, error: null };
  } catch (err) {
    console.error('[BLACKBAUD ACTIONS] Update failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Complete an action in RE NXT.
 * Returns { success, error }
 */
async function completeAction(tenantId, reNxtActionId, resolvedAt) {
  try {
    if (!reNxtActionId) {
      return { success: false, error: 'No RE NXT action ID to complete' };
    }

    await blackbaudClient.apiRequest(tenantId, `/constituent/v1/actions/${reNxtActionId}`, {
      method: 'PATCH',
      body: {
        completed: true,
        completed_date: resolvedAt ? new Date(resolvedAt).toISOString() : new Date().toISOString(),
      },
    });

    return { success: true, error: null };
  } catch (err) {
    console.error('[BLACKBAUD ACTIONS] Complete failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Re-open an action in RE NXT (set completed = false).
 * Returns { success, error }
 */
async function reopenAction(tenantId, reNxtActionId) {
  try {
    if (!reNxtActionId) {
      return { success: false, error: 'No RE NXT action ID to reopen' };
    }

    await blackbaudClient.apiRequest(tenantId, `/constituent/v1/actions/${reNxtActionId}`, {
      method: 'PATCH',
      body: { completed: false },
    });

    return { success: true, error: null };
  } catch (err) {
    console.error('[BLACKBAUD ACTIONS] Reopen failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Delete an action from RE NXT.
 * Returns { success, error }
 */
async function deleteAction(tenantId, reNxtActionId) {
  try {
    if (!reNxtActionId) {
      return { success: true, error: null }; // Nothing to delete
    }

    await blackbaudClient.apiRequest(tenantId, `/constituent/v1/actions/${reNxtActionId}`, {
      method: 'DELETE',
    });

    return { success: true, error: null };
  } catch (err) {
    console.error('[BLACKBAUD ACTIONS] Delete failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Config value fetching & caching
// ---------------------------------------------------------------------------

const CONFIG_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch RE NXT config values (action types, status types, locations)
 * from the API and cache them in the database.
 */
async function fetchAndCacheConfig(tenantId, configType) {
  const endpoints = {
    action_types: '/constituent/v1/actions/types',
    status_types: '/constituent/v1/actions/statustypes',
    locations: '/constituent/v1/actions/locations',
  };

  const endpoint = endpoints[configType];
  if (!endpoint) throw new Error(`Unknown config type: ${configType}`);

  try {
    const data = await blackbaudClient.apiRequest(tenantId, endpoint);
    const values = Array.isArray(data) ? data : (data.value || []);

    await ReNxtConfigCache.upsert({
      tenantId,
      configType,
      configValues: values,
      fetchedAt: new Date(),
    });

    return values;
  } catch (err) {
    console.error(`[BLACKBAUD CONFIG] Failed to fetch ${configType}:`, err.message);
    // Return cached values if available
    const cached = await ReNxtConfigCache.findOne({
      where: { tenantId, configType },
    });
    return cached ? cached.configValues : [];
  }
}

/**
 * Get cached config values, refreshing if stale (> 24h).
 */
async function getCachedConfig(tenantId, configType) {
  const cached = await ReNxtConfigCache.findOne({
    where: { tenantId, configType },
  });

  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < CONFIG_CACHE_TTL) {
      return cached.configValues;
    }
  }

  // Stale or missing — refresh in background, return stale data if available
  const staleValues = cached ? cached.configValues : [];

  // Fire-and-forget refresh
  fetchAndCacheConfig(tenantId, configType).catch(() => {});

  return staleValues;
}

/**
 * Get all three config types at once (for populating dropdowns).
 */
async function getAllConfig(tenantId) {
  const [actionTypes, statusTypes, locations] = await Promise.all([
    getCachedConfig(tenantId, 'action_types'),
    getCachedConfig(tenantId, 'status_types'),
    getCachedConfig(tenantId, 'locations'),
  ]);

  return { actionTypes, statusTypes, locations };
}

/**
 * Force-refresh all config values (called on connect or on-demand).
 */
async function refreshAllConfig(tenantId) {
  const [actionTypes, statusTypes, locations] = await Promise.all([
    fetchAndCacheConfig(tenantId, 'action_types'),
    fetchAndCacheConfig(tenantId, 'status_types'),
    fetchAndCacheConfig(tenantId, 'locations'),
  ]);

  return { actionTypes, statusTypes, locations };
}

// ---------------------------------------------------------------------------
// Retry helper — retry a failed sync for a single action
// ---------------------------------------------------------------------------

/**
 * Retry syncing a single action that previously failed.
 * Looks at whether it has a reNxtActionId to decide create vs update.
 */
async function retrySync(tenantId, action, opts = {}) {
  if (action.reNxtActionId) {
    // Already created in RE NXT — update it
    return updateAction(tenantId, action.reNxtActionId, action, opts);
  } else {
    // Never made it to RE NXT — create it
    return createAction(tenantId, action, opts);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  mapActionToSkyApi,
  createAction,
  updateAction,
  completeAction,
  reopenAction,
  deleteAction,
  fetchAndCacheConfig,
  getCachedConfig,
  getAllConfig,
  refreshAllConfig,
  retrySync,
};
