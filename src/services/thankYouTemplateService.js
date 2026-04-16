/**
 * Thank-You Template Service
 *
 * Rendering engine for static (non-LLM) donor thank-you letter templates.
 * Templates are stored in the thank_you_templates table with
 * {{merge_field}} placeholders; this module turns them into a finished
 * letter body given a donor + gift context.
 *
 * Responsibilities:
 *   - Publish the catalog of supported merge fields (so the admin UI
 *     can render a paste-in reference).
 *   - Render a template string against a context object, doing safe
 *     substitution — unknown fields render as the empty string rather
 *     than leaking the raw placeholder to a donor.
 *   - Pick the best template for a given gift (fund → campaign → appeal
 *     → default).
 *   - Load the context for a real gift/donor from the database so the
 *     renderer doesn't have to know SQL.
 */
const { ThankYouTemplate, Tenant, CrmGift } = require('../models');

// ---------------------------------------------------------------------------
// Merge field catalog
// ---------------------------------------------------------------------------
// Each entry drives two things:
//   1. The UI shows `token` + `label` + `example` so users know what's
//      available to paste into the body.
//   2. The renderer looks up `token` on the rendered context object.
//
// When a field is context-derived (not direct), the mapping happens in
// buildContextForGift/buildContextForSample below. Keeping the catalog and
// the renderer decoupled from the source shape lets us add fields without
// changing the template body syntax.
const MERGE_FIELDS = [
  { token: 'donor_name',        label: 'Donor display name',       example: 'Marian Boxer' },
  { token: 'donor_first_name',  label: 'Donor first name',         example: 'Marian' },
  { token: 'donor_last_name',   label: 'Donor last name',          example: 'Boxer' },
  { token: 'donor_salutation',  label: 'Salutation line',          example: 'Dear Marian' },
  { token: 'donor_address',     label: 'Donor street address',     example: '123 Kingsway Dr.' },
  { token: 'donor_city',        label: 'Donor city',               example: 'Thunder Bay' },
  { token: 'donor_state',       label: 'Donor province / state',   example: 'ON' },
  { token: 'donor_zip',         label: 'Donor postal / ZIP',       example: 'P7B 2M5' },
  { token: 'gift_amount',       label: 'Gift amount (formatted)',  example: '$1,500.00' },
  { token: 'gift_amount_plain', label: 'Gift amount (plain num)',  example: '1500.00' },
  { token: 'gift_date',         label: 'Gift date',                example: 'April 12, 2026' },
  { token: 'gift_type',         label: 'Gift type',                example: 'Cash' },
  { token: 'fund_name',         label: 'Fund',                     example: 'Cardiology Fund' },
  { token: 'campaign_name',     label: 'Campaign',                 example: 'Capital Campaign 2026' },
  { token: 'appeal_name',       label: 'Appeal',                   example: 'Spring 2026 Appeal' },
  { token: 'organization_name', label: 'Organization name',        example: 'TBRHSF' },
  { token: 'today',             label: 'Today’s date',             example: 'April 16, 2026' },
];

