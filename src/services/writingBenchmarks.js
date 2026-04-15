/**
 * Writing Benchmarks
 *
 * Computes cross-tenant pooled rates so a Foundation admin can see how
 * their numbers compare to the rest of the platform — "are we above
 * average on helpful rate, or are donors quietly telling us our voice
 * is off?"
 *
 * Always called from an admin route. The shape mirrors writingAnalytics
 * so the UI can subtract one from the other to produce a delta.
 *
 * Privacy
 * ───────
 * The whole point of this is comparison without revealing anything
 * tenant-specific. Two layers of protection:
 *
 *   1. Pooled rates only. We never expose individual tenants' numbers
 *      or names. The result is one rate per feature, computed across
 *      every other tenant's rows.
 *
 *   2. Per-feature minimum-contributors floor. If fewer than
 *      MIN_TENANTS distinct OTHER tenants contributed rows for a
 *      feature in the period, that feature's benchmark is null. With
 *      only 1–2 contributors, a comparison effectively names them.
 *
 *   3. The requesting tenant is always excluded from the pool, so the
 *      comparison reads as "you vs everyone else" rather than "you vs
 *      everyone including you" — which would dampen the comparison
 *      for high-volume tenants.
 */

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
// Privacy floor: no benchmark exposed unless this many distinct other
// tenants contributed rows for that feature.
const MIN_TENANTS = 3;

/**
 * @param {number} excludeTenantId - the calling tenant; excluded from the pool
 * @param {object} [opts]
 * @param {number|null} [opts.days=30] - day window; `null` = all time
 * @returns {Promise<{byFeature:object, periodDays:number|null, minTenants:number}>}
 */
async function getPlatformBenchmarks(excludeTenantId, opts = {}) {
  if (!excludeTenantId) throw new Error('excludeTenantId is required');

  let periodDays = null;
  if (opts.days !== null) {
    const parsed = parseInt(opts.days, 10);
    periodDays = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_DAYS) : DEFAULT_DAYS;
  }

  const replacements = { excludeTenantId };
  const whereClauses = ['tenant_id <> :excludeTenantId', 'is_hidden = false'];
  if (periodDays) {
    whereClauses.push(`created_at >= (CURRENT_TIMESTAMP - INTERVAL '${periodDays} days')`);
  }
  const whereSql = whereClauses.join(' AND ');

  // One row per feature: pooled counts across every contributing
  // tenant, plus the distinct-tenant count used to enforce the
  // privacy floor.
  const rows = await sequelize.query(`
    SELECT
      feature,
      COUNT(DISTINCT tenant_id)::int AS contributing_tenants,
      COUNT(*)::int AS total,
      SUM(CASE WHEN rating = 'helpful' THEN 1 ELSE 0 END)::int AS helpful,
      SUM(CASE WHEN rating = 'not_helpful' THEN 1 ELSE 0 END)::int AS not_helpful,
      SUM(CASE WHEN rating = 'neutral' THEN 1 ELSE 0 END)::int AS neutral,
      SUM(CASE WHEN is_saved THEN 1 ELSE 0 END)::int AS saved,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms
    FROM writing_outputs
    WHERE ${whereSql}
    GROUP BY feature
  `, { replacements, type: QueryTypes.SELECT });

  const byFeature = {};
  for (const r of rows) {
    const contributing = Number(r.contributing_tenants);
    if (contributing < MIN_TENANTS) continue; // Privacy floor — drop entire feature.

    const helpful = Number(r.helpful);
    const neutral = Number(r.neutral);
    const notHelpful = Number(r.not_helpful);
    const total = Number(r.total);
    const saved = Number(r.saved);
    const cacheRead = Number(r.cache_read_tokens);
    const cacheCreation = Number(r.cache_creation_tokens);
    const input = Number(r.input_tokens);
    const totalInput = input + cacheRead + cacheCreation;

    byFeature[r.feature] = {
      contributingTenants: contributing,
      total,
      helpfulRate: rate(helpful, helpful + neutral + notHelpful),
      saveRate: rate(saved, total),
      cacheHitRate: totalInput > 0 ? cacheRead / totalInput : null,
      avgDurationMs: Number(r.avg_duration_ms),
    };
  }

  return { byFeature, periodDays, minTenants: MIN_TENANTS };
}

function rate(numer, denom) {
  return denom > 0 ? numer / denom : null;
}

module.exports = {
  getPlatformBenchmarks,
  DEFAULT_DAYS,
  MAX_DAYS,
  MIN_TENANTS,
  // Exported for tests
  _internals: { rate },
};
