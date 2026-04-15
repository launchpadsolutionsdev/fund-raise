/**
 * LYBUNT / SYBUNT — V2
 * -----------------------------------------------------------------------------
 * A ground-up rewrite of the LYBUNT/SYBUNT analytics that fixes the
 * credibility issues in the original getLybuntSybunt (crmDashboardService.js):
 *
 *   1. SYBUNT "revenue at risk" no longer sums every gift a donor ever made
 *      before the prior FY. It uses their *most recent active fiscal year's
 *      giving* — i.e. the annual amount the org will continue to forego each
 *      year if the donor is not re-engaged.
 *
 *   2. A probability-weighted "Realistic Recovery" metric is introduced
 *      alongside the unweighted "Foregone Revenue" number. Recapture
 *      probabilities default to industry benchmarks and decay with years
 *      lapsed.
 *
 *   3. KPI cards, giving-band chart, and donor table ALL derive from the same
 *      filtered cohort — so segment filters affect every number on the page.
 *
 *   4. Priority score and suggested ask are computed per-donor in SQL so the
 *      dashboard produces a true work queue out of the box.
 *
 * This file is deliberately standalone. The legacy getLybuntSybunt in
 * crmDashboardService.js is untouched; both can be served side-by-side behind
 * different routes while users validate the new numbers.
 */

const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { EXCLUDE_PLEDGE_SQL, fyCaseSql } = require('./crmMaterializedViews');

const QUERY_OPTS = { type: QueryTypes.SELECT, timeout: 20000 };

// Pledge exclusion aliases (gift rows only — no alias vs g. alias)
const EXCL = EXCLUDE_PLEDGE_SQL;
const EXCL_G = EXCLUDE_PLEDGE_SQL.replace(/gift_code/g, 'g.gift_code');

// -----------------------------------------------------------------------------
// Tenant fiscal year helpers (duplicated lightly from crmDashboardService so
// this module stays standalone; safe because these are pure functions)
// -----------------------------------------------------------------------------
const fyMonthCache = new Map();
const FY_MONTH_TTL = 10 * 60 * 1000;

async function getTenantFyMonth(tenantId) {
  const hit = fyMonthCache.get(tenantId);
  if (hit && Date.now() < hit.expiry) return hit.data;
  const { Tenant } = require('../models');
  const tenant = await Tenant.findByPk(tenantId, { attributes: ['fiscalYearStart'] });
  const month = tenant?.fiscalYearStart || 4;
  fyMonthCache.set(tenantId, { data: month, expiry: Date.now() + FY_MONTH_TTL });
  return month;
}

function fyStart(fy, fyMonth) {
  const m = String(fyMonth).padStart(2, '0');
  const offset = fyMonth === 1 ? 0 : 1;
  return `${fy - offset}-${m}-01`;
}
function fyEnd(fy, fyMonth) {
  const m = String(fyMonth).padStart(2, '0');
  const offset = fyMonth === 1 ? 0 : 1;
  return `${fy - offset + 1}-${m}-01`;
}

// -----------------------------------------------------------------------------
// Recapture probability benchmark table
// -----------------------------------------------------------------------------
// Based on published sector benchmarks for non-profit donor recapture after a
// targeted reactivation campaign (M+R Benchmarks, AFP Fundraising Effectiveness
// Project). These are conservative midpoints — a tenant can override them via
// tenant-level config in future iterations. For now they live in code.
//
//   1 year lapsed  (LYBUNT):      25% — recent, warm, easiest to recover
//   2–3 years lapsed (SYBUNT):    12% — needs deliberate outreach
//   4–5 years lapsed (SYBUNT):     6% — half-lives have compounded
//   5+ years lapsed (SYBUNT):      2% — effectively a cold prospect
// -----------------------------------------------------------------------------
const RECAPTURE_PROBABILITY = {
  lybunt: 0.25,
  sybunt_2_3: 0.12,
  sybunt_4_5: 0.06,
  sybunt_6_plus: 0.02,
};

// SQL snippet that classifies recapture probability based on last_active_fy
function recaptureProbSql(priorFyParam, currentFyParam) {
  return `CASE
    WHEN last_active_fy = ${priorFyParam} THEN ${RECAPTURE_PROBABILITY.lybunt}
    WHEN last_active_fy >= ${currentFyParam} - 3 THEN ${RECAPTURE_PROBABILITY.sybunt_2_3}
    WHEN last_active_fy >= ${currentFyParam} - 5 THEN ${RECAPTURE_PROBABILITY.sybunt_4_5}
    ELSE ${RECAPTURE_PROBABILITY.sybunt_6_plus}
  END`;
}