function getSupportedMergeFields() {
  return MERGE_FIELDS.map(f => ({ ...f }));
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
// Matches {{token}} with optional surrounding whitespace inside the braces:
//   {{donor_name}}, {{ donor_name }}, {{donor.name}} (dot paths supported)
const MERGE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Render a template string against a context object.
 * Unknown tokens → empty string. Null/undefined values → empty string.
 * Strings are NOT HTML-escaped — templates are plain-text letter bodies.
 */
function renderTemplateString(str, context) {
  if (!str) return '';
  const ctx = context || {};
  return String(str).replace(MERGE_PATTERN, (_m, token) => {
    const value = resolveToken(ctx, token);
    return value == null ? '' : String(value);
  });
}

function resolveToken(ctx, token) {
  if (Object.prototype.hasOwnProperty.call(ctx, token)) return ctx[token];
  // Dot-path fallback: "gift.amount" → ctx.gift.amount
  const parts = token.split('.');
  let cur = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Render a whole template row (subject + body) against the context.
 * Returns { subject, body, missingTokens } where missingTokens lists any
 * placeholders referenced by the template but not present on the context
 * — used by the admin preview to warn the user.
 */
function renderTemplate(template, context) {
  const combined = `${template.subject || ''}\n${template.body || ''}`;
  const referenced = new Set();
  String(combined).replace(MERGE_PATTERN, (_m, token) => { referenced.add(token); return _m; });
  const present = new Set(Object.keys(context || {}));
  const knownAliases = new Set(MERGE_FIELDS.map(f => f.token));
  const missingTokens = [...referenced].filter(tok => {
    if (present.has(tok)) return false;
    if (knownAliases.has(tok)) return context[tok] == null;
    return true; // unknown token entirely
  });
  return {
    subject: renderTemplateString(template.subject, context),
    body: renderTemplateString(template.body, context),
    missingTokens,
  };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------
function formatMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function formatDateLong(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function composeDonorName(first, last) {
  const f = (first || '').trim();
  const l = (last || '').trim();
  return [f, l].filter(Boolean).join(' ');
}

/** Sample context used by the admin preview. */
function buildSampleContext(tenantName) {
  return {
    donor_name: 'Marian Boxer',
    donor_first_name: 'Marian',
    donor_last_name: 'Boxer',
    donor_salutation: 'Dear Marian',
    donor_address: '123 Kingsway Dr.',
    donor_city: 'Thunder Bay',
    donor_state: 'ON',
    donor_zip: 'P7B 2M5',
    gift_amount: '$1,500.00',
    gift_amount_plain: '1500.00',
    gift_date: formatDateLong(new Date()),
    gift_type: 'Cash',
    fund_name: 'Cardiology Fund',
    campaign_name: 'Capital Campaign 2026',
    appeal_name: 'Spring 2026 Appeal',
    organization_name: tenantName || 'Your Organization',
    today: formatDateLong(new Date()),
  };
}

/**
 * Build a merge-field context for a real gift row. Tolerant of partial
 * shapes — unknown fields render as the empty string.
 */
function buildContextFromGift(gift, tenant) {
  const g = gift || {};
  const first = g.firstName || g.first_name || '';
  const last = g.lastName || g.last_name || '';
  const donorName = composeDonorName(first, last)
    || g.constituentName
    || (g.constituentId ? `Constituent #${g.constituentId}` : '');
  return {
    donor_name: donorName,
    donor_first_name: first,
    donor_last_name: last,
    donor_salutation: first ? `Dear ${first}` : 'Dear Friend',
    donor_address: g.constituentAddress || g.constituent_address || '',
    donor_city: g.constituentCity || g.constituent_city || '',
    donor_state: g.constituentState || g.constituent_state || '',
    donor_zip: g.constituentZip || g.constituent_zip || '',
    gift_amount: formatMoney(g.giftAmount ?? g.gift_amount),
    gift_amount_plain: g.giftAmount != null ? Number(g.giftAmount).toFixed(2)
                       : (g.gift_amount != null ? Number(g.gift_amount).toFixed(2) : ''),
    gift_date: formatDateLong(g.giftDate || g.gift_date),
    gift_type: g.giftType || g.gift_type || g.giftCode || g.gift_code || '',
    fund_name: g.fundDescription || g.fund_description || '',
    campaign_name: g.campaignDescription || g.campaign_description || '',
    appeal_name: g.appealDescription || g.appeal_description || '',
    organization_name: (tenant && tenant.name) || '',
    today: formatDateLong(new Date()),
  };
}

// ---------------------------------------------------------------------------
// Scope resolution — which template applies to a given gift?
// ---------------------------------------------------------------------------
/**
 * Given a gift's {fundId, campaignId, appealId}, return the single best
 * matching template for this tenant:
 *   1. scope_type='fund'     + fund_id match
 *   2. scope_type='campaign' + campaign_id match
 *   3. scope_type='appeal'   + appeal_id match
 *   4. scope_type='default'
 * Archived templates are ignored. Returns null if no match at any level.
 */
async function pickTemplateForGift(tenantId, giftCtx) {
  const g = giftCtx || {};
  const base = { tenantId, isArchived: false };

  const tryFind = async (where) => ThankYouTemplate.findOne({
    where,
    order: [['updatedAt', 'DESC']],
  });

  if (g.fundId) {
    const t = await tryFind({ ...base, scopeType: 'fund', fundId: String(g.fundId) });
    if (t) return t;
  }
  if (g.campaignId) {
    const t = await tryFind({ ...base, scopeType: 'campaign', campaignId: String(g.campaignId) });
    if (t) return t;
  }
  if (g.appealId) {
    const t = await tryFind({ ...base, scopeType: 'appeal', appealId: String(g.appealId) });
    if (t) return t;
  }
  return tryFind({ ...base, scopeType: 'default' });
}

/**
 * Full end-to-end: load the gift + tenant, pick the template, render it.
 * Returns { template, context, rendered } or null if the gift isn't found.
 */
async function renderForGift(tenantId, giftId) {
  const gift = await CrmGift.findOne({
    where: { tenantId, giftId: String(giftId) },
    raw: true,
  });
  if (!gift) return null;
  const tenant = await Tenant.findByPk(tenantId, { raw: true });
  const template = await pickTemplateForGift(tenantId, {
    fundId: gift.fundId, campaignId: gift.campaignId, appealId: gift.appealId,
  });
  if (!template) return { template: null, gift, context: null, rendered: null };
  const context = buildContextFromGift(gift, tenant);
  const rendered = renderTemplate(template, context);
  return { template, gift, context, rendered };
}

module.exports = {
  MERGE_FIELDS,
  getSupportedMergeFields,
  renderTemplateString,
  renderTemplate,
  buildSampleContext,
  buildContextFromGift,
  pickTemplateForGift,
  renderForGift,
  formatMoney,
  formatDateLong,
  composeDonorName,
};
