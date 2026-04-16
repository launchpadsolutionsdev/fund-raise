/**
 * Donor Context Service
 *
 * Bridges the CRM gift table into the writing features. Two public surfaces:
 *
 *   searchDonors(tenantId, query, { limit })
 *     - Autocomplete: aggregate distinct donors whose name or id matches.
 *       Returns compact records suitable for a dropdown.
 *
 *   getDonorProfile(tenantId, constituentId)
 *     - Detail fetch for a selected donor. Returns:
 *         { donor, mostRecentGift, contextString, uiPrefill }
 *       where contextString is a markdown block designed to be injected into
 *       the LLM prompt, and uiPrefill is the handful of fields a thank-you
 *       form should auto-populate on selection.
 *
 * Data model note: there is no separate Donor table. Identity is embedded in
 * crm_gifts rows keyed by (tenant_id, constituent_id). These functions
 * aggregate across that donor's gifts to produce a donor-centric view.
 *
 * PII note: contextString omits email, phone, and address — those aren't
 * needed to generate a thank-you letter and leaving them out reduces the
 * surface area of what the LLM sees.
 */

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const {
  GIFT_COUNT_EXPR_SQL, GIFT_REVENUE_EXPR_SQL, GIFT_AVG_EXPR_SQL,
  PLEDGE_CATEGORY_CASE_SQL,
} = require('./pledgeClassifier');

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const MIN_QUERY_LENGTH = 2;
const RECENT_GIFTS_LIMIT = 5;
const TOP_FUNDS_LIMIT = 3;
const QUERY_OPTS = { type: QueryTypes.SELECT, timeout: 10000 };

/**
 * Search donors by name or constituent ID.
 *
 * Aggregates crm_gifts by constituent_id so each donor appears once, with
 * their total giving and most recent gift surfaced for the autocomplete row.
 *
 * Multi-word queries ("Margaret Thompson") match first_name AND last_name
 * as a pair, then fall back to substring match on either field — same
 * strategy searchGifts uses, adapted for donor-level aggregation.
 *
 * @param {number|string} tenantId
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=10]
 * @returns {Promise<Array<{
 *   constituentId: string,
 *   firstName: string|null,
 *   lastName: string|null,
 *   displayName: string,
 *   constituentType: string|null,
 *   totalGifts: number,
 *   totalGiven: number,
 *   lastGiftDate: string|null,
 *   lastGiftAmount: number|null
 * }>>}
 */
async function searchDonors(tenantId, query, opts = {}) {
  const trimmed = (query || '').trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const limit = Math.min(
    Math.max(parseInt(opts.limit, 10) || DEFAULT_SEARCH_LIMIT, 1),
    MAX_SEARCH_LIMIT
  );

  const terms = trimmed.split(/\s+/);
  const replacements = {
    tenantId,
    search: `%${trimmed}%`,
    limit,
  };

  let matchClause;
  if (terms.length > 1) {
    replacements.searchFirst = `%${terms[0]}%`;
    replacements.searchLast = `%${terms[terms.length - 1]}%`;
    matchClause = `(
      (first_name ILIKE :searchFirst AND last_name ILIKE :searchLast)
      OR first_name ILIKE :search
      OR last_name ILIKE :search
      OR constituent_name ILIKE :search
      OR constituent_id ILIKE :search
    )`;
  } else {
    matchClause = `(
      first_name ILIKE :search
      OR last_name ILIKE :search
      OR constituent_name ILIKE :search
      OR constituent_id ILIKE :search
    )`;
  }

  // total_gifts = cash + pledge commitments; total_given = cash + pledge payments.
  const rows = await sequelize.query(`
    SELECT
      constituent_id,
      (ARRAY_AGG(first_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE first_name IS NOT NULL))[1] AS first_name,
      (ARRAY_AGG(last_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE last_name IS NOT NULL))[1] AS last_name,
      (ARRAY_AGG(constituent_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE constituent_name IS NOT NULL))[1] AS constituent_name,
      (ARRAY_AGG(constituent_type ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE constituent_type IS NOT NULL))[1] AS constituent_type,
      ${GIFT_COUNT_EXPR_SQL} AS total_gifts,
      ${GIFT_REVENUE_EXPR_SQL} AS total_given,
      MAX(gift_date) AS last_gift_date,
      (ARRAY_AGG(gift_amount ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE gift_amount IS NOT NULL AND ${PLEDGE_CATEGORY_CASE_SQL} IN ('cash','pledge_payment')))[1] AS last_gift_amount
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND ${matchClause}
    GROUP BY constituent_id
    ORDER BY ${GIFT_REVENUE_EXPR_SQL} DESC NULLS LAST
    LIMIT :limit
  `, { replacements, ...QUERY_OPTS });

  return rows.map(r => ({
    constituentId: r.constituent_id,
    firstName: r.first_name,
    lastName: r.last_name,
    displayName: buildDisplayName(r),
    constituentType: r.constituent_type,
    totalGifts: Number(r.total_gifts) || 0,
    totalGiven: Number(r.total_given) || 0,
    lastGiftDate: r.last_gift_date,
    lastGiftAmount: r.last_gift_amount != null ? Number(r.last_gift_amount) : null,
  }));
}

