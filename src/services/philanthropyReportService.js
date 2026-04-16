'use strict';

/**
 * Philanthropy Program Report — PDF renderer.
 *
 * Renders a 6-page landscape-letter PDF matching the reference PowerPoint
 * (PHIL_REPORT_FY_25-26.pptx):
 *   Page 1: Program Overview
 *   Page 2: Legacy Giving
 *   Page 3: Major Gifts
 *   Page 4: Events
 *   Page 5: Annual Giving
 *   Page 6: Direct Response
 *
 * Each department page follows the PowerPoint's 3-card layout
 * (KPIs | Stats + chart | Narrative) with department-specific content.
 *
 * Data loading (fetchReportData) is kept separate from rendering
 * (renderReport) so the route handler can call them independently and
 * wrap each with its own timeout / error handling.
 */

const { sequelize, PhilanthropyNarrative } = require('../models');
const { QueryTypes } = require('sequelize');
const charts = require('./pdfChartHelpers');

// ── Canonical department list.  `key` matches values stored in
// crm_gifts.department (spaced labels — see crmDepartmentClassifier.js).
// `label` is what renders in the PDF (Direct Mail displays as Direct Response).
const DEPARTMENTS = [
  { key: 'Legacy Giving', label: 'Legacy Giving', renderer: 'renderLegacyGiving' },
  { key: 'Major Gifts', label: 'Major Gifts', renderer: 'renderMajorGifts' },
  { key: 'Events', label: 'Events', renderer: 'renderEvents' },
  { key: 'Annual Giving', label: 'Annual Giving', renderer: 'renderAnnualGiving' },
  { key: 'Direct Mail', label: 'Direct Response', renderer: 'renderDirectResponse' },
];

// ── Brand colors ──
const C = {
  navy: '#003B5C',
  navyDark: '#1e3a8a',
  blue: '#0072BB',
  blueBorder: '#1e40af',
  blueLabel: '#3b82f6',
  gold: '#D4A843',
  gray: '#6b7280',
  grayLight: '#9ca3af',
  lightGray: '#f3f4f6',
  zebra: '#f9fafb',
  green: '#16a34a',
  red: '#dc2626',
  amber: '#f59e0b',
  white: '#FFFFFF',
};

