/**
 * Major Gift threshold service
 *
 * Single source of truth for "what dollar amount counts as a major gift
 * at this tenant?" — used by dashboards, AI recommendations, Ask
 * Fund-Raise responses, and any code path that previously hardcoded the
 * number.
 *
 * Resolution rules:
 *   1. tenants.major_gift_threshold (admin-configured)
 *   2. DEFAULT_MAJOR_GIFT_THRESHOLD — $10,000
 *
 * We cache the per-tenant value in-process (5 minutes) because this gets
 * called on every dashboard request and almost never changes.
 */
const { Tenant } = require('../models');

/** App default when a tenant has not configured their own threshold. */
const DEFAULT_MAJOR_GIFT_THRESHOLD = 10000;

const _cache = new Map(); // tenantId -> { value, expiry }
const TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the configured threshold for a tenant. Falls back to the app
 * default on any error (never throws — dashboards must keep rendering).
 *
 * @param {number|string} tenantId
 * @returns {Promise<number>}
 */
async function getMajorGiftThreshold(tenantId) {
  if (!tenantId) return DEFAULT_MAJOR_GIFT_THRESHOLD;
  const key = String(tenantId);
  const hit = _cache.get(key);
  if (hit && Date.now() < hit.expiry) return hit.value;

  let value = DEFAULT_MAJOR_GIFT_THRESHOLD;
  try {
    const tenant = await Tenant.findByPk(tenantId, {
      attributes: ['majorGiftThreshold'],
      raw: true,
    });
    const configured = tenant && tenant.majorGiftThreshold;
    const parsed = configured != null ? Number(configured) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) value = parsed;
  } catch (err) {
    console.warn(`[majorGiftService] Failed to load tenant ${tenantId} — falling back to default:`, err.message);
  }

  _cache.set(key, { value, expiry: Date.now() + TTL_MS });
  return value;
}

/** Invalidate the cache for a tenant (called after admin updates). */
function clearMajorGiftThresholdCache(tenantId) {
  if (tenantId == null) { _cache.clear(); return; }
  _cache.delete(String(tenantId));
}

/**
 * Format a threshold dollar amount into a human label for UI/AI copy.
 *   10000   -> "$10,000+"
 *   500000  -> "$500,000+"
 *   1234.56 -> "$1,234.56+"
 */
function formatThresholdLabel(amount) {
  // Reject null / undefined / non-numeric-strings explicitly — Number(null)
  // returns 0 which otherwise renders as "$0+".
  if (amount == null || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  const hasCents = Math.abs(n % 1) > 0.001;
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }) + '+';
}

module.exports = {
  DEFAULT_MAJOR_GIFT_THRESHOLD,
  getMajorGiftThreshold,
  clearMajorGiftThresholdCache,
  formatThresholdLabel,
};