// -----------------------------------------------------------------------------
// Core CTE: per-lapsed-donor derived facts
// -----------------------------------------------------------------------------
// Produces one row per constituent who has NOT given in the current FY, with:
//   - last_active_fy              — most recent FY they gave in
//   - last_active_fy_giving       — SUM of gifts in that last active FY
//                                    (this is the "Foregone Revenue" basis)
//   - lifetime_giving             — SUM of all gifts ever (for capacity bands)
//   - total_gifts                 — count of gifts ever
//   - distinct_fy_count           — number of distinct FYs they ever gave in
//   - max_consecutive_fys         — longest consecutive-FY giving streak
//   - first_gift_date / last_gift_date
//   - years_lapsed                — currentFY - last_active_fy
//   - category                    — 'LYBUNT' (lapsed 1 yr) or 'SYBUNT' (lapsed 2+)
//   - recapture_prob              — benchmark probability by recency bucket
//   - realistic_recovery          — last_active_fy_giving × recapture_prob
//   - suggested_ask               — last_active_fy_giving × 1.15 rounded
//   - priority_score_raw          — weighted score, normalized 0..100 in app layer
//   - constituent_name / contact fields for display & export
//
// All metrics are derived from the SAME cohort definition so KPI cards, bands,
// and paginated donor table reconcile exactly when filters are applied.
// -----------------------------------------------------------------------------
function buildLapsedCte({ fyMonth, currentFY }) {
  const fyExpr = fyCaseSql(fyMonth, 'g.gift_date');
  const priorFY = currentFY - 1;

  return `
    current_fy AS (
      SELECT DISTINCT constituent_id
      FROM crm_gifts
      WHERE tenant_id = :tenantId
        AND gift_date >= :curStart AND gift_date < :curEnd
        AND constituent_id IS NOT NULL
        ${EXCL}
    ),
    -- Per-donor-per-FY totals, limited to donors not active in current FY
    donor_fy_totals AS (
      SELECT g.constituent_id,
             (${fyExpr})::int AS fy,
             SUM(g.gift_amount) AS fy_total,
             COUNT(*) AS fy_gifts,
             MIN(g.gift_date) AS fy_first_gift,
             MAX(g.gift_date) AS fy_last_gift
      FROM crm_gifts g
      LEFT JOIN current_fy cf ON g.constituent_id = cf.constituent_id
      WHERE g.tenant_id = :tenantId
        AND g.constituent_id IS NOT NULL
        AND cf.constituent_id IS NULL
        AND g.gift_date IS NOT NULL
        ${EXCL_G}
      GROUP BY g.constituent_id, (${fyExpr})
    ),
    -- Most recent active FY and $ given in it — the basis for "revenue at risk"
    most_recent_fy AS (
      SELECT DISTINCT ON (constituent_id)
             constituent_id,
             fy AS last_active_fy,
             fy_total AS last_active_fy_giving
      FROM donor_fy_totals
      ORDER BY constituent_id, fy DESC
    ),
    -- Longest streak of consecutive FY giving per donor
    fy_streaks AS (
      SELECT constituent_id, COUNT(*) AS streak_len
      FROM (
        SELECT constituent_id, fy,
               fy - ROW_NUMBER() OVER (PARTITION BY constituent_id ORDER BY fy) AS grp
        FROM donor_fy_totals
      ) s
      GROUP BY constituent_id, grp
    ),
    max_streaks AS (
      SELECT constituent_id, MAX(streak_len) AS max_consecutive_fys
      FROM fy_streaks GROUP BY constituent_id
    ),
    -- Lifetime / contact aggregates — one pass over crm_gifts
    donor_agg AS (
      SELECT g.constituent_id,
             COALESCE(
               NULLIF(TRIM(MAX(CONCAT(COALESCE(g.first_name,''), ' ', COALESCE(g.last_name,'')))), ''),
               'Constituent #' || g.constituent_id::text
             ) AS donor_name,
             MAX(g.first_name) AS first_name,
             MAX(g.last_name) AS last_name,
             MAX(g.constituent_email) AS constituent_email,
             MAX(g.constituent_phone) AS constituent_phone,
             MAX(g.constituent_address) AS constituent_address,
             MAX(g.constituent_city) AS constituent_city,
             MAX(g.constituent_state) AS constituent_state,
             MAX(g.constituent_zip) AS constituent_zip,
             MAX(g.constituent_country) AS constituent_country,
             MAX(g.constituent_type) AS constituent_type,
             BOOL_OR(COALESCE(g.address_do_not_mail, FALSE)) AS do_not_mail,
             BOOL_OR(COALESCE(g.phone_do_not_call, FALSE)) AS do_not_call,
             BOOL_OR(COALESCE(g.email_do_not_email, FALSE)) AS do_not_email,
             SUM(g.gift_amount) AS lifetime_giving,
             COUNT(*) AS total_gifts,
             MIN(g.gift_date) AS first_gift_date,
             MAX(g.gift_date) AS last_gift_date
      FROM crm_gifts g
      LEFT JOIN current_fy cf ON g.constituent_id = cf.constituent_id
      WHERE g.tenant_id = :tenantId
        AND g.constituent_id IS NOT NULL
        AND cf.constituent_id IS NULL
        ${EXCL_G}
      GROUP BY g.constituent_id
    ),
    -- Count of distinct FYs a donor has ever given in
    fy_count AS (
      SELECT constituent_id, COUNT(*) AS distinct_fy_count
      FROM donor_fy_totals GROUP BY constituent_id
    ),
    -- Final lapsed cohort with all derived metrics
    lapsed AS (
      SELECT da.constituent_id,
             da.donor_name, da.first_name, da.last_name,
             da.constituent_email, da.constituent_phone, da.constituent_address,
             da.constituent_city, da.constituent_state, da.constituent_zip,
             da.constituent_country, da.constituent_type,
             da.do_not_mail, da.do_not_call, da.do_not_email,
             (da.do_not_mail OR da.do_not_call OR da.do_not_email) AS is_suppressed,
             da.lifetime_giving, da.total_gifts,
             da.first_gift_date, da.last_gift_date,
             COALESCE(fc.distinct_fy_count, 1) AS distinct_fy_count,
             COALESCE(ms.max_consecutive_fys, 1) AS max_consecutive_fys,
             mr.last_active_fy,
             mr.last_active_fy_giving,
             (:currentFY - mr.last_active_fy) AS years_lapsed,
             CASE
               WHEN mr.last_active_fy = :priorFY THEN 'LYBUNT'
               ELSE 'SYBUNT'
             END AS category,
             ${recaptureProbSql(':priorFY', ':currentFY')} AS recapture_prob,
             (mr.last_active_fy_giving * ${recaptureProbSql(':priorFY', ':currentFY')})
               AS realistic_recovery,
             -- Suggested ask: 15% uplift on last active FY giving, rounded by tier
             CASE
               WHEN mr.last_active_fy_giving * 1.15 <= 100
                 THEN ROUND((mr.last_active_fy_giving * 1.15) / 5) * 5
               WHEN mr.last_active_fy_giving * 1.15 <= 1000
                 THEN ROUND((mr.last_active_fy_giving * 1.15) / 25) * 25
               WHEN mr.last_active_fy_giving * 1.15 <= 10000
                 THEN ROUND((mr.last_active_fy_giving * 1.15) / 100) * 100
               ELSE ROUND((mr.last_active_fy_giving * 1.15) / 500) * 500
             END AS suggested_ask,
             -- Raw priority score (normalized to 0..100 in app layer):
             --   realistic_recovery
             --     × capacity_multiplier (log10 of lifetime giving)
             --     × frequency_multiplier (more distinct FYs = more loyal)
             (mr.last_active_fy_giving * ${recaptureProbSql(':priorFY', ':currentFY')})
               * (1 + LEAST(GREATEST(LOG(GREATEST(da.lifetime_giving, 1) / 1000.0), 0), 1))
               * (1 + LEAST(GREATEST((COALESCE(fc.distinct_fy_count, 1) - 1) * 0.1, 0), 0.5))
               AS priority_score_raw
      FROM donor_agg da
      JOIN most_recent_fy mr USING (constituent_id)
      LEFT JOIN fy_count fc USING (constituent_id)
      LEFT JOIN max_streaks ms USING (constituent_id)
    )
  `;
}