/**
 * Fetch a donor profile for the thank-you generator.
 *
 * @param {number|string} tenantId
 * @param {string} constituentId
 * @returns {Promise<{
 *   donor: object,
 *   mostRecentGift: object|null,
 *   topFunds: Array<string>,
 *   contextString: string,
 *   uiPrefill: { donorName: string, giftAmount: number|null, designation: string|null }
 * }|null>}
 */
async function getDonorProfile(tenantId, constituentId) {
  if (!constituentId) return null;

  const repl = { tenantId, constituentId };

  const [summaryRows, giftRows] = await Promise.all([
    sequelize.query(`
      SELECT
        constituent_id,
        (ARRAY_AGG(first_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE first_name IS NOT NULL))[1] AS first_name,
        (ARRAY_AGG(last_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE last_name IS NOT NULL))[1] AS last_name,
        (ARRAY_AGG(constituent_name ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE constituent_name IS NOT NULL))[1] AS constituent_name,
        (ARRAY_AGG(primary_addressee ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE primary_addressee IS NOT NULL))[1] AS primary_addressee,
        (ARRAY_AGG(constituent_type ORDER BY gift_date DESC NULLS LAST) FILTER (WHERE constituent_type IS NOT NULL))[1] AS constituent_type,
        ${GIFT_COUNT_EXPR_SQL} AS total_gifts,
        ${GIFT_REVENUE_EXPR_SQL} AS total_given,
        ${GIFT_AVG_EXPR_SQL} AS avg_gift,
        COALESCE(MAX(gift_amount) FILTER (WHERE ${PLEDGE_CATEGORY_CASE_SQL} IN ('cash','pledge_payment')), 0) AS largest_gift,
        MIN(gift_date) AS first_gift_date,
        MAX(gift_date) AS last_gift_date,
        COUNT(DISTINCT fund_id) AS unique_funds
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId
      GROUP BY constituent_id
    `, { replacements: repl, ...QUERY_OPTS }),

    sequelize.query(`
      SELECT gift_id, gift_date, gift_amount, gift_code,
             fund_description, fund_id,
             campaign_description, appeal_description
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND constituent_id = :constituentId
      ORDER BY gift_date DESC NULLS LAST
      LIMIT 20
    `, { replacements: repl, ...QUERY_OPTS }),
  ]);

  const summary = summaryRows[0];
  if (!summary) return null;

  const donor = {
    constituentId: summary.constituent_id,
    firstName: summary.first_name,
    lastName: summary.last_name,
    displayName: buildDisplayName(summary),
    primaryAddressee: summary.primary_addressee,
    constituentType: summary.constituent_type,
    totalGifts: Number(summary.total_gifts) || 0,
    totalGiven: Number(summary.total_given) || 0,
    avgGift: Number(summary.avg_gift) || 0,
    largestGift: Number(summary.largest_gift) || 0,
    firstGiftDate: summary.first_gift_date,
    lastGiftDate: summary.last_gift_date,
    uniqueFunds: Number(summary.unique_funds) || 0,
  };

  const gifts = giftRows.map(g => ({
    giftId: g.gift_id,
    date: g.gift_date,
    amount: g.gift_amount != null ? Number(g.gift_amount) : null,
    fund: g.fund_description || null,
    campaign: g.campaign_description || null,
    appeal: g.appeal_description || null,
  }));

  const mostRecentGift = gifts[0] || null;
  const topFunds = collectTopFunds(gifts, TOP_FUNDS_LIMIT);

  return {
    donor,
    mostRecentGift,
    topFunds,
    contextString: buildContextString(donor, gifts, topFunds),
    uiPrefill: {
      donorName: donor.primaryAddressee || donor.displayName || '',
      giftAmount: mostRecentGift && mostRecentGift.amount != null ? mostRecentGift.amount : null,
      designation: mostRecentGift ? (mostRecentGift.fund || mostRecentGift.appeal || null) : null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildDisplayName(row) {
  const first = (row.first_name || '').trim();
  const last = (row.last_name || '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  const name = (row.constituent_name || '').trim();
  if (name && !/^(anonymous|unknown|n\/?a)$/i.test(name)) return name;
  // Never show "Anonymous" when the constituent_id is known — fall back to
  // "Constituent #<id>" so the team can still find them in RE NXT.
  if (row.constituent_id) return `Constituent #${row.constituent_id}`;
  return 'Unnamed donor';
}

function collectTopFunds(gifts, limit) {
  const totals = new Map();
  for (const g of gifts) {
    if (!g.fund || g.amount == null) continue;
    totals.set(g.fund, (totals.get(g.fund) || 0) + g.amount);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([fund]) => fund);
}

/**
 * Build the compact markdown block the LLM sees.
 *
 * Deliberately short: the writing prompts are already substantial, and the
 * LLM does better with a focused, scannable profile than an exhaustive dump.
 * Omits contact info (email, phone, address) — not needed for letter generation.
 */
function buildContextString(donor, recentGifts, topFunds) {
  const lines = [];
  const name = donor.primaryAddressee || donor.displayName;
  lines.push(`**${name}** (constituent ${donor.constituentId})`);

  if (donor.constituentType) {
    lines.push(`- Type: ${donor.constituentType}`);
  }

  if (donor.firstGiftDate) {
    lines.push(`- Supporter since: ${formatDate(donor.firstGiftDate)}`);
  }

  if (donor.totalGifts > 0) {
    lines.push(
      `- Lifetime giving: ${formatMoney(donor.totalGiven)} across ${donor.totalGifts} gift${donor.totalGifts === 1 ? '' : 's'}` +
      (donor.largestGift > 0 ? ` (largest ${formatMoney(donor.largestGift)})` : '')
    );
  }

  if (topFunds.length > 0) {
    lines.push(`- Primary interests: ${topFunds.join(', ')}`);
  }

  const recent = recentGifts.slice(0, RECENT_GIFTS_LIMIT);
  if (recent.length > 0) {
    lines.push('- Recent gifts:');
    for (const g of recent) {
      const bits = [];
      if (g.amount != null) bits.push(formatMoney(g.amount));
      if (g.fund) bits.push(`to ${g.fund}`);
      if (g.date) bits.push(`on ${formatDate(g.date)}`);
      lines.push(`  - ${bits.join(' ')}`);
    }
  }

  return lines.join('\n');
}

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '$0';
  return `$${Math.round(num).toLocaleString('en-CA')}`;
}

function formatDate(d) {
  if (!d) return '';
  // Accept Date or ISO string; emit YYYY-MM-DD so the LLM sees the exact date.
  const s = typeof d === 'string' ? d : d.toISOString();
  return s.slice(0, 10);
}

module.exports = {
  searchDonors,
  getDonorProfile,
  // Exported for tests
  _internals: {
    buildDisplayName,
    collectTopFunds,
    buildContextString,
    formatMoney,
    formatDate,
  },
};
