/**
 * Exemplars Service
 *
 * Closes the writing-tool feedback loop: when a user clicks ⭐ Save on
 * a generation, that row joins the tenant's exemplar pool for that
 * feature. On future generations of the same feature, the top exemplars
 * are spliced into the system prompt as a *third* `cache_control:
 * ephemeral` block, sandwiched between the per-tenant brand voice and
 * the per-call feature prompt.
 *
 * Why this matters
 * ────────────────
 * Brand-voice configuration captures *what the tenant says they want*.
 * Saved outputs capture *what the tenant actually shipped*. Real
 * exemplars are far more compressive and concrete than any rule list,
 * and Claude is notably good at imitating shown style.
 *
 * Selection rules
 * ───────────────
 *   - Same tenant, same feature
 *   - is_saved = true, is_hidden = false
 *   - Order: rating='helpful' first, then most recent
 *   - Top 3 rows
 *   - Each capped at 4 KB; total block capped at 10 KB
 *
 * Caching
 * ───────
 * The block is intentionally cache_control: ephemeral so repeated
 * generations within a session reuse it. Cache invalidates whenever the
 * exemplar set changes (admin saves a new one, or rotation drops one
 * out), which is the desired behaviour — we want fresh exemplars warm,
 * not stale ones.
 *
 * Kill switch
 * ───────────
 * Tenants can disable exemplar injection from the Brand Voice settings
 * page (tenant_brand_voices.use_exemplars). Tenants who haven't
 * configured a brand voice row at all are treated as opted-in (the
 * feature is on out of the box).
 */

const { WritingOutput, TenantBrandVoice } = require('../models');

const MAX_EXEMPLARS = 3;
const MAX_EXEMPLAR_CHARS = 4000;   // ~1k tokens per exemplar
const MAX_BLOCK_CHARS = 10000;     // ~2.5k tokens of exemplar content

/**
 * Select exemplar rows for a tenant + feature.
 *
 * Returns an empty array (never throws) if anything goes wrong, so a
 * DB hiccup at generation time degrades to "no exemplars" rather than
 * blocking the user from generating.
 *
 * @param {number} tenantId
 * @param {string} feature
 * @param {object} [opts]
 * @param {number} [opts.limit] - override default MAX_EXEMPLARS
 * @returns {Promise<Array>} Sequelize rows (possibly empty)
 */
async function getExemplars(tenantId, feature, opts = {}) {
  if (!tenantId || !feature || !WritingOutput) return [];
  const limit = Math.max(1, Math.min(opts.limit || MAX_EXEMPLARS, MAX_EXEMPLARS));
  try {
    // Order: helpful first (rating='helpful'), then by most recent.
    // Postgres sorts NULLs last by default for DESC, which works in our
    // favour since unrated rows naturally fall behind helpful ones.
    const { Sequelize } = require('sequelize');
    const rows = await WritingOutput.findAll({
      where: {
        tenantId,
        feature,
        isSaved: true,
        isHidden: false,
      },
      order: [
        // CASE-style ordering: helpful=0, everything else=1
        [Sequelize.literal("CASE WHEN rating = 'helpful' THEN 0 ELSE 1 END"), 'ASC'],
        ['createdAt', 'DESC'],
      ],
      limit,
    });
    return rows || [];
  } catch (err) {
    console.error('[Exemplars]', err.message);
    return [];
  }
}

/**
 * Format a list of exemplar rows into the markdown block the LLM
 * consumes. Returns null when the list is empty so callers can skip
 * injecting a heading with no body.
 *
 * Each exemplar is truncated individually, and the joined block is
 * truncated as a whole, so the cost is bounded regardless of how
 * verbose any one saved output happens to be.
 *
 * @param {Array} rows - sequelize rows from getExemplars
 * @param {string} feature
 * @returns {string|null}
 */
function buildExemplarsBlock(rows, feature) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const sections = [];
  let totalChars = 0;

  for (const row of rows) {
    const text = String(row.generatedText || '').trim();
    if (!text) continue;

    const truncated = text.length > MAX_EXEMPLAR_CHARS
      ? `${text.slice(0, MAX_EXEMPLAR_CHARS)}\n[…truncated]`
      : text;

    const label = row.savedName && String(row.savedName).trim()
      ? String(row.savedName).trim().slice(0, 120)
      : `Example ${sections.length + 1}`;

    const section = `### ${label}\n\n${truncated}`;
    if (totalChars + section.length > MAX_BLOCK_CHARS) break;

    sections.push(section);
    totalChars += section.length;
  }

  if (sections.length === 0) return null;

  // Heading frames the block so the model treats it as style reference,
  // not as content to repeat verbatim.
  const header = `## Examples this Foundation has saved as ⭐ exemplars\n\n`
    + `These are real outputs the team has explicitly approved for the **${feature}** feature. `
    + `Match their voice, structure, level of specificity, and length. Do not copy them verbatim — `
    + `produce a fresh response in the same spirit, tuned to the new request.`;

  return `${header}\n\n${sections.join('\n\n')}`;
}

/**
 * Convenience: check the kill switch, fetch exemplars, format them.
 *
 * Returns null if:
 *   - No tenantId / feature
 *   - The tenant has explicitly disabled exemplars
 *   - No saved rows exist
 *
 * Tenants with no brand voice row are treated as opted-in (the feature
 * is on by default; admins flip it off explicitly).
 *
 * @param {number} tenantId
 * @param {string} feature
 * @returns {Promise<string|null>}
 */
async function getExemplarsBlock(tenantId, feature) {
  if (!tenantId || !feature) return null;

  // Kill-switch check. Missing row → opted-in (default true).
  if (TenantBrandVoice) {
    try {
      const voice = await TenantBrandVoice.findOne({
        where: { tenantId },
        attributes: ['useExemplars'],
      });
      if (voice && voice.useExemplars === false) return null;
    } catch (err) {
      // A lookup failure shouldn't block the feature — fall through and
      // try to fetch exemplars anyway.
      console.error('[Exemplars] kill-switch lookup failed:', err.message);
    }
  }

  const rows = await getExemplars(tenantId, feature);
  return buildExemplarsBlock(rows, feature);
}

module.exports = {
  getExemplars,
  buildExemplarsBlock,
  getExemplarsBlock,
  // Exposed for tests
  _internals: {
    MAX_EXEMPLARS,
    MAX_EXEMPLAR_CHARS,
    MAX_BLOCK_CHARS,
  },
};