// -----------------------------------------------------------------------------
// Filter builder — resolves the shared WHERE clause applied over the `lapsed`
// CTE. The same clause is used by every downstream query (KPIs, bands, count,
// table) so filters apply globally across the page.
// -----------------------------------------------------------------------------
function buildFilterClause({
  category, yearsSince, segment,
  gaveInFyStart, gaveInFyEnd, notInFyStart, notInFyEnd,
  minGift, maxGift,
  fundId, campaignId, appealId,
  constituentType,
  includeSuppressed = false,
  currentFY, fyMonth,
}) {
  const clauses = [];
  const repl = {};

  if (category === 'LYBUNT' || category === 'SYBUNT') {
    clauses.push('category = :f_category');
    repl.f_category = category;
  }

  // Years-since-last-gift buckets — operate on last_active_fy for consistency
  if (yearsSince === '1') {
    clauses.push('years_lapsed = 1');
  } else if (yearsSince === '2-3') {
    clauses.push('years_lapsed BETWEEN 2 AND 3');
  } else if (yearsSince === '4-5') {
    clauses.push('years_lapsed BETWEEN 4 AND 5');
  } else if (yearsSince === '5+' || yearsSince === '6+') {
    clauses.push('years_lapsed >= 5');
  }

  // Custom FY range: the donor must have given at least once inside this range
  if (gaveInFyStart && gaveInFyEnd) {
    clauses.push(`constituent_id IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :f_gaveStart AND gift_date < :f_gaveEnd
        AND constituent_id IS NOT NULL ${EXCL}
    )`);
    repl.f_gaveStart = fyStart(Number(gaveInFyStart), fyMonth);
    repl.f_gaveEnd = fyEnd(Number(gaveInFyEnd), fyMonth);
  }

  if (notInFyStart && notInFyEnd) {
    clauses.push(`constituent_id NOT IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND gift_date >= :f_notInStart AND gift_date < :f_notInEnd
        AND constituent_id IS NOT NULL ${EXCL}
    )`);
    repl.f_notInStart = fyStart(Number(notInFyStart), fyMonth);
    repl.f_notInEnd = fyEnd(Number(notInFyEnd), fyMonth);
  }

  // Giving-amount range on last-active-FY giving (their "annual value")
  if (minGift != null && !isNaN(Number(minGift))) {
    clauses.push('last_active_fy_giving >= :f_minGift');
    repl.f_minGift = Number(minGift);
  }
  if (maxGift != null && !isNaN(Number(maxGift))) {
    clauses.push('last_active_fy_giving <= :f_maxGift');
    repl.f_maxGift = Number(maxGift);
  }

  // Fund / Campaign / Appeal filter — donor must have a gift tagged with it
  // (any time in their history)
  if (fundId) {
    clauses.push(`constituent_id IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND fund_id = :f_fundId
        AND constituent_id IS NOT NULL ${EXCL}
    )`);
    repl.f_fundId = String(fundId);
  }
  if (campaignId) {
    clauses.push(`constituent_id IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND campaign_id = :f_campaignId
        AND constituent_id IS NOT NULL ${EXCL}
    )`);
    repl.f_campaignId = String(campaignId);
  }
  if (appealId) {
    clauses.push(`constituent_id IN (
      SELECT DISTINCT constituent_id FROM crm_gifts
      WHERE tenant_id = :tenantId AND appeal_id = :f_appealId
        AND constituent_id IS NOT NULL ${EXCL}
    )`);
    repl.f_appealId = String(appealId);
  }

  if (constituentType) {
    clauses.push('LOWER(COALESCE(constituent_type, \'\')) = LOWER(:f_constType)');
    repl.f_constType = String(constituentType);
  }

  // Suppression: by default hide do-not-mail / do-not-call / do-not-email
  if (!includeSuppressed) {
    clauses.push('is_suppressed = FALSE');
  }

  // Segment presets — translate into filter clauses
  switch (segment) {
    case 'recently-lapsed':
      clauses.push('category = \'LYBUNT\'');
      break;
    case 'long-lapsed':
      clauses.push('years_lapsed >= 5');
      break;
    case 'high-value-lapsed':
      clauses.push('lifetime_giving >= 1000');
      break;
    case 'frequent-gone-quiet':
      clauses.push('total_gifts >= 3 AND years_lapsed >= 2');
      break;
    case 'one-and-done':
      clauses.push('total_gifts = 1');
      break;
    case 'top-priority':
      // Handled post-hoc by sort order; no extra WHERE
      break;
    default:
      break;
  }

  return {
    where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '',
    repl,
  };
}

