'use strict';

/**
 * Scheduled background jobs for the Fund-Raise platform.
 *
 * Designed for a multi-tenant SaaS deployment:
 *
 *   - Single in-process scheduler started from app.js at boot.
 *   - Postgres advisory lock guards each run so multiple Node instances
 *     (e.g. Render auto-scale) don't all try to refresh the same MV at
 *     the same time. Whoever grabs the lock runs the job; the rest skip.
 *   - "Already running" guard inside this process so a slow refresh
 *     doesn't get re-entered if the next interval fires before it
 *     finishes.
 *   - Random startup jitter prevents thundering-herd if many instances
 *     boot at the exact same second (rolling deploy).
 *   - Errors are caught, logged, and surfaced via getStatus() — they
 *     never crash the parent process.
 *
 * Currently scheduled:
 *   - refreshMaterializedViews: every MV_REFRESH_INTERVAL_MIN minutes
 *     (default 30). MVs back every dashboard query in the CRM, so a
 *     stale MV directly causes wrong numbers in the UI and PDF reports.
 *
 * Add new jobs by following the same pattern: lock → run → log → unlock.
 */

const { sequelize } = require('../models');
const { refreshMaterializedViews } = require('./crmMaterializedViews');

const REFRESH_INTERVAL_MIN = Number(process.env.MV_REFRESH_INTERVAL_MIN) || 30;

// Arbitrary unique 32-bit signed int — Postgres advisory locks share a
// single namespace per database, so just pick a number nothing else uses.
const MV_REFRESH_LOCK_KEY = 91827364;

const _state = {
  isRunning: false,
  lastRun: null,
  lastResult: null,
  intervalHandle: null,
  intervalMin: REFRESH_INTERVAL_MIN,
  startedAt: null,
};

/**
 * Run a single MV refresh, gated by both an in-process flag and a
 * Postgres advisory lock for cross-instance coordination. Returns
 * the result object; never throws.
 */
