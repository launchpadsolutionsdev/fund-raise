/**
 * Writing Analytics
 *
 * Aggregates the writing_outputs table by feature + prompt_version so
 * admins can tell which prompt variant is winning before promoting it.
 *
 * Scope:
 *   - Always tenant-scoped (tenant_id = :tenantId).
 *   - Excludes soft-deleted rows (is_hidden = false).
 *   - Optional date window — default 30 days.
 *
 * The query runs a single GROUP BY against the (tenant_id, created_at)
 * index. For tenants with millions of rows over time we could move this
 * to a materialised view; today's volumes are well within interactive
 * latency.
 */

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const FEATURES = ['writing', 'thankYou', 'impact', 'meetingPrep', 'digest'];

/**
 * Return per-feature, per-variant aggregates.
 *
 * @param {number} tenantId
 * @param {object} [opts]
 * @param {number} [opts.days=30] - day window; `null` = all time.
 * @returns {Promise<{summary:object, byFeature:object, periodDays:number|null}>}
 */
async function getVariantStats(tenantId, opts = {}) {
  if (!tenantId) throw new Error('tenantId is required');

  let periodDays = null;
  if (opts.days !== null) {
    const parsed = parseInt(opts.days, 10);
    periodDays = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_DAYS) : DEFAULT_DAYS;
  }

  const replacements = { tenantId };
  const whereClauses = ['tenant_id = :tenantId', 'is_hidden = false'];
  if (periodDays) {
    whereClauses.push(`created_at >= (CURRENT_TIMESTAMP - INTERVAL '${periodDays} days')`);
  }
  const whereSql = whereClauses.join(' AND ');

  const rows = await sequelize.query(`
    SELECT
      feature,
      COALESCE(prompt_version, '(untagged)') AS prompt_version,
      COUNT(*)::int AS total,
      SUM(CASE WHEN rating = 'helpful' THEN 1 ELSE 0 END)::int AS helpful,
      SUM(CASE WHEN rating = 'not_helpful' THEN 1 ELSE 0 END)::int AS not_helpful,
      SUM(CASE WHEN rating = 'neutral' THEN 1 ELSE 0 END)::int AS neutral,
      SUM(CASE WHEN rating IS NULL THEN 1 ELSE 0 END)::int AS unrated,
      SUM(CASE WHEN is_saved THEN 1 ELSE 0 END)::int AS saved,
      COALESCE(AVG(duration_ms), 0)::int AS avg_duration_ms,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      MIN(created_at) AS first_seen_at,
      MAX(created_at) AS last_seen_at
    FROM writing_outputs
    WHERE ${whereSql}
    GROUP BY feature, prompt_version
    ORDER BY feature ASC, total DESC
  `, { replacements, type: QueryTypes.SELECT });

  // Shape per-variant numbers and bucket by feature.
  const byFeature = {};
  const summary = emptyTotals();

  for (const r of rows) {
    const variant = {
      name: r.prompt_version,
      total: Number(r.total),
      helpful: Number(r.helpful),
      neutral: Number(r.neutral),
      notHelpful: Number(r.not_helpful),
      unrated: Number(r.unrated),
      saved: Number(r.saved),
      avgDurationMs: Number(r.avg_duration_ms),
      cacheReadTokens: Number(r.cache_read_tokens),
      cacheCreationTokens: Number(r.cache_creation_tokens),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    };
    variant.helpfulRate = rate(variant.helpful, variant.helpful + variant.neutral + variant.notHelpful);
    variant.saveRate = rate(variant.saved, variant.total);
    const totalInput = variant.inputTokens + variant.cacheReadTokens + variant.cacheCreationTokens;
    variant.cacheHitRate = totalInput > 0 ? variant.cacheReadTokens / totalInput : null;
    variant.totalInputTokens = totalInput;

    if (!byFeature[r.feature]) byFeature[r.feature] = [];
    byFeature[r.feature].push(variant);

    accumulate(summary, variant);
  }

  // Order keys for the UI: known features first in a stable order,
  // then any unexpected ones (e.g. deprecated features with lingering rows).
  const ordered = {};
  for (const f of FEATURES) {
    if (byFeature[f]) ordered[f] = byFeature[f];
  }
  for (const f of Object.keys(byFeature)) {
    if (!ordered[f]) ordered[f] = byFeature[f];
  }

  const totalInput = summary.inputTokens + summary.cacheReadTokens + summary.cacheCreationTokens;
  summary.helpfulRate = rate(summary.helpful, summary.helpful + summary.neutral + summary.notHelpful);
  summary.saveRate = rate(summary.saved, summary.total);
  summary.cacheHitRate = totalInput > 0 ? summary.cacheReadTokens / totalInput : null;
  summary.totalInputTokens = totalInput;

  return { summary, byFeature: ordered, periodDays };
}

function emptyTotals() {
  return {
    total: 0,
    helpful: 0,
    neutral: 0,
    notHelpful: 0,
    unrated: 0,
    saved: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function accumulate(sum, v) {
  sum.total += v.total;
  sum.helpful += v.helpful;
  sum.neutral += v.neutral;
  sum.notHelpful += v.notHelpful;
  sum.unrated += v.unrated;
  sum.saved += v.saved;
  sum.cacheReadTokens += v.cacheReadTokens;
  sum.cacheCreationTokens += v.cacheCreationTokens;
  sum.inputTokens += v.inputTokens;
  sum.outputTokens += v.outputTokens;
}

function rate(numer, denom) {
  return denom > 0 ? numer / denom : null;
}

module.exports = {
  getVariantStats,
  FEATURES,
  DEFAULT_DAYS,
  MAX_DAYS,
  // Exported for tests
  _internals: { rate, emptyTotals, accumulate },
};