// -----------------------------------------------------------------------------
// Giving-band definition — expressed as a SQL CASE over last_active_fy_giving
// so the chart totals reconcile with the KPI cards exactly.
// -----------------------------------------------------------------------------
const BAND_CASE_SQL = `
  CASE
    WHEN last_active_fy_giving < 100 THEN '$1–$99'
    WHEN last_active_fy_giving < 500 THEN '$100–$499'
    WHEN last_active_fy_giving < 1000 THEN '$500–$999'
    WHEN last_active_fy_giving < 5000 THEN '$1K–$4,999'
    WHEN last_active_fy_giving < 10000 THEN '$5K–$9,999'
    ELSE '$10,000+'
  END
`;

const BAND_ORDER_SQL = `
  CASE
    WHEN last_active_fy_giving < 100 THEN 1
    WHEN last_active_fy_giving < 500 THEN 2
    WHEN last_active_fy_giving < 1000 THEN 3
    WHEN last_active_fy_giving < 5000 THEN 4
    WHEN last_active_fy_giving < 10000 THEN 5
    ELSE 6
  END
`;

// -----------------------------------------------------------------------------
// Sort-by clause resolver
// -----------------------------------------------------------------------------
function orderBySql(sortBy) {
  switch (sortBy) {
    case 'revenue':
      return 'last_active_fy_giving DESC NULLS LAST, lifetime_giving DESC';
    case 'recovery':
      return 'realistic_recovery DESC NULLS LAST, last_active_fy_giving DESC';
    case 'recency':
      return 'last_gift_date DESC NULLS LAST, last_active_fy_giving DESC';
    case 'lifetime':
      return 'lifetime_giving DESC NULLS LAST, last_active_fy_giving DESC';
    case 'years_lapsed':
      return 'years_lapsed DESC, last_active_fy_giving DESC';
    case 'priority':
    default:
      return 'priority_score_raw DESC NULLS LAST, last_active_fy_giving DESC';
  }
}