// ── Formatting helpers ──
const fmtN = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtD = n => '$' + fmtN(n);
const fmtCompact = n => {
  const v = Number(n || 0);
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(v >= 10000000 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
  if (v >= 1000) return '$' + Math.round(v / 1000) + 'K';
  return '$' + fmtN(v);
};
const fmtPct = n => (n == null ? '—' : Math.round(Number(n)) + '%');
const today = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const fyLabel = fy => fy ? 'FY' + fy + ' (Apr ' + (fy - 1) + ' \u2013 Mar ' + fy + ')' : 'All Time';

// ── Page geometry (landscape letter) ──
const PW = 792, PH = 612, M = 28, CW = PW - M * 2;

module.exports = {
  DEPARTMENTS,
  C,
  fmtN, fmtD, fmtCompact, fmtPct, fyLabel,
  PW, PH, M, CW,
  fetchReportData,
  fetchDepartmentExtras,
  renderReport,
};

// ────────────────────────────────────────────────────────────────────────────
// DATA LOADING
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pull per-department "extras" not in getDepartmentDetail — channel splits
 * (online / mailed / cash / recurring), constituent-type source breakdown,
 * pledge-vs-received counts, Giving Tuesday totals, and lifetime avg gift.
 *
 * One trip to Postgres per tenant+department+FY. Returns consistent empty
 * structures when nothing matches so the renderer never has to null-check.
 */
async function fetchDepartmentExtras(tenantId, department, dateRange) {
  const dw = dateRange
    ? 'AND gift_date >= :startDate AND gift_date < :endDate'
    : '';
  const repl = { tenantId, department, ...(dateRange || {}) };

  // Channel breakdown (online / mailed / in-person / other)
  // Maps common gift_payment_type strings to a channel bucket.
  const channelRows = await sequelize.query(`
    SELECT
      CASE
        WHEN LOWER(COALESCE(gift_payment_type, '')) SIMILAR TO '%(online|web|credit|paypal|stripe)%' THEN 'Online'
        WHEN LOWER(COALESCE(gift_payment_type, '')) SIMILAR TO '%(mail|cheque|check|post)%' THEN 'Mailed in'
        WHEN LOWER(COALESCE(gift_payment_type, '')) SIMILAR TO '%(recur|monthly|eft|pre.?auth)%' THEN 'Recurring'
        WHEN LOWER(COALESCE(gift_payment_type, '')) SIMILAR TO '%(cash|cash.gift)%' THEN 'Cash'
        ELSE 'Other'
      END as channel,
      COUNT(*) as gift_count,
      COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department = :department ${dw}
    GROUP BY 1
    ORDER BY total DESC
  `, { replacements: repl, type: QueryTypes.SELECT });

  // Constituent type breakdown (Individual / Foundation / Corporation / etc.)
  const sourceRows = await sequelize.query(`
    SELECT
      COALESCE(NULLIF(TRIM(constituent_type), ''), 'Individual') as source,
      COUNT(*) as gift_count,
      COALESCE(SUM(gift_amount), 0) as total,
      COUNT(DISTINCT constituent_id) as donor_count
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department = :department ${dw}
    GROUP BY 1
    ORDER BY total DESC
  `, { replacements: repl, type: QueryTypes.SELECT });

  // Pledged vs received — uses gift_code and gift_payment_type heuristics
  // to distinguish a pledge commitment from a pledge payment from cash.
  const pledgeRows = await sequelize.query(`
    SELECT
      CASE
        WHEN LOWER(COALESCE(gift_code, '')) ~ 'pledge' AND LOWER(COALESCE(gift_code, '')) !~ 'payment'
          THEN 'pledged'
        WHEN LOWER(COALESCE(gift_code, '')) ~ 'payment'
          OR LOWER(COALESCE(gift_payment_type, '')) ~ 'pledge.?payment'
          THEN 'received_payment'
        ELSE 'received_cash'
      END as kind,
      COUNT(*) as gift_count,
      COALESCE(SUM(gift_amount), 0) as total
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department = :department ${dw}
    GROUP BY 1
  `, { replacements: repl, type: QueryTypes.SELECT });

  // Giving Tuesday callout — any appeal/campaign name containing "Giving Tuesday"
  const [givingTuesday] = await sequelize.query(`
    SELECT COALESCE(SUM(gift_amount), 0) as total, COUNT(*) as gift_count
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department = :department ${dw}
      AND (
        LOWER(COALESCE(appeal_description, '')) LIKE '%giving tuesday%'
        OR LOWER(COALESCE(campaign_description, '')) LIKE '%giving tuesday%'
      )
  `, { replacements: repl, type: QueryTypes.SELECT });

  // Lifetime avg gift (all-time, ignores dateRange — used on Legacy page)
  const [lifetime] = await sequelize.query(`
    SELECT COALESCE(AVG(gift_amount), 0) as avg_gift, COUNT(*) as gift_count
    FROM crm_gifts
    WHERE tenant_id = :tenantId AND department = :department
  `, { replacements: { tenantId, department }, type: QueryTypes.SELECT });

  // Events: Signature vs Community split based on campaign name pattern.
  // Signature events are typically larger branded campaigns; Community is
  // everything else classified as Events.
  let signatureEvents = null, communityEvents = null, eventBreakdown = [];
  if (department === 'Events') {
    const sigWords = '(gala|dinner|golf|classic|masquerade|ball|tournament|mrfd|sss|lightsout|lights.?out|ctc)';
    const [sig] = await sequelize.query(`
      SELECT COALESCE(SUM(gift_amount), 0) as total, COUNT(*) as gift_count,
             COUNT(DISTINCT COALESCE(campaign_description, appeal_description)) as event_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND department = :department ${dw}
        AND (
          LOWER(COALESCE(campaign_description, '')) ~ '${sigWords}'
          OR LOWER(COALESCE(appeal_description, '')) ~ '${sigWords}'
        )
    `, { replacements: repl, type: QueryTypes.SELECT });
    const [com] = await sequelize.query(`
      SELECT COALESCE(SUM(gift_amount), 0) as total, COUNT(*) as gift_count,
             COUNT(DISTINCT COALESCE(campaign_description, appeal_description)) as event_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND department = :department ${dw}
        AND NOT (
          LOWER(COALESCE(campaign_description, '')) ~ '${sigWords}'
          OR LOWER(COALESCE(appeal_description, '')) ~ '${sigWords}'
        )
    `, { replacements: repl, type: QueryTypes.SELECT });
    signatureEvents = sig;
    communityEvents = com;
    eventBreakdown = await sequelize.query(`
      SELECT COALESCE(NULLIF(campaign_description, ''), appeal_description, 'Unknown') as event_name,
             COUNT(*) as gift_count, COALESCE(SUM(gift_amount), 0) as revenue,
             COUNT(DISTINCT constituent_id) as donor_count
      FROM crm_gifts
      WHERE tenant_id = :tenantId AND department = :department ${dw}
        AND COALESCE(campaign_description, appeal_description) IS NOT NULL
      GROUP BY 1
      ORDER BY revenue DESC
      LIMIT 8
    `, { replacements: repl, type: QueryTypes.SELECT });
  }

  return {
    channels: channelRows,
    sources: sourceRows,
    pledges: pledgeRows,
    givingTuesday: givingTuesday || { total: 0, gift_count: 0 },
    lifetimeAvgGift: lifetime ? Number(lifetime.avg_gift) : 0,
    signatureEvents,
    communityEvents,
    eventBreakdown,
  };
}

/**
 * Load the full dataset the report needs.
 * Callers: the /crm/philanthropy-report/pdf route.
 *
 * crmSvc is passed in (not required at top-level) to avoid a circular
 * dependency between this module and crmDashboardService.
 */
/**
 * Query overview totals directly from crm_gifts — bypasses the materialized
 * view that getCrmOverview normally reads.
 *
 * Why the report needs this: every other number on the report
 * (department details, actuals, YoY, top donors) queries crm_gifts
 * directly and is always live. If the page-1 overview came from a stale
 * MV, the department totals on pages 2-6 would sum to a different number
 * than the "Total Gifts Raised" KPI on page 1 — the report wouldn't
 * reconcile with itself.
 *
 * Mirrors the fallback query in getCrmOverview (crmDashboardService.js)
 * so the shape of the returned object is identical.
 */
async function fetchOverviewLive(tenantId, dateRange) {
  const empty = {
    total_gifts: 0, total_raised: 0, avg_gift: 0, largest_gift: 0,
    earliest_date: null, latest_date: null,
    unique_donors: 0, unique_funds: 0, unique_campaigns: 0, unique_appeals: 0,
  };
  const cols = `COUNT(*) as total_gifts, COALESCE(SUM(gift_amount),0) as total_raised,
    COALESCE(AVG(gift_amount),0) as avg_gift, COALESCE(MAX(gift_amount),0) as largest_gift,
    MIN(gift_date) as earliest_date, MAX(gift_date) as latest_date,
    COUNT(DISTINCT constituent_id) as unique_donors, COUNT(DISTINCT fund_id) as unique_funds,
    COUNT(DISTINCT campaign_id) as unique_campaigns, COUNT(DISTINCT appeal_id) as unique_appeals`;
  // Pledge-exclusion SQL — identical to EXCLUDE_PLEDGE_SQL in
  // crmMaterializedViews.js so the filter matches everywhere else.
  const pledgeFilter = ` AND NOT (
     (gift_code IS NOT NULL AND (LOWER(gift_code) LIKE '%pledge%' OR LOWER(gift_code) LIKE '%planned%gift%')
       AND LOWER(gift_code) NOT LIKE 'pay-%' AND LOWER(gift_code) NOT LIKE '%pledge payment%')
  OR (gift_type IS NOT NULL AND (LOWER(gift_type) IN
       ('pledge', 'planned gift', 'mg pledge', 'recurring gift pledge', 'stock pledge', 'matching gift pledge')))
  )`;
  const dateWhere = dateRange
    ? 'AND gift_date >= :startDate AND gift_date < :endDate'
    : '';
  const repl = { tenantId };
  if (dateRange) { repl.startDate = dateRange.startDate; repl.endDate = dateRange.endDate; }
  const rows = await sequelize.query(
    `SELECT ${cols} FROM crm_gifts WHERE tenant_id = :tenantId ${dateWhere} ${pledgeFilter}`,
    { replacements: repl, type: QueryTypes.SELECT }
  );
  return rows[0] || empty;
}

async function fetchReportData(crmSvc, { tenantId, fy, fyMonth }) {
  const { fyToDateRange } = _fyHelpers(fyMonth);
  const dateRange = fy ? fyToDateRange(fy) : null;
  const priorDateRange = fy ? fyToDateRange(fy - 1) : null;

  const [tenant, yoy, deptGoals, deptActuals, overview, priorOverview, retention] = await Promise.all([
    crmSvc.Tenant.findByPk(tenantId),
    crmSvc.getYearOverYearComparison(tenantId),
    crmSvc.getDepartmentGoals(tenantId, fy),
    crmSvc.getDepartmentActuals(tenantId, dateRange),
    // Use the live path — NOT crmSvc.getCrmOverview — so the page-1
    // totals always reconcile with the department-level numbers on
    // pages 2-6 (which are always live).
    fetchOverviewLive(tenantId, dateRange),
    priorDateRange ? fetchOverviewLive(tenantId, priorDateRange) : Promise.resolve(null),
    fy ? crmSvc.getDonorRetention(tenantId, fy) : Promise.resolve(null),
  ]);

  const deptDetails = await Promise.all(
    DEPARTMENTS.map(d => crmSvc.getDepartmentDetail(tenantId, d.key, dateRange))
  );
  const deptExtras = await Promise.all(
    DEPARTMENTS.map(d => fetchDepartmentExtras(tenantId, d.key, dateRange))
  );

  const narrativeRows = fy ? await PhilanthropyNarrative.findAll({
    where: { tenantId, fiscalYear: fy },
  }) : [];
  const narrativeByDept = {};
  narrativeRows.forEach(n => {
    const plain = n.toJSON();
    narrativeByDept[plain.department] = plain;
  });

  return {
    tenant, fy, dateRange, priorDateRange,
    overview, priorOverview, retention,
    yoy, deptGoals, deptActuals,
    deptDetails, deptExtras,
    narrativeByDept,
  };
}

function _fyHelpers(fyStartMonth) {
  const m = String(fyStartMonth || 4).padStart(2, '0');
  const offset = fyStartMonth === 1 ? 0 : 1;
  return {
    fyToDateRange(fy) {
      return {
        startDate: `${fy - offset}-${m}-01`,
        endDate: `${fy - offset + 1}-${m}-01`,
        fy,
        fyMonth: fyStartMonth,
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// RENDERING — placeholder entry point.  Page implementations in follow-up edits.
// ────────────────────────────────────────────────────────────────────────────

function renderReport(doc, data, opts = {}) {
  const ctx = _buildCtx(doc, data, opts);

  // Page 1 — Program Overview
  renderProgramOverview(ctx);

  // Pages 2-6 — Department pages
  DEPARTMENTS.forEach((dept, idx) => {
    doc.addPage({ size: 'letter', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    const detail = data.deptDetails[idx] || {};
    const extras = data.deptExtras[idx] || {};
    const narrative = data.narrativeByDept[dept.key] || {};
    const goalByDept = {};
    (data.deptGoals || []).forEach(g => { goalByDept[g.department] = Number(g.goalAmount || g.goal_amount || 0); });

    const pageCtx = {
      ...ctx,
      dept, detail, extras, narrative,
      goal: Number(goalByDept[dept.key] || 0),
      pageNum: idx + 2,
    };
    const fn = module.exports[dept.renderer];
    if (typeof fn === 'function') {
      fn(pageCtx);
    } else {
      renderDepartmentPageStub(pageCtx);
    }
    drawFooter(ctx, idx + 2);
  });

  doc.end();
}

function _buildCtx(doc, data, opts) {
  const tenantName = (data.tenant && data.tenant.name) ? data.tenant.name : 'Fund-Raise';
  const preparedBy = opts.preparedBy || 'Philanthropy Team';
  return {
    doc, data, opts,
    tenantName, preparedBy,
    fy: data.fy,
    today: today(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// SHARED PAGE FURNITURE
// ────────────────────────────────────────────────────────────────────────────

function drawHeader(ctx, subtitle) {
  const { doc, tenantName, fy } = ctx;
  doc.rect(0, 0, PW, 44).fill(C.navy);
  doc.fontSize(16).fillColor(C.white).font('Helvetica-Bold')
    .text(tenantName, M + 4, 11, { width: 320 });
  doc.fontSize(9).fillColor(C.gold).font('Helvetica')
    .text(subtitle || 'Philanthropy Program Report', M + 4, 30, { width: 320 });
  doc.fontSize(9).fillColor(C.white)
    .text(fyLabel(fy), PW / 2 - 100, 16, { width: 200, align: 'center' });
  doc.fontSize(7).fillColor('#94a3b8')
    .text('Date Pulled: ' + ctx.today, PW - M - 160, 18, { width: 156, align: 'right' });
}

function drawFooter(ctx, pageNum) {
  const { doc } = ctx;
  const footY = PH - 18;
  doc.moveTo(M, footY - 3).lineTo(M + CW, footY - 3).strokeColor(C.gold).lineWidth(0.6).stroke();
  doc.fontSize(6).fillColor(C.gray).font('Helvetica').text(
    'Generated by Fund-Raise  |  ' + ctx.today + '  |  Confidential  |  Page ' + pageNum,
    M, footY, { width: CW, align: 'center' }
  );
}

function drawConfidentialBadge(doc, x, y) {
  doc.fontSize(10).fillColor(C.red).font('Helvetica-Bold')
    .text('CONFIDENTIAL', x, y, { width: 100, align: 'right', lineBreak: false });
  doc.font('Helvetica');
}

/**
 * Department page title (navy "DEPT NAME FY 20XX-XX" with CONFIDENTIAL badge).
 */
function renderDeptTitle(ctx) {
  const { doc, dept, fy } = ctx;
  const fyShort = fy ? 'FY ' + (fy - 1) + '-' + String(fy).slice(-2) : '';
  doc.fontSize(22).fillColor(C.navy).font('Helvetica-Bold')
    .text(dept.label + ' ', M, 58, { width: CW, continued: true });
  doc.fillColor(C.blue).text(fyShort, { continued: false });
  doc.font('Helvetica');
  drawConfidentialBadge(doc, PW - M - 110, 62);
}

/**
 * Lay out a 3-card grid below the title.  Returns the card geometry so
 * each page renderer can drop its content into the cards.
 */
function drawThreeCards(ctx) {
  const { doc } = ctx;
  const cardY = 96;
  const cardH = PH - cardY - 32;
  const gap = 10;
  const cardW = (CW - gap * 2) / 3;
  const xs = [M, M + cardW + gap, M + 2 * (cardW + gap)];
  xs.forEach(x => charts.drawCard(doc, x, cardY, cardW, cardH, {
    borderColor: C.blueBorder, borderWidth: 2, radius: 8,
  }));
  return { cards: { x: xs, y: cardY, w: cardW, h: cardH } };
}

/**
 * Render the Q4 Highlights / Q1 Priorities narrative box.
 * If narrative is empty, shows a small placeholder.
 */
function drawNarrativeCard(ctx, x, y, w, h, narrative) {
  const { doc, fy } = ctx;
  const nextFy = fy ? (fy + 1) : null;

  const hasContent = !!(narrative && (narrative.highlights || narrative.priorities));

  let cy = y + 14;
  // Q4 Highlights section
  doc.fontSize(11).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text('Q4 Highlights:', x + 14, cy, { width: w - 28, lineBreak: false });
  cy += 15;
  if (narrative && narrative.highlights) {
    cy = drawBulletedText(doc, x + 14, cy, w - 28, narrative.highlights);
  } else {
    doc.fontSize(8).fillColor(C.grayLight).font('Helvetica-Oblique')
      .text('Add highlights via the Philanthropy Report page.', x + 14, cy, { width: w - 28 });
    cy += 22;
  }
  doc.font('Helvetica');

  // Priorities section — positioned lower half of card
  const priY = Math.max(cy + 10, y + h * 0.5);
  const priLabel = nextFy ? (nextFy - 1) + '-' + String(nextFy).slice(-2) + ' Q1 Priorities:' : 'Q1 Priorities:';
  doc.fontSize(11).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text(priLabel, x + 14, priY, { width: w - 28, lineBreak: false });
  if (narrative && narrative.priorities) {
    drawBulletedText(doc, x + 14, priY + 15, w - 28, narrative.priorities);
  } else {
    doc.fontSize(8).fillColor(C.grayLight).font('Helvetica-Oblique')
      .text('Add priorities via the Philanthropy Report page.', x + 14, priY + 15, { width: w - 28 });
  }
  doc.font('Helvetica');

  // If nothing has been entered at all, show a more prominent hint
  if (!hasContent) {
    // small helper hint at bottom
    doc.fontSize(7).fillColor(C.grayLight).font('Helvetica-Oblique')
      .text('Tip: on /crm/philanthropy-report you can add highlights, priorities, and commentary per department.',
        x + 14, y + h - 22, { width: w - 28 });
    doc.font('Helvetica');
  }
}

/**
 * Render a block of text as a bullet list.  Lines starting with "-" or "•"
 * keep their bullet; lines with leading whitespace are treated as sub-bullets.
 */
function drawBulletedText(doc, x, y, width, text) {
  if (!text) return y;
  const lines = String(text).split(/\r?\n/).filter(l => l.trim().length > 0);
  let cy = y;
  const lineH = 12;
  doc.fontSize(9).fillColor('#1e293b').font('Helvetica');
  lines.forEach(raw => {
    const indent = raw.match(/^\s+/) ? 12 : 0;
    const clean = raw.replace(/^[\s]*[-•]\s*/, '').trim();
    const bullet = indent > 0 ? '\u2013' : '\u2022'; // en dash for sub-bullet, bullet for main
    doc.fillColor('#1e293b')
      .text(bullet + '  ' + clean, x + indent, cy, {
        width: width - indent, lineBreak: true,
      });
    const consumed = doc.heightOfString(bullet + '  ' + clean, { width: width - indent });
    cy += Math.max(lineH, consumed + 2);
  });
  return cy;
}

/**
 * Small bordered box used for stat callouts (like the Giving Tuesday
 * box on the Annual Giving page).
 */
function drawCallout(doc, x, y, w, h, opts) {
  const { title, leftLabel, leftValue, rightLabel, rightValue } = opts;
  charts.drawCard(doc, x, y, w, h, { borderColor: C.blueBorder, borderWidth: 2, radius: 6 });
  doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text(title, x + 12, y + 6, { width: w - 24, lineBreak: false });
  // Side-by-side label + value in two columns, on a single row
  const midX = x + w / 2;
  const labelY = y + 24;
  const valueY = y + 24;
  doc.fontSize(8).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text(leftLabel, x + 12, labelY, { width: 40, lineBreak: false });
  doc.fontSize(13).fillColor(C.navyDark).font('Helvetica-Bold')
    .text(leftValue, x + 52, valueY - 2, { width: midX - x - 60, lineBreak: false });
  doc.fontSize(8).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text(rightLabel, midX + 4, labelY, { width: 48, lineBreak: false });
  doc.fontSize(13).fillColor(C.navyDark).font('Helvetica-Bold')
    .text(rightValue, midX + 54, valueY - 2, { width: w / 2 - 60, lineBreak: false });
  doc.font('Helvetica');
}

// ────────────────────────────────────────────────────────────────────────────
// PAGE RENDERERS — implemented in separate files below
// ────────────────────────────────────────────────────────────────────────────

function renderProgramOverview(ctx) {
  const { doc, data } = ctx;
  drawHeader(ctx, 'Philanthropy Program Report');

  // Title
  const titleText = 'PHILANTHROPY PROGRAM REPORT ' +
    (ctx.fy ? 'FY ' + (ctx.fy - 1) + '-' + String(ctx.fy).slice(-2) : '');
  doc.fontSize(22).fillColor(C.navy).font('Helvetica-Bold')
    .text(titleText, M, 58, { width: CW - 120, align: 'left' });
  drawConfidentialBadge(doc, PW - M - 110, 62);
  doc.fontSize(9).fillColor(C.gray).font('Helvetica')
    .text('Prepared by ' + ctx.preparedBy + '  \u2022  ' + ctx.today,
      M, 88, { width: CW });

  // Sum goals across departments
  const goalByDept = {};
  (data.deptGoals || []).forEach(g => {
    goalByDept[g.department] = Number(g.goalAmount || g.goal_amount || 0);
  });
  const actualByDept = {};
  (data.deptActuals || []).forEach(a => {
    actualByDept[a.department] = Number(a.total || 0);
  });
  const totalGoal = Object.values(goalByDept).reduce((a, b) => a + b, 0);
  const totalRaised = Number(data.overview.total_raised || 0);
  const totalGifts = Number(data.overview.total_gifts || 0);
  const goalPct = totalGoal > 0 ? Math.round(totalRaised / totalGoal * 100) : null;

  // 4 Hero KPI cards
  const kpiY = 108;
  const kpiH = 68;
  const kpiW = (CW - 3 * 10) / 4;
  const heroKpis = [
    { label: 'GOAL', value: totalGoal > 0 ? fmtCompact(totalGoal) : '—' },
    { label: '$ GIFTS', value: fmtCompact(totalRaised) },
    { label: '# GIFTS', value: fmtN(totalGifts) },
    { label: '% GOAL', value: goalPct !== null ? goalPct + '%' : '—',
      valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) },
  ];
  heroKpis.forEach((k, i) => {
    const x = M + i * (kpiW + 10);
    charts.drawCard(doc, x, kpiY, kpiW, kpiH, { borderColor: C.blueBorder, borderWidth: 2, radius: 8 });
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(k.label, x + 12, kpiY + 10, { width: kpiW - 24, lineBreak: false });
    doc.fontSize(24).fillColor(k.valueColor || C.navyDark).font('Helvetica-Bold')
      .text(k.value, x + 12, kpiY + 28, { width: kpiW - 24, lineBreak: false });
    doc.font('Helvetica');
  });

  // 5-year comparison table (left) + 5-year chart (right)
  const bottomY = 192;
  const leftW = CW * 0.60;
  const rightW = CW - leftW - 16;

  doc.fontSize(12).fillColor(C.navy).font('Helvetica-Bold')
    .text('5-Year Comparison', M, bottomY, { width: CW });
  doc.font('Helvetica');

  const allYears = (data.yoy && data.yoy.years) ? [...data.yoy.years] : [];
  const fiveYears = allYears.slice(-5);
  while (fiveYears.length < 5) fiveYears.unshift(null);

  const tblY = bottomY + 22;
  const lblColW = 100;
  const yrColW = (leftW - lblColW) / 5;
  const rowH = 24;

  // Header row
  doc.rect(M, tblY, leftW, rowH).fill(C.navy);
  doc.fontSize(8).fillColor(C.white).font('Helvetica-Bold')
    .text('Metric', M + 8, tblY + 8, { width: lblColW - 16 });
  fiveYears.forEach((y, i) => {
    const cx = M + lblColW + i * yrColW;
    const lbl = y ? 'FY' + Number(y.fy) : '—';
    doc.fontSize(10).fillColor(C.white)
      .text(lbl, cx, tblY + 7, { width: yrColW, align: 'center' });
  });
  doc.font('Helvetica');

  const metrics = [
    { label: 'Total Giving', key: 'total_raised', fmt: fmtCompact },
    { label: '# of Gifts', key: 'gift_count', fmt: fmtN },
    { label: '# of Donors', key: 'donor_count', fmt: fmtN },
  ];
  metrics.forEach((m, idx) => {
    const ry = tblY + rowH + idx * rowH;
    if (idx % 2 === 0) doc.rect(M, ry, leftW, rowH).fill(C.zebra);
    doc.fontSize(9).fillColor(C.navy).font('Helvetica-Bold')
      .text(m.label, M + 8, ry + 8, { width: lblColW - 16 });
    doc.font('Helvetica');
    fiveYears.forEach((y, i) => {
      const cx = M + lblColW + i * yrColW;
      const v = y ? m.fmt(y[m.key]) : '—';
      doc.fontSize(10).fillColor(C.navy)
        .text(v, cx, ry + 7, { width: yrColW, align: 'center' });
    });
  });
  const tblEndY = tblY + rowH * 4;
  doc.rect(M, tblY, leftW, tblEndY - tblY).strokeColor('#cbd5e1').lineWidth(0.5).stroke();

  // Right side: retention donut + dept contribution donut
  const rightX = M + leftW + 16;
  charts.drawCard(doc, rightX, bottomY + 22, rightW, tblEndY - tblY, { borderColor: '#cbd5e1', borderWidth: 1, radius: 6 });

  if (data.retention) {
    doc.fontSize(10).fillColor(C.navy).font('Helvetica-Bold')
      .text('Donor Retention', rightX + 12, bottomY + 32, { width: rightW - 24 });
    doc.font('Helvetica');
    const r = data.retention;
    const slices = [
      { label: 'Retained', value: Number(r.retained || 0), color: C.green },
      { label: 'New', value: Number(r.brand_new || r.new_donors || 0), color: C.blue },
      { label: 'Recovered', value: Number(r.recovered || 0), color: C.gold },
      { label: 'Lapsed', value: Number(r.lapsed || 0), color: C.red },
    ].filter(s => s.value > 0);
    const donutCx = rightX + 50;
    const donutCy = bottomY + 80;
    charts.drawDonut(doc, donutCx, donutCy, 28, 16, slices);
    doc.fontSize(11).fillColor(C.navy).font('Helvetica-Bold')
      .text((r.retention_rate || 0) + '%', donutCx - 30, donutCy - 5, { width: 60, align: 'center', lineBreak: false });
    doc.font('Helvetica');
    charts.drawLegend(doc, rightX + 100, bottomY + 52, slices, {
      fontSize: 7, rowH: 12, swatchSize: 7, width: rightW - 112,
      valueFmt: v => fmtN(v),
    });
  } else {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Oblique')
      .text('Retention data requires a selected FY.', rightX + 12, bottomY + 42, { width: rightW - 24 });
    doc.font('Helvetica');
  }

  // Department Contribution — full-width strip
  const stripY = tblEndY + 20;
  doc.fontSize(12).fillColor(C.navy).font('Helvetica-Bold')
    .text('Department Contribution', M, stripY, { width: CW });
  doc.font('Helvetica');
  const stripH = 74;
  const stripInnerY = stripY + 22;
  doc.rect(M, stripInnerY, CW, stripH).fill(C.lightGray);
  const deptColW = CW / DEPARTMENTS.length;
  DEPARTMENTS.forEach((d, i) => {
    const dx = M + i * deptColW + 10;
    const actual = Number(actualByDept[d.key] || 0);
    const g = Number(goalByDept[d.key] || 0);
    const pct = g > 0 ? Math.round(actual / g * 100) : null;
    doc.fontSize(9).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(d.label.toUpperCase(), dx, stripInnerY + 8, { width: deptColW - 20 });
    doc.fontSize(16).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(fmtCompact(actual), dx, stripInnerY + 24, { width: deptColW - 20 });
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('Goal: ' + (g > 0 ? fmtCompact(g) : '—') + (pct !== null ? '  \u2022  ' + pct + '%' : ''),
        dx, stripInnerY + 48, { width: deptColW - 20 });
    // Mini progress bar
    if (g > 0) {
      const barW = deptColW - 28;
      const fillPct = Math.min(1, actual / g);
      doc.rect(dx, stripInnerY + 60, barW, 4).fill('#d1d5db');
      doc.rect(dx, stripInnerY + 60, barW * fillPct, 4).fill(pct >= 100 ? C.green : (pct >= 75 ? C.amber : C.red));
    }
  });

  // Goal vs Actual by Program — grouped bar chart in the remaining space
  const chartY = stripInnerY + stripH + 14;
  const chartH = PH - 28 - chartY - 4; // leave room for footer
  if (chartH > 80) {
    doc.fontSize(12).fillColor(C.navy).font('Helvetica-Bold')
      .text('Goal vs Actual by Program', M, chartY, { width: CW });
    doc.font('Helvetica');

    const barAreaY = chartY + 20;
    const barAreaH = chartH - 30;
    const barAreaW = CW;
    const deptCount = DEPARTMENTS.length;
    const groupW = barAreaW / deptCount;
    const barGap = 6;
    const barW = (groupW - barGap * 3) / 2;
    const maxVal = Math.max(
      ...DEPARTMENTS.map(d => Math.max(Number(goalByDept[d.key] || 0), Number(actualByDept[d.key] || 0))),
      1
    );

    // Gridlines
    doc.lineWidth(0.3).strokeColor('#e5e7eb');
    for (let g = 0; g <= 4; g++) {
      const gy = barAreaY + barAreaH - (g / 4) * barAreaH;
      doc.moveTo(M, gy).lineTo(M + barAreaW, gy).stroke();
      const gv = (g / 4) * maxVal;
      doc.fontSize(6).fillColor(C.grayLight).font('Helvetica')
        .text(fmtCompact(gv), M - 2, gy - 4, { width: 45, align: 'right', lineBreak: false });
    }

    DEPARTMENTS.forEach((d, i) => {
      const gx = M + i * groupW + barGap;
      const goalVal = Number(goalByDept[d.key] || 0);
      const actualVal = Number(actualByDept[d.key] || 0);

      // Goal bar (blue)
      const goalH = maxVal > 0 ? (goalVal / maxVal) * barAreaH : 0;
      doc.rect(gx, barAreaY + barAreaH - goalH, barW, goalH).fill('#3b82f6');

      // Actual bar (red/orange)
      const actualH = maxVal > 0 ? (actualVal / maxVal) * barAreaH : 0;
      doc.rect(gx + barW + barGap, barAreaY + barAreaH - actualH, barW, actualH).fill('#ef4444');

      // Department label below
      const shortLabel = d.label.length > 12 ? d.label.substring(0, 11) + '\u2026' : d.label;
      doc.fontSize(7).fillColor(C.navy).font('Helvetica')
        .text(shortLabel, gx - barGap, barAreaY + barAreaH + 3,
          { width: groupW, align: 'center', lineBreak: false });
    });

    // Legend
    const legY = barAreaY - 2;
    const legX = M + CW - 180;
    doc.rect(legX, legY, 8, 8).fill('#3b82f6');
    doc.fontSize(7).fillColor(C.gray).font('Helvetica')
      .text('Goal', legX + 12, legY, { width: 40, lineBreak: false });
    doc.rect(legX + 60, legY, 8, 8).fill('#ef4444');
    doc.fontSize(7).fillColor(C.gray).font('Helvetica')
      .text('FY' + (ctx.fy || ''), legX + 72, legY, { width: 60, lineBreak: false });
  }

  drawFooter(ctx, 1);
}
function renderLegacyGiving(ctx) {
  const { doc, dept, detail, extras, narrative, goal } = ctx;
  drawHeader(ctx, dept.label);
  renderDeptTitle(ctx);

  // Derive metrics
  const summary = detail.summary || {};
  const raised = Number(summary.total_raised || 0);
  const variance = goal - raised;
  const goalPct = goal > 0 ? Math.round(raised / goal * 100) : null;
  const avgGift = Number(summary.avg_gift || 0);
  const lifetimeAvg = extras.lifetimeAvgGift || 0;

  // 3-year and 5-year averages from yoy
  const yoy = detail.yoy || [];
  const yoyDesc = [...yoy].sort((a, b) => Number(b.fy) - Number(a.fy));
  const avg3 = yoyDesc.slice(0, 3).length
    ? yoyDesc.slice(0, 3).reduce((s, y) => s + Number(y.total || 0), 0) / yoyDesc.slice(0, 3).length
    : 0;
  const avg5 = yoyDesc.slice(0, 5).length
    ? yoyDesc.slice(0, 5).reduce((s, y) => s + Number(y.total || 0), 0) / yoyDesc.slice(0, 5).length
    : 0;

  // 3-card layout
  const { cards } = drawThreeCards(ctx);
  const [leftX, midX, rightX] = cards.x;
  const cardY = cards.y;
  const cardW = cards.w;
  const cardH = cards.h;

  // ── LEFT CARD: KPIs + averages + commentary ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'Annual Goal', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Variance',
    goal > 0 ? fmtD(variance) : '—',
    { valueColor: variance <= 0 ? C.green : C.red });
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // Top 10 Donors — pulled from getDepartmentDetail's topDonors (already
  // powering the individual Legacy Giving dashboard under CRM Overview).
  const topDonors = (detail.topDonors || []).slice(0, 10);
  const donorsY = ly + 10;
  doc.fontSize(11).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text('Top 10 Donors', leftX + 14, donorsY, { width: cardW - 28, lineBreak: false });
  doc.font('Helvetica');
  const rowH = 14;
  const listStartY = donorsY + 16;
  if (topDonors.length === 0) {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Oblique')
      .text('No donors found for this period.', leftX + 14, listStartY, { width: cardW - 28 });
    doc.font('Helvetica');
  } else {
    topDonors.forEach((d, i) => {
      const ry = listStartY + i * rowH;
      if (i % 2 === 0) doc.rect(leftX + 10, ry - 1, cardW - 20, rowH).fill(C.zebra);
      const fullName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim()
        || d.constituent_name || ('Constituent #' + (d.constituent_id || '?'));
      const displayName = fullName.length > 26 ? fullName.substring(0, 25) + '\u2026' : fullName;
      doc.fontSize(8).fillColor(C.navy).font('Helvetica')
        .text((i + 1) + '. ' + displayName, leftX + 14, ry + 2,
          { width: cardW - 28 - 70, lineBreak: false });
      doc.fontSize(8).fillColor(C.navyDark).font('Helvetica-Bold')
        .text(fmtD(Number(d.total || d.total_given || d.total_credited || 0)),
          leftX + cardW - 14 - 70, ry + 2, { width: 70, align: 'right', lineBreak: false });
    });
    doc.font('Helvetica');
  }

  // Commentary (italic, grey) — placed just above the averages footer.
  // Anchored from the bottom so longer/shorter donor lists don't overlap it.
  const commentaryH = 40;
  const commentaryY = cardY + cardH - 44 - commentaryH - 4;
  if (narrative.commentary) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica-Oblique')
      .text(narrative.commentary, leftX + 14, commentaryY,
        { width: cardW - 28, height: commentaryH, ellipsis: true });
    doc.font('Helvetica');
  }

  // 3/5 year averages at bottom
  const avgY = cardY + cardH - 44;
  doc.fontSize(9).fillColor(C.navy).font('Helvetica')
    .text('3 year average', leftX + 14, avgY, { width: cardW / 2, lineBreak: false })
    .text(fmtD(avg3), leftX + cardW - 14 - 100, avgY, { width: 100, align: 'right', lineBreak: false })
    .text('5 year average', leftX + 14, avgY + 16, { width: cardW / 2, lineBreak: false })
    .text(fmtD(avg5), leftX + cardW - 14 - 100, avgY + 16, { width: 100, align: 'right', lineBreak: false });

  // ── MIDDLE CARD: Legacy stats + fund breakdown pie ──
  // Open Estates / New Expectancies / Total Expectancies are entered
  // manually by the Legacy Giving manager on the Philanthropy Report
  // page — they live in the philanthropy_narratives table alongside
  // highlights/priorities/commentary.
  let my = cardY + 16;
  const fmtIntOrDash = v => (v == null || v === '') ? '—' : fmtN(v);
  const midStats = [
    { label: 'Open Estates', value: fmtIntOrDash(narrative.openEstates) },
    { label: 'New Expectancies', value: fmtIntOrDash(narrative.newExpectancies) },
    { label: 'Total Expectancies', value: fmtIntOrDash(narrative.totalExpectancies) },
    { label: 'FY Average Gift', value: avgGift > 0 ? fmtD(Math.round(avgGift)) : '—' },
    { label: 'Lifetime Average Gift', value: lifetimeAvg > 0 ? fmtD(Math.round(lifetimeAvg)) : '—' },
  ];
  midStats.forEach(s => {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, midX + 14, my, { width: cardW - 28, lineBreak: false });
    doc.fontSize(14).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, midX + 14, my + 14, { width: cardW - 28, lineBreak: false });
    doc.font('Helvetica');
    my += 34;
  });

  // % Legacy Gifts by Fund — large centred donut, legend beneath in a
  // roomy single-column layout (the 2-column version was cramping long
  // fund names like "Rehabilitation & Healthy Lifestyles Program Fund").
  const funds = (detail.funds || []).slice(0, 8).map(f => ({
    label: f.fund_description || 'Unknown',
    value: Number(f.total || 0),
  }));
  if (funds.length > 0) {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text('% Legacy Gifts by Fund', midX + 14, my + 4, { width: cardW - 28 });
    doc.font('Helvetica');

    // Centre the donut horizontally. Keep it compact so the single-column
    // legend has enough vertical room to fit 8 rows with comfortable spacing.
    const donutCx = midX + cardW / 2;
    const donutCy = my + 68;
    charts.drawDonut(doc, donutCx, donutCy, 40, 18, funds);

    const fundTotal = funds.reduce((a, b) => a + Number(b.value), 0);

    // Single-column legend. Layout per row: [swatch 9px][gap 6px][label][% value right-aligned].
    // Each row uses the full inner card width with 18px of vertical spacing —
    // comfortably fits long fund names on one line at 8pt.
    const legendX = midX + 14;
    const legendW = cardW - 28;
    const legendTopY = donutCy + 50;
    const legendRowH = 18;
    const swatchSize = 9;
    const pctColW = 48;
    const labelX = legendX + swatchSize + 6;
    const labelW = legendW - swatchSize - 6 - pctColW - 4;

    funds.forEach((f, i) => {
      const rowY = legendTopY + i * legendRowH;
      const color = charts.DEFAULT_PALETTE[i % charts.DEFAULT_PALETTE.length];
      doc.rect(legendX, rowY + 2, swatchSize, swatchSize).fill(color);
      const pct = fundTotal > 0 ? ((Number(f.value) / fundTotal) * 100).toFixed(1) : '0';
      doc.fontSize(8).fillColor(C.navy).font('Helvetica')
        .text(f.label, labelX, rowY + 2, {
          width: labelW, height: 12, lineBreak: false, ellipsis: true,
        });
      doc.fontSize(8).fillColor(C.gray).font('Helvetica-Bold')
        .text(pct + '%', legendX + legendW - pctColW, rowY + 2, {
          width: pctColW, align: 'right', lineBreak: false,
        });
    });
    doc.font('Helvetica');
  }

  // ── RIGHT CARD: Narrative (Q4 Highlights + Q1 Priorities) ──
  drawNarrativeCard(ctx, rightX, cardY, cardW, cardH, narrative);
}
function renderMajorGifts(ctx) {
  const { doc, dept, detail, extras, narrative, goal } = ctx;
  drawHeader(ctx, dept.label);
  renderDeptTitle(ctx);

  const summary = detail.summary || {};
  const raised = Number(summary.total_raised || 0);
  const goalPct = goal > 0 ? Math.round(raised / goal * 100) : null;

  // Manual pledge stats from narrative (entered by MG manager on the
  // Philanthropy Report page) — preferred over auto-detected values.
  const fmtIntOrDash = v => (v == null || v === '') ? '—' : fmtN(v);
  const fmtDollarOrDash = v => (v == null || v === '') ? '—' : fmtD(v);

  const { cards } = drawThreeCards(ctx);
  const [leftX, midX, rightX] = cards.x;
  const cardY = cards.y, cardW = cards.w, cardH = cards.h;

  // ── LEFT CARD: KPIs + full MG by Fund list ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // MG by Fund — show as many as will fit in the remaining card space.
  // Calculate rows available: from ly+12 to bottom of card minus padding.
  const fundsStartY = ly + 12;
  const fundsEndY = cardY + cardH - 14;
  const fundRowH = 15;
  const maxFundRows = Math.min(20, Math.floor((fundsEndY - fundsStartY - 18) / fundRowH));
  const funds = (detail.funds || []).slice(0, maxFundRows).map(f => ({
    label: f.fund_description || 'Unknown',
    value: Number(f.total || 0),
  }));

  doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text('MG by Fund', leftX + 14, fundsStartY, { width: cardW - 28, lineBreak: false });
  doc.font('Helvetica');
  charts.drawHBarChart(doc, leftX + 14, fundsStartY + 16, cardW - 28, funds, {
    labelW: cardW * 0.52, valueW: 50, rowH: fundRowH, fontSize: 7,
    valueFmt: v => fmtCompact(v), barColor: C.blue,
  });

  // ── MIDDLE CARD: Manual pledge stats + solicitor pie + gift type pie + Top 10 Donors ──
  let my = cardY + 16;
  const midStats = [
    { label: '# Pledged Gifts', value: fmtIntOrDash(narrative.mgPledgedCount) },
    { label: '$ Pledged Gifts', value: fmtDollarOrDash(narrative.mgPledgedAmount) },
    { label: '$ Gifts Received', value: fmtDollarOrDash(narrative.mgGiftsReceivedAmount) },
    { label: '# New MG Donors', value: fmtN(detail.retention ? (detail.retention.new_donors || 0) : 0) },
  ];
  midStats.forEach(s => {
    doc.fontSize(9).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, midX + 14, my, { width: cardW - 28, lineBreak: false });
    doc.fontSize(13).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, midX + 14, my + 12, { width: cardW - 28, lineBreak: false });
    doc.font('Helvetica');
    my += 26;
  });

  // Solicitor pie (top fundraisers)
  const solicitors = (detail.fundraisers || []).slice(0, 5).map(f => ({
    label: (((f.fundraiser_first_name || '') + ' ' + (f.fundraiser_last_name || '')).trim() || f.fundraiser_name || 'Unknown'),
    value: Number(f.total_credited || 0),
  })).filter(s => s.value > 0);

  if (solicitors.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('Major Gifts by Solicitor', midX + 14, my + 2, { width: cardW - 28 });
    const cx = midX + 42;
    const cy = my + 36;
    charts.drawPieChart(doc, cx, cy, 24, solicitors);
    charts.drawLegend(doc, midX + 78, my + 14, solicitors, {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 94,
      valueFmt: v => fmtCompact(v),
    });
    my += 74;
  }

  // Gift type (channel) donut
  const giftTypes = (extras.channels || []).slice(0, 5).map(c => ({
    label: c.channel,
    value: Number(c.total || 0),
  }));
  if (giftTypes.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('MG by gift type', midX + 14, my + 2, { width: cardW - 28 });
    const cx = midX + 42;
    const cy = my + 36;
    charts.drawDonut(doc, cx, cy, 22, 10, giftTypes);
    charts.drawLegend(doc, midX + 78, my + 16, giftTypes, {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 92,
      valueFmt: v => fmtCompact(v),
    });
    my += 70;
  }

  // Top 10 Donors — below the charts
  const topDonors = (detail.topDonors || []).slice(0, 10);
  doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text('Top 10 Donors', midX + 14, my + 4, { width: cardW - 28, lineBreak: false });
  doc.font('Helvetica');
  const donorStartY = my + 20;
  const donorRowH = 14;
  if (topDonors.length === 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica-Oblique')
      .text('No donors found for this period.', midX + 14, donorStartY, { width: cardW - 28 });
    doc.font('Helvetica');
  } else {
    topDonors.forEach((d, i) => {
      const ry = donorStartY + i * donorRowH;
      if (i % 2 === 0) doc.rect(midX + 10, ry - 1, cardW - 20, donorRowH).fill(C.zebra);
      const fullName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim()
        || d.constituent_name || ('Constituent #' + (d.constituent_id || '?'));
      const displayName = fullName.length > 22 ? fullName.substring(0, 21) + '\u2026' : fullName;
      doc.fontSize(7).fillColor(C.navy).font('Helvetica')
        .text((i + 1) + '. ' + displayName, midX + 14, ry + 2,
          { width: cardW - 28 - 55, lineBreak: false });
      doc.fontSize(7).fillColor(C.navyDark).font('Helvetica-Bold')
        .text(fmtD(Number(d.total || d.total_given || d.total_credited || 0)),
          midX + cardW - 14 - 55, ry + 2, { width: 55, align: 'right', lineBreak: false });
    });
    doc.font('Helvetica');
  }

  // ── RIGHT CARD: Narrative ──
  drawNarrativeCard(ctx, rightX, cardY, cardW, cardH, narrative);
}
function renderEvents(ctx) {
  const { doc, dept, detail, extras, narrative, goal } = ctx;
  drawHeader(ctx, dept.label);
  renderDeptTitle(ctx);

  const summary = detail.summary || {};
  const raised = Number(summary.total_raised || 0);
  const goalPct = goal > 0 ? Math.round(raised / goal * 100) : null;

  const sig = extras.signatureEvents || { total: 0, gift_count: 0, event_count: 0 };
  const com = extras.communityEvents || { total: 0, gift_count: 0, event_count: 0 };
  const sigTotal = Number(sig.total || 0);
  const comTotal = Number(com.total || 0);
  // Assume 58%/42% goal split by default (can be refined with dedicated sub-goals later)
  const sigGoal = goal ? goal * 0.58 : 0;
  const comGoal = goal ? goal * 0.42 : 0;

  const { cards } = drawThreeCards(ctx);
  const [leftX, midX, rightX] = cards.x;
  const cardY = cards.y, cardW = cards.w, cardH = cards.h;

  // ── LEFT CARD: Main KPIs + Signature Events pie ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Raised', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // Signature Events pie + revenue list below
  const sigEvents = (extras.eventBreakdown || []).slice(0, 8).map(e => ({
    label: e.event_name || 'Unknown',
    value: Number(e.revenue || 0),
  }));
  if (sigEvents.length > 0) {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text('Signature Events Revenue', leftX + 14, ly + 8, { width: cardW - 28 });
    doc.font('Helvetica');
    // Centred pie
    const cx = leftX + cardW / 2;
    const cy = ly + 60;
    charts.drawPieChart(doc, cx, cy, 34, sigEvents);
    // Legend below pie (single column, colour swatch + name only)
    const legendY = cy + 42;
    sigEvents.slice(0, 6).forEach((ev, i) => {
      const ry = legendY + i * 12;
      const color = charts.DEFAULT_PALETTE[i % charts.DEFAULT_PALETTE.length];
      doc.rect(leftX + 14, ry + 2, 8, 8).fill(color);
      const shortName = ev.label.length > 28 ? ev.label.substring(0, 27) + '\u2026' : ev.label;
      doc.fontSize(7).fillColor(C.navy).font('Helvetica')
        .text(shortName, leftX + 26, ry + 2, { width: cardW - 28 - 16, lineBreak: false });
    });
    // Revenue list below legend — each event with its $ amount
    const revListY = legendY + sigEvents.slice(0, 6).length * 12 + 10;
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
      .text('Revenue by Event', leftX + 14, revListY, { width: cardW - 28 });
    doc.font('Helvetica');
    sigEvents.forEach((ev, i) => {
      const ry = revListY + 16 + i * 16;
      if (i % 2 === 0) doc.rect(leftX + 10, ry - 1, cardW - 20, 16).fill(C.zebra);
      const shortName = ev.label.length > 24 ? ev.label.substring(0, 23) + '\u2026' : ev.label;
      doc.fontSize(8).fillColor(C.navy)
        .text(shortName, leftX + 14, ry + 3, { width: cardW - 28 - 60, lineBreak: false });
      doc.fontSize(8).fillColor(C.navyDark).font('Helvetica-Bold')
        .text(fmtCompact(ev.value), leftX + cardW - 14 - 60, ry + 3,
          { width: 60, align: 'right', lineBreak: false });
      doc.font('Helvetica');
    });
  }

  // ── MIDDLE CARD: Sig/Community breakdown + event table ──
  let my = cardY + 16;

  const midStats = [
    { label: 'Sig. Events Goal', value: sigGoal > 0 ? fmtD(Math.round(sigGoal)) : '—' },
    { label: 'Sig. Events', value: fmtD(sigTotal) },
    { label: '# Sig. Events', value: fmtN(sig.event_count || 0) },
    { label: 'Comm. Events Goal', value: comGoal > 0 ? fmtD(Math.round(comGoal)) : '—' },
    { label: 'Comm. Events', value: fmtD(comTotal) },
  ];
  midStats.forEach(s => {
    doc.fontSize(9).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, midX + 14, my, { width: cardW - 28, lineBreak: false });
    doc.fontSize(13).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, midX + 14, my + 12, { width: cardW - 28, lineBreak: false });
    doc.font('Helvetica');
    my += 28;
  });

  // Event breakdown table — wide EVENT column, narrow # GIFTS + REVENUE
  const tblY = my + 8;
  const events = (extras.eventBreakdown || []).slice(0, 8);
  if (events.length > 0) {
    const tblW = cardW - 20;
    const cols = [
      { label: 'EVENT', w: 0.60, align: 'left' },
      { label: '# GIFTS', w: 0.16, align: 'right' },
      { label: 'REVENUE', w: 0.24, align: 'right' },
    ];
    // Header
    doc.rect(midX + 10, tblY, tblW, 16).fill(C.navy);
    let cx = midX + 14;
    cols.forEach(c => {
      const w = tblW * c.w;
      doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
        .text(c.label, cx, tblY + 5, { width: w - 4, align: c.align, lineBreak: false });
      cx += w;
    });
    doc.font('Helvetica');
    // Rows
    events.forEach((e, i) => {
      const ry = tblY + 16 + i * 15;
      if (i % 2 === 0) doc.rect(midX + 10, ry, tblW, 15).fill(C.zebra);
      let tx = midX + 14;
      // Wide first column — more room for event names
      const nameW = tblW * 0.60 - 4;
      doc.fontSize(8).fillColor(C.navy)
        .text(e.event_name || 'Unknown', tx, ry + 4, {
          width: nameW, lineBreak: false, ellipsis: true,
        });
      tx += tblW * 0.60;
      doc.text(fmtN(e.gift_count), tx, ry + 4, { width: tblW * 0.16 - 4, align: 'right', lineBreak: false });
      tx += tblW * 0.16;
      doc.text(fmtCompact(e.revenue), tx, ry + 4, { width: tblW * 0.24 - 4, align: 'right', lineBreak: false });
    });
  }

  // ── RIGHT CARD: Narrative ──
  drawNarrativeCard(ctx, rightX, cardY, cardW, cardH, narrative);
}
function renderAnnualGiving(ctx) {
  const { doc, dept, detail, extras, narrative, goal } = ctx;
  drawHeader(ctx, dept.label);
  renderDeptTitle(ctx);

  const summary = detail.summary || {};
  const raised = Number(summary.total_raised || 0);
  const goalPct = goal > 0 ? Math.round(raised / goal * 100) : null;

  // Channel breakdown (online / mailed)
  const channels = extras.channels || [];
  const channelMap = {};
  channels.forEach(c => { channelMap[c.channel] = c; });
  const onlineCount = Number((channelMap['Online'] || {}).gift_count || 0);
  const mailedCount = Number((channelMap['Mailed in'] || {}).gift_count || 0);
  const onlineTotal = Number((channelMap['Online'] || {}).total || 0);
  const mailedTotal = Number((channelMap['Mailed in'] || {}).total || 0);

  const { cards } = drawThreeCards(ctx);
  const [leftX, midX, rightX] = cards.x;
  const cardY = cards.y, cardW = cards.w, cardH = cards.h;

  // ── LEFT CARD: KPIs + h-bar by category with $ amounts + Giving Tuesday ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // By-category breakdown — horizontal bar chart (cleaner than grouped
  // bars which had scale-mismatch issues). Shows $ raised per appeal
  // with a secondary row for # gifts underneath each bar.
  const appeals = (detail.appeals || []).slice(0, 8);
  if (appeals.length > 0) {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text('By Category', leftX + 14, ly + 10, { width: cardW - 28 });
    doc.font('Helvetica');
    const listY = ly + 26;
    const rowH = 28; // taller rows: bar + sub-line for # gifts
    const maxVal = Math.max(...appeals.map(a => Number(a.total || 0)), 1);
    const labelW = 0;  // no label column — name goes above bar
    const barW = cardW - 28 - 60; // leave room for $ amount on the right

    appeals.forEach((a, i) => {
      const ry = listY + i * rowH;
      if (i % 2 === 0) doc.rect(leftX + 10, ry - 1, cardW - 20, rowH).fill(C.zebra);
      const name = (a.appeal_description || 'Unknown');
      const shortName = name.length > 22 ? name.substring(0, 21) + '\u2026' : name;
      const total = Number(a.total || 0);
      const bw = Math.max(2, (total / maxVal) * barW);

      // Appeal name + bar + $ amount
      doc.fontSize(7).fillColor(C.gray).font('Helvetica')
        .text(shortName, leftX + 14, ry + 1, { width: cardW - 28, lineBreak: false });
      doc.rect(leftX + 14, ry + 11, bw, 7).fill(C.blue);
      doc.fontSize(7).fillColor(C.navyDark).font('Helvetica-Bold')
        .text(fmtCompact(total), leftX + 14 + bw + 4, ry + 10,
          { width: 50, lineBreak: false });
      // # gifts count on second line
      doc.fontSize(6).fillColor(C.grayLight).font('Helvetica')
        .text(fmtN(a.gift_count || 0) + ' gifts', leftX + 14, ry + 20,
          { width: cardW - 28, lineBreak: false });
    });
  }

  // Giving Tuesday callout at bottom of left card
  const gtTotal = Number((extras.givingTuesday || {}).total || 0);
  const gtGoal = 30000;
  const gtCalYear = ctx.fy ? (ctx.fy - 1) : null;
  const gtY = cardY + cardH - 62;
  drawCallout(doc, leftX + 10, gtY, cardW - 20, 52, {
    title: gtCalYear ? 'Giving Tuesday ' + gtCalYear : 'Giving Tuesday',
    leftLabel: 'GOAL', leftValue: fmtD(gtGoal),
    rightLabel: 'RAISED', rightValue: fmtD(gtTotal),
  });

  // ── MIDDLE CARD: Stats + larger Annual Giving by Category donut with $ amounts ──
  let my = cardY + 16;
  const midStats = [
    { label: '# Donations', value: fmtN(summary.gift_count || 0) },
    { label: '$ Gifts Received', value: fmtCompact(raised) },
    { label: '# Online Donations', value: fmtN(onlineCount) },
    { label: '# Mailed in Donations', value: fmtN(mailedCount) },
  ];
  midStats.forEach(s => {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, midX + 14, my, { width: cardW - 28, lineBreak: false });
    doc.fontSize(14).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, midX + 14, my + 14, { width: cardW - 28, lineBreak: false });
    doc.font('Helvetica');
    my += 32;
  });

  // Annual Giving by Category donut — larger, centred, legend below with $ amounts
  const catSlices = appeals.slice(0, 8).map(a => ({
    label: a.appeal_description || 'Unknown',
    value: Number(a.total || 0),
  }));
  if (catSlices.length > 0) {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text('Annual Giving by Category', midX + 14, my + 4, { width: cardW - 28 });
    doc.font('Helvetica');

    const donutCx = midX + cardW / 2;
    const donutCy = my + 56;
    charts.drawDonut(doc, donutCx, donutCy, 38, 16, catSlices);

    // Single-column legend below donut with $ amounts
    const legendY = donutCy + 46;
    const legendW = cardW - 28;
    const legendRowH = 16;
    const pctColW = 55;
    catSlices.forEach((s, i) => {
      const ry = legendY + i * legendRowH;
      const color = charts.DEFAULT_PALETTE[i % charts.DEFAULT_PALETTE.length];
      doc.rect(midX + 14, ry + 2, 8, 8).fill(color);
      const shortLabel = s.label.length > 24 ? s.label.substring(0, 23) + '\u2026' : s.label;
      doc.fontSize(7).fillColor(C.navy).font('Helvetica')
        .text(shortLabel, midX + 26, ry + 2, {
          width: legendW - 16 - pctColW, lineBreak: false, ellipsis: true,
        });
      doc.fontSize(7).fillColor(C.gray).font('Helvetica-Bold')
        .text(fmtCompact(s.value), midX + 14 + legendW - pctColW, ry + 2, {
          width: pctColW, align: 'right', lineBreak: false,
        });
    });
  }

  // ── RIGHT CARD: Narrative ──
  drawNarrativeCard(ctx, rightX, cardY, cardW, cardH, narrative);
}
function renderDirectResponse(ctx) {
  const { doc, dept, detail, extras, narrative, goal } = ctx;
  drawHeader(ctx, dept.label);
  renderDeptTitle(ctx);

  const summary = detail.summary || {};
  const raised = Number(summary.total_raised || 0);
  const goalPct = goal > 0 ? Math.round(raised / goal * 100) : null;
  const channels = extras.channels || [];
  const channelMap = {};
  channels.forEach(c => { channelMap[c.channel] = c; });
  // "Cash" in the PowerPoint = non-recurring gifts (one-time), which
  // includes all channels except Recurring.  Matches the source layout
  // where Cash + Recurring == Total Gifts Received.
  const recurringCount = Number((channelMap['Recurring'] || {}).gift_count || 0);
  const cashCount = Number(summary.gift_count || 0) - recurringCount;
  const bestAppeal = (detail.appeals || [])[0];

  // ── Top left KPI card (narrower) ──
  const leftW = 200;
  const leftX = M;
  const leftY = 96;
  const leftH = PH - leftY - 32;
  charts.drawCard(doc, leftX, leftY, leftW, leftH, { borderColor: C.blueBorder, borderWidth: 2, radius: 8 });

  let ly = leftY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, leftW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, leftW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, leftW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // Secondary stats
  const secStats = [
    { label: '# Gifts Received', value: fmtN(summary.gift_count || 0) },
    { label: '# Cash Gifts', value: fmtN(cashCount) },
    { label: '# Recurring Gifts', value: fmtN(recurringCount) },
  ];
  secStats.forEach(s => {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, leftX + 14, ly, { width: leftW - 28, lineBreak: false });
    doc.fontSize(13).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, leftX + 14, ly + 13, { width: leftW - 28, lineBreak: false });
    doc.font('Helvetica');
    ly += 30;
  });

  // Best performing appeal
  if (bestAppeal) {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text('Best performing appeal:', leftX + 14, ly + 8, { width: leftW - 28 });
    doc.fontSize(10).fillColor(C.blue).font('Helvetica-Bold')
      .text(bestAppeal.appeal_description || 'Unknown', leftX + 14, ly + 22, { width: leftW - 28 });
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text(fmtD(bestAppeal.total) + ' \u2022 ' + fmtN(bestAppeal.gift_count) + ' gifts',
        leftX + 14, ly + 38, { width: leftW - 28 });
    doc.font('Helvetica');
  }

  // ── Main right area: Gift By Appeal table (extended taller) ──
  const rightX = leftX + leftW + 12;
  const rightW = CW - leftW - 12;
  const rightY = 96;
  // Extend the table to take more vertical space — leave just enough
  // for the two chart cards below (120px each + gap + footer).
  const botChartH = 110;
  const tableH = PH - rightY - botChartH - 48;
  charts.drawCard(doc, rightX, rightY, rightW, tableH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });

  doc.fontSize(11).fillColor(C.navy).font('Helvetica-Bold')
    .text('Gift By Appeal', rightX + 14, rightY + 10, { width: rightW - 28 });
  doc.font('Helvetica');

  // Dynamically size rows to fill the table card
  const appeals = (detail.appeals || []).slice(0, 20);
  const appealTotal = appeals.reduce((s, a) => s + Number(a.total || 0), 0);
  const cols = [
    { label: 'Fund', w: 0.28, align: 'left' },
    { label: 'Amount', w: 0.14, align: 'right' },
    { label: '%', w: 0.08, align: 'right' },
    { label: 'Onetime', w: 0.10, align: 'right' },
    { label: 'Recurring', w: 0.12, align: 'right' },
    { label: 'Online', w: 0.10, align: 'right' },
    { label: 'Mailed in', w: 0.10, align: 'right' },
    { label: 'Total', w: 0.08, align: 'right' },
  ];
  const hdrY = rightY + 28;
  doc.rect(rightX + 10, hdrY, rightW - 20, 18).fill(C.navy);
  let hx = rightX + 14;
  cols.forEach(c => {
    const w = (rightW - 20) * c.w;
    doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
      .text(c.label, hx, hdrY + 6, { width: w - 4, align: c.align, lineBreak: false });
    hx += w;
  });
  doc.font('Helvetica');

  const availRowSpace = tableH - 28 - 18 - 8;
  const rowH = appeals.length > 0 ? Math.min(16, Math.floor(availRowSpace / appeals.length)) : 16;
  appeals.forEach((a, i) => {
    const ry = hdrY + 18 + i * rowH;
    if (i % 2 === 0) doc.rect(rightX + 10, ry, rightW - 20, rowH).fill(C.zebra);
    const total = Number(a.total || 0);
    const pct = appealTotal > 0 ? (total / appealTotal * 100).toFixed(2) : '0.00';
    const giftsTotal = Math.max(1, Number(a.gift_count || 0));
    const cCash = Number((channelMap['Cash'] || {}).gift_count || 0);
    const cOnline = Number((channelMap['Online'] || {}).gift_count || 0);
    const cMail = Number((channelMap['Mailed in'] || {}).gift_count || 0);
    const cRec = Number((channelMap['Recurring'] || {}).gift_count || 0);
    const cTotal = cCash + cOnline + cMail + cRec;
    const proportion = (sub) => cTotal > 0 ? Math.round(giftsTotal * (sub / cTotal)) : 0;
    const vals = [
      (a.appeal_description || 'Unknown').substring(0, 22),
      fmtD(total),
      pct + '%',
      String(proportion(cCash)),
      String(proportion(cRec)),
      String(proportion(cOnline)),
      String(proportion(cMail)),
      fmtN(giftsTotal),
    ];
    let rx = rightX + 14;
    cols.forEach((c, ci) => {
      const w = (rightW - 20) * c.w;
      doc.fontSize(7).fillColor(C.navy)
        .text(vals[ci], rx, ry + 5, { width: w - 4, align: c.align, lineBreak: false });
      rx += w;
    });
  });
  if (appeals.length === 0) {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Oblique')
      .text('No appeal-level detail available.', rightX + 14, hdrY + 30, { width: rightW - 28 });
    doc.font('Helvetica');
  }

  // ── Bottom row: Source pie + # Gifts by Source h-bar (compact, centred) ──
  const botY = rightY + tableH + 8;
  const botColW = (rightW - 10) / 2;
  charts.drawCard(doc, rightX, botY, botColW, botChartH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });
  charts.drawCard(doc, rightX + botColW + 10, botY, botColW, botChartH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });

  const srcSlices = channels.map(c => ({ label: c.channel, value: Number(c.gift_count || 0) })).filter(s => s.value > 0);

  // Source of Gifts pie — centred in its card
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('Source of Gifts', rightX + 12, botY + 6, { width: botColW - 24 });
  doc.font('Helvetica');
  if (srcSlices.length > 0) {
    const pieCx = rightX + botColW * 0.30;
    const pieCy = botY + botChartH / 2 + 10;
    const pieR = Math.min(36, (botChartH - 24) / 2.2);
    charts.drawPieChart(doc, pieCx, pieCy, pieR, srcSlices);
    charts.drawLegend(doc, pieCx + pieR + 14, botY + 22, srcSlices, {
      fontSize: 7, rowH: 14, swatchSize: 8, width: botColW - pieCx + rightX - pieR - 20,
      valueFmt: v => fmtN(v),
    });
  }

  // # Gifts by Source — centred bars, compact
  const barCardX = rightX + botColW + 10;
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('# Gifts by Source', barCardX + 12, botY + 6, { width: botColW - 24 });
  doc.font('Helvetica');
  charts.drawHBarChart(doc, barCardX + 12, botY + 24, botColW - 24,
    srcSlices.map(s => ({ label: s.label, value: s.value })), {
      labelW: 70, valueW: 45, rowH: 20, fontSize: 8,
      valueFmt: v => fmtN(v), barColor: C.blue,
    });
}
function renderDepartmentPageStub(ctx) {
  drawHeader(ctx, ctx.dept.label);
  ctx.doc.fontSize(16).fillColor(C.navy).text(ctx.dept.label.toUpperCase(), M, 70);
}

// Export internal helpers so tests can exercise them
module.exports.drawHeader = drawHeader;
module.exports.drawFooter = drawFooter;
module.exports.drawConfidentialBadge = drawConfidentialBadge;
module.exports.renderProgramOverview = renderProgramOverview;
module.exports.renderLegacyGiving = renderLegacyGiving;
module.exports.renderMajorGifts = renderMajorGifts;
module.exports.renderEvents = renderEvents;
module.exports.renderAnnualGiving = renderAnnualGiving;
module.exports.renderDirectResponse = renderDirectResponse;
