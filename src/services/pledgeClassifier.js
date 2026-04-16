/**
 * Pledge Classifier
 *
 * Single source of truth for distinguishing the three flavours of CRM gift
 * records that arrive in a Blackbaud RE NXT export.
 *
 * IMPORTANT: RE NXT exports two columns that can carry the pledge signal:
 *
 *   - `gift_type`  (model: giftType)  — canonical kind set by RE NXT itself.
 *                  Values: "Cash", "Pledge", "Pledge Payment",
 *                  "Recurring Gift", "Recurring Gift Payment",
 *                  "Planned Gift", "MG Pay-Cash", "Stock/Property",
 *                  "Gift-in-Kind", "Other".
 *
 *   - `gift_code`  (model: giftCode)  — a user-defined sub-classification.
 *                  Often ("Pledge", "Pay-Cash", "Pay-Check", "MG Pledge"
 *                  etc.) but frequently left blank.
 *
 * Either column can mark a record as a pledge commitment, so we MUST check
 * both. An earlier version of the filter only checked `gift_code` — that
 * caused records with `gift_type='Pledge'` and `gift_code=NULL` to be
 * silently counted as realised cash, inflating revenue.
 *
 * Three categories produced:
 *   1. pledge_commitment — promised but not paid; NOT cash revenue.
 *   2. pledge_payment    — installment received against a commitment; IS cash.
 *   3. cash              — outright gift; IS cash.
 *
 * Re-exports `EXCLUDE_PLEDGE_SQL` from crmMaterializedViews so callers
 * have a single import surface.
 */
const { EXCLUDE_PLEDGE_SQL } = require('./crmMaterializedViews');

// ---------------------------------------------------------------------------
// SQL fragments — designed to be appended to an existing WHERE clause.
// All assume the gifts table is unaliased (columns `gift_code`, `gift_type`).
// Use the .replace(...) pattern from crmMaterializedViews.js to swap in a
// table alias when joining (e.g. swap `gift_code` → `g.gift_code` and
// `gift_type` → `g.gift_type`).
// ---------------------------------------------------------------------------

const _CODE_IS_COMMITMENT = `(gift_code IS NOT NULL AND (LOWER(gift_code) LIKE '%pledge%' OR LOWER(gift_code) LIKE '%planned%gift%') AND LOWER(gift_code) NOT LIKE 'pay-%' AND LOWER(gift_code) NOT LIKE '%pledge payment%')`;
const _TYPE_IS_COMMITMENT = `(gift_type IS NOT NULL AND LOWER(gift_type) IN ('pledge', 'planned gift', 'mg pledge', 'recurring gift pledge', 'stock pledge', 'matching gift pledge'))`;
const _CODE_IS_PAYMENT    = `(gift_code IS NOT NULL AND (LOWER(gift_code) LIKE 'pay-%' OR LOWER(gift_code) LIKE '%pledge payment%'))`;
const _TYPE_IS_PAYMENT    = `(gift_type IS NOT NULL AND LOWER(gift_type) IN ('pledge payment', 'recurring gift payment', 'mg pay-cash', 'mg pay-check'))`;

// Matches commitment / planned-gift rows that should NOT be counted as cash.
const PLEDGE_COMMITMENT_SQL = ` AND (${_CODE_IS_COMMITMENT} OR ${_TYPE_IS_COMMITMENT})`;

// Matches realised payments made against a pledge commitment.
const PLEDGE_PAYMENT_SQL = ` AND (${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT})`;

// Matches outright cash — neither a commitment nor a pledge payment.
const OUTRIGHT_CASH_SQL = ` AND NOT (${_CODE_IS_COMMITMENT} OR ${_TYPE_IS_COMMITMENT} OR ${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT})`;

// Matches ANY pledge-related row (commitment OR payment). Useful as a
// pre-filter on heavy pledge analytics queries so Postgres skips the 80-95%
// of rows that are outright cash before the expensive GROUP BY + MAX string
// aggregation work.
const PLEDGE_ANY_SQL = ` AND (${_CODE_IS_COMMITMENT} OR ${_TYPE_IS_COMMITMENT} OR ${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT})`;

// ---------------------------------------------------------------------------
// "One pledge = one gift" filters  (fixes the pledge-vs-payment double count)
// ---------------------------------------------------------------------------
// The donor-facing model is:
//   - 1 cash gift             -> 1 giving event
//   - 1 pledge commitment     -> 1 giving event (the donor's pledge record)
//   - N pledge payments       -> NOT separate events; they're installments
//                                against the parent pledge commitment
//
// So for COUNT / AVG we must exclude pledge PAYMENTS (leaving commitments +
// cash). For SUM (revenue) we must exclude pledge COMMITMENTS (leaving
// payments + cash — the only money that has actually been received).
//
// EXCLUDE_PLEDGE_PAYMENT_SQL is the counting filter. Pair it with
// EXCLUDE_PLEDGE_SQL (the revenue filter) via FILTER() clauses when a query
// needs both counts and sums at once.
// ---------------------------------------------------------------------------
const EXCLUDE_PLEDGE_PAYMENT_SQL = ` AND NOT (${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT})`;