// -----------------------------------------------------------------------------
// Main entrypoint — getLybuntSybuntV2
// -----------------------------------------------------------------------------
// Returns the full dashboard payload. All KPIs, bands, and the paginated donor
// table are derived from the same filtered cohort so numbers reconcile.
// -----------------------------------------------------------------------------
async function getLybuntSybuntV2(tenantId, currentFY, opts = {}) {
  if (!currentFY) return null;

  const {
    page = 1,
    limit = 50,
    sortBy = 'priority',
  } = opts;

  const fyMonth = await getTenantFyMonth(tenantId);
  const curStart = fyStart(currentFY, fyMonth);
  const curEnd = fyEnd(currentFY, fyMonth);
  const priorFY = currentFY - 1;
  const offset = (Math.max(1, page) - 1) * Math.max(1, limit);

  const lapsedCte = buildLapsedCte({ fyMonth, currentFY });
  const { where: filterWhere, repl: filterRepl } = buildFilterClause({
    ...opts,
    currentFY,
    fyMonth,
  });

  const baseRepl = {
    tenantId,
    curStart, curEnd,
    currentFY,
    priorFY,
    ...filterRepl,
  };

  // --- KPI summary ---------------------------------------------------------
  const [summary] = await sequelize.query(`
    WITH ${lapsedCte}
    SELECT
      COUNT(*)::int AS total_donors,
      COALESCE(SUM(last_active_fy_giving), 0) AS foregone_revenue,
      COALESCE(SUM(realistic_recovery), 0) AS realistic_recovery,
      COALESCE(AVG(last_active_fy_giving), 0) AS avg_annual_gift,
      SUM(CASE WHEN category = 'LYBUNT' THEN 1 ELSE 0 END)::int AS lybunt_donors,
      COALESCE(SUM(CASE WHEN category = 'LYBUNT' THEN last_active_fy_giving END), 0) AS lybunt_foregone,
      COALESCE(SUM(CASE WHEN category = 'LYBUNT' THEN realistic_recovery END), 0) AS lybunt_recovery,
      SUM(CASE WHEN category = 'SYBUNT' THEN 1 ELSE 0 END)::int AS sybunt_donors,
      COALESCE(SUM(CASE WHEN category = 'SYBUNT' THEN last_active_fy_giving END), 0) AS sybunt_foregone,
      COALESCE(SUM(CASE WHEN category = 'SYBUNT' THEN realistic_recovery END), 0) AS sybunt_recovery,
      SUM(CASE WHEN is_suppressed THEN 1 ELSE 0 END)::int AS suppressed_donors,
      MAX(priority_score_raw) AS max_priority
    FROM lapsed ${filterWhere}
  `, { replacements: baseRepl, ...QUERY_OPTS });

  const totalDonors = Number(summary?.total_donors || 0);
  const maxPriority = Number(summary?.max_priority || 0) || 1;

  // --- Giving-band distribution -------------------------------------------
  const bands = await sequelize.query(`
    WITH ${lapsedCte}
    SELECT category,
           ${BAND_CASE_SQL} AS band,
           ${BAND_ORDER_SQL} AS band_order,
           COUNT(*)::int AS donor_count,
           COALESCE(SUM(last_active_fy_giving), 0) AS band_total,
           COALESCE(SUM(realistic_recovery), 0) AS band_recovery
    FROM lapsed ${filterWhere}
    GROUP BY category, band, band_order
    ORDER BY category, band_order
  `, { replacements: baseRepl, ...QUERY_OPTS });

  // --- Paginated donor table ----------------------------------------------
  const topDonors = await sequelize.query(`
    WITH ${lapsedCte}
    SELECT
      constituent_id, donor_name, first_name, last_name,
      constituent_email, constituent_phone, constituent_address,
      constituent_city, constituent_state, constituent_zip,
      constituent_country, constituent_type,
      do_not_mail, do_not_call, do_not_email, is_suppressed,
      category, last_active_fy, last_active_fy_giving,
      lifetime_giving, total_gifts, distinct_fy_count, max_consecutive_fys,
      first_gift_date, last_gift_date, years_lapsed,
      recapture_prob, realistic_recovery, suggested_ask,
      priority_score_raw,
      CASE WHEN :maxPriority > 0
           THEN ROUND((priority_score_raw / :maxPriority * 100)::numeric, 0)
           ELSE 0
      END AS priority_score
    FROM lapsed
    ${filterWhere}
    ORDER BY ${orderBySql(sortBy)}
    LIMIT :limit OFFSET :offset
  `, {
    replacements: { ...baseRepl, maxPriority, limit, offset },
    ...QUERY_OPTS,
  });

  return {
    currentFY,
    priorFY,
    fyMonth,
    curStart, curEnd,
    recaptureBenchmarks: RECAPTURE_PROBABILITY,
    summary: {
      totalDonors,
      foregoneRevenue: Number(summary?.foregone_revenue || 0),
      realisticRecovery: Number(summary?.realistic_recovery || 0),
      avgAnnualGift: Number(summary?.avg_annual_gift || 0),
      suppressedDonors: Number(summary?.suppressed_donors || 0),
      lybunt: {
        donors: Number(summary?.lybunt_donors || 0),
        foregone: Number(summary?.lybunt_foregone || 0),
        recovery: Number(summary?.lybunt_recovery || 0),
      },
      sybunt: {
        donors: Number(summary?.sybunt_donors || 0),
        foregone: Number(summary?.sybunt_foregone || 0),
        recovery: Number(summary?.sybunt_recovery || 0),
      },
    },
    bands: bands.map(b => ({
      category: b.category,
      band: b.band,
      band_order: Number(b.band_order),
      donor_count: Number(b.donor_count),
      band_total: Number(b.band_total),
      band_recovery: Number(b.band_recovery),
    })),
    topDonors: topDonors.map(d => ({
      ...d,
      last_active_fy: d.last_active_fy != null ? Number(d.last_active_fy) : null,
      last_active_fy_giving: Number(d.last_active_fy_giving || 0),
      lifetime_giving: Number(d.lifetime_giving || 0),
      total_gifts: Number(d.total_gifts || 0),
      distinct_fy_count: Number(d.distinct_fy_count || 1),
      max_consecutive_fys: Number(d.max_consecutive_fys || 1),
      years_lapsed: Number(d.years_lapsed || 0),
      recapture_prob: Number(d.recapture_prob || 0),
      realistic_recovery: Number(d.realistic_recovery || 0),
      suggested_ask: Number(d.suggested_ask || 0),
      priority_score: Number(d.priority_score || 0),
    })),
    topDonorsPage: Math.max(1, Number(page) || 1),
    topDonorsLimit: Math.max(1, Number(limit) || 50),
    topDonorsTotal: totalDonors,
    topDonorsTotalPages: Math.max(1, Math.ceil(totalDonors / Math.max(1, limit))),
  };
}

module.exports = {
  getTenantFyMonth,
  fyStart,
  fyEnd,
  RECAPTURE_PROBABILITY,
  recaptureProbSql,
  buildLapsedCte,
  buildFilterClause,
  BAND_CASE_SQL,
  BAND_ORDER_SQL,
  orderBySql,
  getLybuntSybuntV2,
  EXCL,
  EXCL_G,
  QUERY_OPTS,
};
