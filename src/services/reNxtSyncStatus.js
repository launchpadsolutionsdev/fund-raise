/**
 * RE NXT Sync Status helpers
 *
 * These use raw SQL so they work whether or not the migration has run.
 * If the columns don't exist, reads return defaults and writes are no-ops.
 */

const { sequelize } = require('../models');

/**
 * Check if the re_nxt_sync columns exist on the actions table.
 * Cached after first check.
 */
let _columnsExist = null;
async function columnsExist() {
  if (_columnsExist !== null) return _columnsExist;
  try {
    const [rows] = await sequelize.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'actions' AND column_name = 're_nxt_sync_status'`
    );
    _columnsExist = rows.length > 0;
  } catch {
    _columnsExist = false;
  }
  return _columnsExist;
}

/**
 * Read sync fields for an action by ID.
 * Returns { reNxtActionId, reNxtSyncStatus, reNxtSyncError, reNxtLastSyncedAt } or defaults.
 */
async function getSyncStatus(actionId) {
  if (!(await columnsExist())) {
    return { reNxtActionId: null, reNxtSyncStatus: 'not_connected', reNxtSyncError: null, reNxtLastSyncedAt: null };
  }
  try {
    const [rows] = await sequelize.query(
      `SELECT re_nxt_action_id, re_nxt_sync_status, re_nxt_sync_error, re_nxt_last_synced_at
       FROM actions WHERE id = :id`,
      { replacements: { id: actionId } }
    );
    if (rows.length === 0) return { reNxtActionId: null, reNxtSyncStatus: 'not_connected', reNxtSyncError: null, reNxtLastSyncedAt: null };
    const r = rows[0];
    return {
      reNxtActionId: r.re_nxt_action_id,
      reNxtSyncStatus: r.re_nxt_sync_status || 'not_connected',
      reNxtSyncError: r.re_nxt_sync_error,
      reNxtLastSyncedAt: r.re_nxt_last_synced_at,
    };
  } catch {
    return { reNxtActionId: null, reNxtSyncStatus: 'not_connected', reNxtSyncError: null, reNxtLastSyncedAt: null };
  }
}

/**
 * Update sync fields for an action.
 * No-op if columns don't exist.
 */
async function updateSyncStatus(actionId, fields) {
  if (!(await columnsExist())) return;
  try {
    const sets = [];
    const replacements = { id: actionId };
    if ('reNxtActionId' in fields) {
      sets.push('re_nxt_action_id = :reNxtActionId');
      replacements.reNxtActionId = fields.reNxtActionId;
    }
    if ('reNxtSyncStatus' in fields) {
      sets.push('re_nxt_sync_status = :reNxtSyncStatus');
      replacements.reNxtSyncStatus = fields.reNxtSyncStatus;
    }
    if ('reNxtSyncError' in fields) {
      sets.push('re_nxt_sync_error = :reNxtSyncError');
      replacements.reNxtSyncError = fields.reNxtSyncError;
    }
    if ('reNxtLastSyncedAt' in fields) {
      sets.push('re_nxt_last_synced_at = :reNxtLastSyncedAt');
      replacements.reNxtLastSyncedAt = fields.reNxtLastSyncedAt;
    }
    if (sets.length === 0) return;
    await sequelize.query(
      `UPDATE actions SET ${sets.join(', ')} WHERE id = :id`,
      { replacements }
    );
  } catch (err) {
    console.error('[RE NXT SYNC] Failed to update sync status:', err.message);
  }
}

/**
 * Get the re_nxt_action_id for an action (for delete operations).
 */
async function getReNxtActionId(actionId) {
  if (!(await columnsExist())) return null;
  try {
    const [rows] = await sequelize.query(
      `SELECT re_nxt_action_id FROM actions WHERE id = :id`,
      { replacements: { id: actionId } }
    );
    return rows.length > 0 ? rows[0].re_nxt_action_id : null;
  } catch {
    return null;
  }
}

/**
 * Batch-fetch sync statuses for a list of action IDs.
 * Returns a Map of actionId → reNxtSyncStatus string.
 */
async function batchGetSyncStatuses(actionIds) {
  const map = {};
  if (!actionIds.length || !(await columnsExist())) return map;
  try {
    const [rows] = await sequelize.query(
      `SELECT id, re_nxt_sync_status FROM actions WHERE id IN (:ids)`,
      { replacements: { ids: actionIds } }
    );
    rows.forEach(r => { map[r.id] = r.re_nxt_sync_status || 'not_connected'; });
  } catch {
    // columns don't exist yet
  }
  return map;
}

module.exports = {
  columnsExist,
  getSyncStatus,
  updateSyncStatus,
  getReNxtActionId,
  batchGetSyncStatuses,
};
