/**
 * Brand Voice Service
 *
 * Loads a tenant's configured writing voice and formats it into the
 * markdown block consumed by WritingService. The block is injected as
 * a second cache_control: ephemeral system block so it warms
 * per-tenant while the shared FOUNDATION_WRITING_GUIDE stays warm
 * across all tenants.
 *
 * Cache sizing caveat: Anthropic's prompt cache requires ≥1024 tokens
 * per block (Sonnet). Short brand-voice configs sit below that
 * threshold and silently won't cache — their tokens are simply billed
 * at full price on every call. The feature still works; the caching
 * is a bonus when the config is substantial enough to benefit.
 */

const { TenantBrandVoice } = require('../models');

/**
 * Fetch the tenant's brand voice.
 *
 * @param {number} tenantId
 * @returns {Promise<object|null>} voice row or null if none configured / disabled
 */
async function getBrandVoice(tenantId) {
  if (!tenantId || !TenantBrandVoice) return null;
  try {
    const voice = await TenantBrandVoice.findOne({ where: { tenantId } });
    if (!voice || !voice.isActive) return null;
    return voice;
  } catch (err) {
    console.error('[BrandVoice]', err.message);
    return null;
  }
}

/**
 * Format a voice row into the markdown system block the LLM consumes.
 * Returns null when no meaningful content is present — the caller can
 * then skip injecting the block entirely instead of sending a heading
 * with nothing under it.
 *
 * @param {object} voice - Sequelize row (or plain object) from TenantBrandVoice
 * @returns {string|null}
 */
function buildBrandVoiceBlock(voice) {
  if (!voice) return null;

  const sections = [];

  if (voice.toneDescription && voice.toneDescription.trim()) {
    sections.push(`## Organisation voice\n\n${voice.toneDescription.trim()}`);
  }

  if (Array.isArray(voice.organizationValues) && voice.organizationValues.length > 0) {
    const values = voice.organizationValues
      .map((v) => String(v || '').trim())
      .filter(Boolean)
      .map((v) => `- ${v}`)
      .join('\n');
    if (values) sections.push(`## Core values we want every piece of writing to reflect\n\n${values}`);
  }

  if (Array.isArray(voice.preferredTerms) && voice.preferredTerms.length > 0) {
    const rows = voice.preferredTerms
      .map((entry) => {
        if (!entry) return null;
        // Accept both { from, to } objects and plain string "from → to"
        if (typeof entry === 'string') return entry.trim();
        const from = String(entry.from || '').trim();
        const to = String(entry.to || '').trim();
        if (!from || !to) return null;
        return `- Use "${to}" instead of "${from}"`;
      })
      .filter(Boolean)
      .join('\n');
    if (rows) sections.push(`## Preferred vocabulary\n\n${rows}`);
  }

  if (Array.isArray(voice.bannedPhrases) && voice.bannedPhrases.length > 0) {
    const rows = voice.bannedPhrases
      .map((p) => String(p || '').trim())
      .filter(Boolean)
      .map((p) => `- ${p}`)
      .join('\n');
    if (rows) sections.push(`## Never use these words or phrases\n\n${rows}`);
  }

  if (voice.signatureBlock && voice.signatureBlock.trim()) {
    sections.push(`## Signature block\n\nWhen the output calls for a signature, use exactly this:\n\n${voice.signatureBlock.trim()}`);
  }

  if (voice.additionalGuidance && voice.additionalGuidance.trim()) {
    sections.push(`## Additional guidance\n\n${voice.additionalGuidance.trim()}`);
  }

  if (sections.length === 0) return null;

  return sections.join('\n\n');
}

/**
 * Convenience: fetch + format in one call.
 * Returns null if no active voice is configured or the formatted
 * block would be empty.
 */
async function getBrandVoiceBlock(tenantId) {
  const voice = await getBrandVoice(tenantId);
  return buildBrandVoiceBlock(voice);
}

module.exports = {
  getBrandVoice,
  buildBrandVoiceBlock,
  getBrandVoiceBlock,
};