// Aggregate-expression helpers for use inside SELECT lists on an unaliased
// crm_gifts scan. Each takes the bare column reference and produces a
// semantics-correct aggregate the dashboards can drop in.
//
//   GIFT_COUNT_EXPR_SQL     — count of giving events (cash + commitments)
//   GIFT_REVENUE_EXPR_SQL   — $ actually received (cash + pledge payments)
//   GIFT_AVG_EXPR_SQL       — revenue / count, matching the above semantics
//
// Using these two FILTER clauses in one query avoids the pitfall of
// applying a single WHERE filter that inflates one metric while deflating
// the other.
const GIFT_COUNT_EXPR_SQL   = `COUNT(*) FILTER (WHERE NOT (${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT}))`;
const GIFT_REVENUE_EXPR_SQL = `COALESCE(SUM(gift_amount) FILTER (WHERE NOT (${_CODE_IS_COMMITMENT} OR ${_TYPE_IS_COMMITMENT})), 0)`;
const GIFT_AVG_EXPR_SQL     = `CASE WHEN ${GIFT_COUNT_EXPR_SQL} > 0 THEN ${GIFT_REVENUE_EXPR_SQL}::numeric / ${GIFT_COUNT_EXPR_SQL} ELSE 0 END`;

// Aliased versions for JOINs where the gifts table is `g`. Swap the bare
// column references with g.-prefixed ones.
function withAlias(sql, alias = 'g') {
  return sql
    .replace(/\bgift_code\b/g, `${alias}.gift_code`)
    .replace(/\bgift_type\b/g, `${alias}.gift_type`)
    .replace(/\bgift_amount\b/g, `${alias}.gift_amount`);
}

// CASE expression that classifies any gift row into one of three buckets.
// Useful inside SELECT lists when we need to GROUP BY category. Order
// matters: payment patterns are checked before commitment patterns so a
// "Pay-Pledge" code is correctly classified as a payment.
const PLEDGE_CATEGORY_CASE_SQL = `CASE
  WHEN ${_CODE_IS_PAYMENT} OR ${_TYPE_IS_PAYMENT} THEN 'pledge_payment'
  WHEN ${_CODE_IS_COMMITMENT} OR ${_TYPE_IS_COMMITMENT} THEN 'pledge_commitment'
  ELSE 'cash'
END`;

// ---------------------------------------------------------------------------
// JS predicates — for in-memory classification when we already have a
// gift row loaded and want to bucket it without another DB round-trip.
// Accepts either a string (legacy gift_code) or an object { giftType,
// giftCode } (preferred).
// ---------------------------------------------------------------------------

function _normalize(arg) {
  if (arg == null) return { code: null, type: null };
  if (typeof arg === 'string') return { code: arg.toLowerCase(), type: null };
  return {
    code: arg.giftCode || arg.gift_code ? String(arg.giftCode || arg.gift_code).toLowerCase() : null,
    type: arg.giftType || arg.gift_type ? String(arg.giftType || arg.gift_type).toLowerCase() : null,
  };
}

const _COMMITMENT_TYPES = new Set(['pledge', 'planned gift', 'mg pledge', 'recurring gift pledge', 'stock pledge', 'matching gift pledge']);
const _PAYMENT_TYPES = new Set(['pledge payment', 'recurring gift payment', 'mg pay-cash', 'mg pay-check']);

function isPledgePayment(arg) {
  const { code, type } = _normalize(arg);
  if (code && (code.startsWith('pay-') || code.includes('pledge payment'))) return true;
  if (type && _PAYMENT_TYPES.has(type)) return true;
  return false;
}

function isPledgeCommitment(arg) {
  if (isPledgePayment(arg)) return false;
  const { code, type } = _normalize(arg);
  if (code && (code.includes('pledge') || /planned\s*gift/.test(code))) return true;
  if (type && _COMMITMENT_TYPES.has(type)) return true;
  return false;
}

function isOutrightCash(arg) {
  return !isPledgeCommitment(arg) && !isPledgePayment(arg);
}

function classifyGiftCode(arg) {
  if (isPledgePayment(arg)) return 'pledge_payment';
  if (isPledgeCommitment(arg)) return 'pledge_commitment';
  return 'cash';
}

module.exports = {
  // SQL fragments
  EXCLUDE_PLEDGE_SQL,            // revenue filter (exclude commitments)
  EXCLUDE_PLEDGE_PAYMENT_SQL,    // count filter (exclude payments)
  PLEDGE_COMMITMENT_SQL,
  PLEDGE_PAYMENT_SQL,
  PLEDGE_ANY_SQL,
  OUTRIGHT_CASH_SQL,
  PLEDGE_CATEGORY_CASE_SQL,
  // Aggregate helpers (for SELECT lists on unaliased crm_gifts)
  GIFT_COUNT_EXPR_SQL,
  GIFT_REVENUE_EXPR_SQL,
  GIFT_AVG_EXPR_SQL,
  withAlias,
  // JS predicates
  isPledgeCommitment,
  isPledgePayment,
  isOutrightCash,
  classifyGiftCode,
};
