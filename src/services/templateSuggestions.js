/**
 * Template Suggestions
 *
 * Closes the *other* half of the learning loop. Where exemplars
 * (services/exemplars.js) reuse saved generations as style references
 * inside the prompt, this service watches for *patterns* in what the
 * tenant keeps saving and surfaces them as one-click templates.
 *
 * The signal is concrete and explainable: the same `(feature, params)`
 * combination has been ⭐ saved at least MIN_CLUSTER_SIZE times. If a
 * team has saved four warm thank-yous to a major-gift donor, the
 * combo is clearly working for them and deserves to live in the
 * Quick Start rail instead of being re-typed.
 *
 * Why exact-param clustering (not embeddings)?
 *   - Cheap (no extra service, no per-row embed cost).
 *   - Deterministic + auditable — admins can see exactly what went in.
 *   - The params drive the prompt builder, so identical params produce
 *     a near-identical system prompt. That's a stronger signal than
 *     surface-level similarity in the generated text.
 *   - Embedding-based clustering can land later as a v2 if needed.
 *
 * Suggestions are filtered out the moment a tenant template with the
 * same (feature, params) exists, so promoting a suggestion makes it
 * disappear from the list naturally — no separate "dismissed" state
 * to maintain.
 */

const { WritingOutput, WritingTemplate } = require('../models');

const MIN_CLUSTER_SIZE = 3;
// Cap how far back we look — prevents the JS-side clustering from
// degrading on tenants with thousands of saved rows. The most recent
// 500 saved rows is plenty of signal in practice.
const SCAN_LIMIT = 500;
const MAX_SUGGESTIONS = 12;

/**
 * Build a stable canonical signature for a params object so two
 * functionally-identical inputs (same fields, different key order or
 * empty-string vs missing) cluster together.
 *
 * Rules:
 *   - Drop null / undefined / empty-string values
 *   - Sort keys alphabetically
 *   - Trim string values
 *   - Stringify recursively (objects nested 1-2 levels deep are rare here
 *     but supported)
 *
 * Returns null when the params bag is functionally empty — those rows
 * shouldn't cluster (the suggestion would be a "blank template").
 */
function paramsSignature(params) {
  if (!params || typeof params !== 'object') return null;
  const cleaned = canonicalise(params);
  if (cleaned == null) return null;
  if (typeof cleaned === 'object' && Object.keys(cleaned).length === 0) return null;
  return JSON.stringify(cleaned);
}

function canonicalise(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? undefined : t;
  }
  if (Array.isArray(value)) {
    const arr = value.map(canonicalise).filter((v) => v !== undefined);
    return arr.length === 0 ? undefined : arr;
  }
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach((k) => {
      const v = canonicalise(value[k]);
      if (v !== undefined) out[k] = v;
    });
    return Object.keys(out).length === 0 ? undefined : out;
  }
  return value;
}

/**
 * Compute current template suggestions for a tenant.
 *
 * @param {number} tenantId
 * @returns {Promise<Array>} suggestion objects, ordered by cluster size DESC
 */
async function getSuggestions(tenantId) {
  if (!tenantId || !WritingOutput || !WritingTemplate) return [];

  let savedRows;
  let existingTemplates;
  try {
    [savedRows, existingTemplates] = await Promise.all([
      WritingOutput.findAll({
        where: { tenantId, isSaved: true, isHidden: false },
        order: [['createdAt', 'DESC']],
        limit: SCAN_LIMIT,
        attributes: ['id', 'feature', 'params', 'savedName', 'createdAt'],
      }),
      WritingTemplate.findAll({
        where: { tenantId, scope: 'tenant', isArchived: false },
        attributes: ['feature', 'params'],
      }),
    ]);
  } catch (err) {
    console.error('[TemplateSuggestions]', err.message);
    return [];
  }

  // Build the lookup of "already a template" combos so we don't suggest
  // promoting a pattern that's already promoted.
  const existingSet = new Set();
  for (const t of existingTemplates) {
    const sig = paramsSignature(t.params);
    if (sig != null) existingSet.add(`${t.feature}::${sig}`);
  }

  // Cluster the saved rows in JS by (feature, signature).
  const clusters = new Map();
  for (const row of savedRows) {
    const sig = paramsSignature(row.params);
    if (sig == null) continue;
    const key = `${row.feature}::${sig}`;
    if (existingSet.has(key)) continue;

    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        feature: row.feature,
        params: JSON.parse(sig), // re-parse so the UI receives the cleaned object
        count: 0,
        latestSavedName: null,
        latestSavedAt: null,
        exampleIds: [],
      };
      clusters.set(key, cluster);
    }
    cluster.count += 1;
    if (cluster.exampleIds.length < 3) cluster.exampleIds.push(row.id);
    if (!cluster.latestSavedAt || row.createdAt > cluster.latestSavedAt) {
      cluster.latestSavedAt = row.createdAt;
      if (row.savedName) cluster.latestSavedName = row.savedName;
    }
  }

  // Filter clusters that meet the minimum size and return them sorted.
  const suggestions = [];
  for (const cluster of clusters.values()) {
    if (cluster.count >= MIN_CLUSTER_SIZE) suggestions.push(cluster);
  }
  suggestions.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.latestSavedAt || 0) - (a.latestSavedAt || 0);
  });
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

module.exports = {
  getSuggestions,
  paramsSignature,
  MIN_CLUSTER_SIZE,
  SCAN_LIMIT,
  MAX_SUGGESTIONS,
  // Exposed for tests
  _internals: { canonicalise },
};