async function refreshMaterializedViewsLocked({ source = 'scheduler' } = {}) {
  if (_state.isRunning) {
    console.log(`[ScheduledJobs] MV refresh skipped (${source}) — previous run still in progress`);
    return { ok: false, skipped: true, reason: 'already-running' };
  }
  _state.isRunning = true;
  const t0 = Date.now();
  let lockAcquired = false;

  try {
    // Non-blocking try-lock. Returns false immediately if another
    // instance has it; we'll just skip this round.
    const rows = await sequelize.query(
      'SELECT pg_try_advisory_lock(:key) AS acquired',
      { replacements: { key: MV_REFRESH_LOCK_KEY }, type: sequelize.QueryTypes.SELECT }
    );
    lockAcquired = rows[0] && rows[0].acquired === true;

    if (!lockAcquired) {
      console.log(`[ScheduledJobs] MV refresh skipped (${source}) — another instance holds the lock`);
      const result = { ok: false, skipped: true, reason: 'lock-held-by-other-instance' };
      _state.lastResult = result;
      return result;
    }

    console.log(`[ScheduledJobs] MV refresh starting (${source})...`);

    // Ensure MVs exist. Previously used CREATE MATERIALIZED VIEW IF NOT EXISTS
    // unconditionally, but that takes AccessExclusive locks on every MV
    // (even when they already exist), serialising behind any in-flight
    // dashboard query — pushing refresh time from ~40s to 90s+ on Thunder
    // Bay's data. Instead: cheap metadata check first; only call the heavy
    // createMaterializedViews() path on a brand-new tenant where they're
    // actually missing.
    const existsRows = await sequelize.query(
      `SELECT COUNT(*)::int AS n FROM pg_matviews WHERE matviewname = 'mv_crm_gift_fy'`,
      { type: sequelize.QueryTypes.SELECT }
    );
    const mvsExist = existsRows[0] && Number(existsRows[0].n) > 0;
    if (!mvsExist) {
      console.log('[ScheduledJobs] MVs missing — running createMaterializedViews()');
      const { createMaterializedViews } = require('./crmMaterializedViews');
      await createMaterializedViews();
    }
    await refreshMaterializedViews();

    // Invalidate the in-process dashboard cache now that the MVs are fresh.
    // Without this, getCrmOverview() and friends will keep serving the old
    // cached aggregates for up to 10 minutes (CACHE_TTL) after a refresh —
    // which looked like "refresh didn't do anything" in the UI.  Cleared
    // across every tenant because an MV refresh updates every tenant's
    // data in one shot.
    const { clearAllCrmCache } = require('./crmDashboardService');
    clearAllCrmCache();
    console.log('[ScheduledJobs] In-process dashboard cache cleared');
    const durationMs = Date.now() - t0;
    const result = { ok: true, source, durationMs, completedAt: new Date().toISOString() };
    _state.lastResult = result;
    console.log(`[ScheduledJobs] MV refresh completed (${source}) in ${(durationMs / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    const result = {
      ok: false,
      source,
      error: err.message,
      durationMs: Date.now() - t0,
      completedAt: new Date().toISOString(),
    };
    _state.lastResult = result;
    console.error(`[ScheduledJobs] MV refresh failed (${source}) after ${result.durationMs}ms:`, err.message);
    return result;
  } finally {
    if (lockAcquired) {
      try {
        await sequelize.query('SELECT pg_advisory_unlock(:key)', {
          replacements: { key: MV_REFRESH_LOCK_KEY },
          type: sequelize.QueryTypes.SELECT,
        });
      } catch (e) {
        console.warn('[ScheduledJobs] Failed to release advisory lock:', e.message);
      }
    }
    _state.lastRun = new Date().toISOString();
    _state.isRunning = false;
  }
}

/**
 * Start the in-process scheduler. Idempotent — calling twice is a no-op.
 *
 * Does NOT run a refresh immediately on boot, because:
 *   1. render.yaml's buildCommand already rebuilds MVs on deploy.
 *   2. Running on every boot inflates DB load on app restarts.
 * The first scheduled run fires after one full interval has elapsed.
 */
function startScheduledJobs() {
  if (_state.intervalHandle) {
    console.log('[ScheduledJobs] Already started, ignoring duplicate startScheduledJobs() call');
    return;
  }

  const intervalMs = REFRESH_INTERVAL_MIN * 60 * 1000;
  // 0–60s of jitter on the FIRST run to spread out thundering herd if
  // many instances boot at the exact same second on a rolling deploy.
  const jitterMs = Math.floor(Math.random() * 60_000);

  console.log(
    `[ScheduledJobs] MV refresh scheduled every ${REFRESH_INTERVAL_MIN}min ` +
    `(first run in ~${Math.round((intervalMs + jitterMs) / 60000)}min)`
  );

  // Use setTimeout for the first run (with jitter) so all instances don't
  // hit at exactly N minutes after boot, then setInterval thereafter.
  setTimeout(function firstRun() {
    refreshMaterializedViewsLocked({ source: 'scheduler' });
    _state.intervalHandle = setInterval(
      () => refreshMaterializedViewsLocked({ source: 'scheduler' }),
      intervalMs
    );
  }, intervalMs + jitterMs);

  _state.startedAt = new Date().toISOString();
}

/** Stop the scheduler — used by tests. */
function stopScheduledJobs() {
  if (_state.intervalHandle) {
    clearInterval(_state.intervalHandle);
    _state.intervalHandle = null;
  }
}

/** Snapshot of the scheduler state — surfaced via the admin status endpoint. */
function getStatus() {
  return {
    enabled: !!_state.intervalHandle || !!_state.startedAt,
    intervalMin: _state.intervalMin,
    isRunning: _state.isRunning,
    lastRun: _state.lastRun,
    lastResult: _state.lastResult,
    startedAt: _state.startedAt,
  };
}

module.exports = {
  startScheduledJobs,
  stopScheduledJobs,
  getStatus,
  refreshMaterializedViewsLocked,
};
