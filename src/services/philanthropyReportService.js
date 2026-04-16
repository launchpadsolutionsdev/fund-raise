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
async function fetchReportData(crmSvc, { tenantId, fy, fyMonth }) {
  const { fyToDateRange } = _fyHelpers(fyMonth);
  const dateRange = fy ? fyToDateRange(fy) : null;
  const priorDateRange = fy ? fyToDateRange(fy - 1) : null;

  const [tenant, yoy, deptGoals, deptActuals, overview, priorOverview, retention] = await Promise.all([
    crmSvc.Tenant.findByPk(tenantId),
    crmSvc.getYearOverYearComparison(tenantId),
    crmSvc.getDepartmentGoals(tenantId, fy),
    crmSvc.getDepartmentActuals(tenantId, dateRange),
    crmSvc.getCrmOverview(tenantId, dateRange),
    priorDateRange ? crmSvc.getCrmOverview(tenantId, priorDateRange) : Promise.resolve(null),
    fy ? crmSvc.getDonorRetention(tenantId, fy) : Promise.resolve(null),
  ]);

  const deptDetails = await Promise.all(
    DEPARTMENTS.map(d => crmSvc.getDepartmentDetail(tenantId, d.key, dateRange))
  );
  const deptExtras = await Promise.all(
    DEPARTMENTS.map(d => fetchDepartmentExtras(tenantId, d.key, dateRange))
  );

  const narratives = fy ? await PhilanthropyNarrative.findAll({
    where: { tenantId, fiscalYear: fy },
    raw: true,
  }) : [];
  const narrativeByDept = {};
  narratives.forEach(n => { narrativeByDept[n.department] = n; });

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
    .text(title, x + 12, y + 8, { width: w - 24, lineBreak: false });
  const midX = x + w / 2;
  doc.fontSize(8).fillColor(C.blueLabel).font('Helvetica-Bold')
    .text(leftLabel, x + 12, y + 26, { width: midX - x - 16, lineBreak: false })
    .text(rightLabel, midX + 4, y + 26, { width: midX - x - 16, lineBreak: false });
  doc.fontSize(14).fillColor(C.navyDark)
    .text(leftValue, x + 12, y + 40, { width: midX - x - 16, lineBreak: false })
    .text(rightValue, midX + 4, y + 40, { width: midX - x - 16, lineBreak: false });
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

  // Commentary (italic, grey)
  if (narrative.commentary) {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Oblique')
      .text(narrative.commentary, leftX + 14, ly + 10, { width: cardW - 28, height: 60 });
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
  let my = cardY + 16;
  const midStats = [
    { label: 'Open Estates', value: '—', hint: 'Track via estate module' },
    { label: 'New Expectancies', value: '—' },
    { label: 'Total Expectancies', value: '—' },
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

  // % Legacy Gifts by Fund donut
  const funds = (detail.funds || []).slice(0, 6).map((f, i) => ({
    label: f.fund_description || 'Unknown',
    value: Number(f.total || 0),
  }));
  if (funds.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('% Legacy Gifts by Fund', midX + 14, my + 4, { width: cardW - 28 });
    const cx = midX + 45;
    const cy = my + 48;
    charts.drawDonut(doc, cx, cy, 28, 14, funds);
    charts.drawLegend(doc, midX + 88, my + 20, funds.slice(0, 5), {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 104,
      showValue: false,
    });
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

  // Pledge breakdown
  const pledges = extras.pledges || [];
  const pledged = pledges.find(p => p.kind === 'pledged') || { total: 0, gift_count: 0 };
  const paymentReceived = pledges.find(p => p.kind === 'received_payment') || { total: 0, gift_count: 0 };
  const cashReceived = pledges.find(p => p.kind === 'received_cash') || { total: 0, gift_count: 0 };
  const totalReceived = Number(paymentReceived.total) + Number(cashReceived.total);
  const totalReceivedCount = Number(paymentReceived.gift_count) + Number(cashReceived.gift_count);

  const { cards } = drawThreeCards(ctx);
  const [leftX, midX, rightX] = cards.x;
  const cardY = cards.y, cardW = cards.w, cardH = cards.h;

  // ── LEFT CARD: KPIs + MG by Fund + MG by Source ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // MG by Fund horizontal bar chart
  const funds = (detail.funds || []).slice(0, 6).map(f => ({
    label: f.fund_description || 'Unknown',
    value: Number(f.total || 0),
  }));
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('MG by Fund', leftX + 14, ly + 8, { width: cardW - 28 });
  doc.font('Helvetica');
  charts.drawHBarChart(doc, leftX + 14, ly + 22, cardW - 28, funds, {
    labelW: cardW * 0.45, valueW: 50, rowH: 14, fontSize: 6,
    valueFmt: v => fmtCompact(v), barColor: C.blue,
  });

  // MG by Source (constituent_type)
  const sources = (extras.sources || []).slice(0, 5).map(s => ({
    label: s.source || 'Unknown',
    value: Number(s.gift_count || 0),
  }));
  const srcY = ly + 22 + funds.length * 14 + 10;
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('MG by Source', leftX + 14, srcY, { width: cardW - 28 });
  doc.font('Helvetica');
  charts.drawHBarChart(doc, leftX + 14, srcY + 14, cardW - 28, sources, {
    labelW: cardW * 0.45, valueW: 40, rowH: 13, fontSize: 6,
    valueFmt: v => fmtN(v), barColor: C.amber,
  });

  // ── MIDDLE CARD: Pledged stats + solicitor pie + gift type pie ──
  let my = cardY + 16;
  const midStats = [
    { label: '# Pledged Gifts', value: fmtN(pledged.gift_count) },
    { label: '$ Pledged Gifts', value: fmtCompact(Number(pledged.total)) },
    { label: '# Gifts Received', value: fmtN(totalReceivedCount) },
    { label: '$ Gifts Received', value: fmtCompact(totalReceived) },
    { label: '# New MG Donors', value: fmtN(detail.retention ? (detail.retention.new_donors || 0) : 0) },
  ];
  midStats.forEach(s => {
    doc.fontSize(10).fillColor(C.blueLabel).font('Helvetica-Bold')
      .text(s.label, midX + 14, my, { width: cardW - 28, lineBreak: false });
    doc.fontSize(14).fillColor(C.navyDark).font('Helvetica-Bold')
      .text(s.value, midX + 14, my + 14, { width: cardW - 28, lineBreak: false });
    doc.font('Helvetica');
    my += 30;
  });

  // Solicitor donut (use top fundraisers)
  const solicitors = (detail.fundraisers || []).slice(0, 5).map(f => ({
    label: (((f.fundraiser_first_name || '') + ' ' + (f.fundraiser_last_name || '')).trim() || f.fundraiser_name || 'Unknown'),
    value: Number(f.total_credited || 0),
  })).filter(s => s.value > 0);

  if (solicitors.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('Major Gifts by Solicitor', midX + 14, my + 2, { width: cardW - 28 });
    const cx = midX + 42;
    const cy = my + 42;
    charts.drawPieChart(doc, cx, cy, 26, solicitors);
    charts.drawLegend(doc, midX + 80, my + 16, solicitors, {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 94,
      valueFmt: v => fmtCompact(v),
    });
  }

  // Gift type (channel) donut below
  const giftTypes = (extras.channels || []).slice(0, 5).map(c => ({
    label: c.channel,
    value: Number(c.total || 0),
  }));
  const gtY = my + 80;
  if (giftTypes.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('MG by gift type', midX + 14, gtY, { width: cardW - 28 });
    const cx = midX + 42;
    const cy = gtY + 40;
    charts.drawDonut(doc, cx, cy, 24, 12, giftTypes);
    charts.drawLegend(doc, midX + 78, gtY + 14, giftTypes, {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 92,
      valueFmt: v => fmtCompact(v),
    });
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

  // Signature Events pie — top events
  const sigEvents = (extras.eventBreakdown || []).slice(0, 6).map(e => ({
    label: e.event_name || 'Unknown',
    value: Number(e.revenue || 0),
  }));
  if (sigEvents.length > 0) {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
      .text('Signature Events Revenue', leftX + 14, ly + 8, { width: cardW - 28 });
    doc.font('Helvetica');
    const cx = leftX + 40;
    const cy = ly + 52;
    charts.drawPieChart(doc, cx, cy, 28, sigEvents);
    charts.drawLegend(doc, leftX + 78, ly + 26, sigEvents.slice(0, 6), {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 92,
      showValue: false,
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

  // Event breakdown table
  const tblY = my + 8;
  const events = (extras.eventBreakdown || []).slice(0, 5);
  if (events.length > 0) {
    const cols = [
      { label: 'EVENT', w: 0.40 },
      { label: '# GIFTS', w: 0.20 },
      { label: 'REVENUE', w: 0.40 },
    ];
    // Header
    doc.rect(midX + 10, tblY, cardW - 20, 16).fill(C.navy);
    let cx = midX + 14;
    cols.forEach(c => {
      const w = (cardW - 20) * c.w;
      doc.fontSize(7).fillColor(C.white).font('Helvetica-Bold')
        .text(c.label, cx, tblY + 5, { width: w - 4, align: c.w < 0.4 ? 'right' : 'left', lineBreak: false });
      cx += w;
    });
    doc.font('Helvetica');
    // Rows
    events.forEach((e, i) => {
      const ry = tblY + 16 + i * 15;
      if (i % 2 === 0) doc.rect(midX + 10, ry, cardW - 20, 15).fill(C.zebra);
      let tx = midX + 14;
      const name = (e.event_name || '').length > 18 ? e.event_name.substring(0, 17) + '\u2026' : (e.event_name || 'Unknown');
      doc.fontSize(8).fillColor(C.navy)
        .text(name, tx, ry + 4, { width: (cardW - 20) * 0.40 - 4, lineBreak: false });
      tx += (cardW - 20) * 0.40;
      doc.text(fmtN(e.gift_count), tx, ry + 4, { width: (cardW - 20) * 0.20 - 4, align: 'right', lineBreak: false });
      tx += (cardW - 20) * 0.20;
      doc.text(fmtCompact(e.revenue), tx, ry + 4, { width: (cardW - 20) * 0.40 - 4, align: 'right', lineBreak: false });
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

  // ── LEFT CARD: KPIs + grouped bar chart by category + Giving Tuesday ──
  let ly = cardY + 16;
  ly = charts.drawKpiBlock(doc, leftX + 14, ly, cardW - 28, 'GOAL', goal > 0 ? fmtD(goal) : '—');
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, 'Total Gifts', fmtD(raised));
  ly = charts.drawKpiBlock(doc, leftX + 14, ly + 4, cardW - 28, '% Goal',
    goalPct !== null ? goalPct + '%' : '—',
    { valueColor: goalPct !== null && goalPct >= 100 ? C.green : (goalPct !== null && goalPct >= 75 ? C.amber : C.red) });

  // Grouped bar — # gifts vs $ raised by top appeal (proxy for "category")
  const appeals = (detail.appeals || []).slice(0, 6);
  const categories = appeals.map(a => (a.appeal_description || 'Unknown').substring(0, 10));
  const series = [
    { name: '# gifts', color: '#3b82f6', values: appeals.map(a => Number(a.gift_count || 0)) },
    { name: 'Total raised', color: '#ef4444', values: appeals.map(a => Number(a.total || 0) / 1000) }, // $K for chart scale
  ];
  if (appeals.length > 0) {
    charts.drawGroupedBar(doc, leftX + 10, ly + 10, cardW - 20, 110, categories, series, {
      fontSize: 6, showLegend: true,
      axisFmt: v => v < 1000 ? Math.round(v) : Math.round(v / 1000) + 'K',
    });
  }

  // Giving Tuesday callout at bottom of left card
  const gtTotal = Number((extras.givingTuesday || {}).total || 0);
  const gtGoal = 30000; // no DB column for this yet — default placeholder
  const gtY = cardY + cardH - 62;
  drawCallout(doc, leftX + 10, gtY, cardW - 20, 52, {
    title: ctx.fy ? 'Giving Tuesday ' + ctx.fy : 'Giving Tuesday',
    leftLabel: 'GOAL', leftValue: fmtD(gtGoal),
    rightLabel: 'RAISED', rightValue: fmtD(gtTotal),
  });

  // ── MIDDLE CARD: Stats + Annual Giving by Category donut ──
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

  // Annual Giving by Category donut
  const catSlices = appeals.slice(0, 6).map(a => ({
    label: a.appeal_description || 'Unknown',
    value: Number(a.total || 0),
  }));
  if (catSlices.length > 0) {
    doc.fontSize(8).fillColor(C.gray).font('Helvetica')
      .text('Annual Giving by Category', midX + 14, my + 4, { width: cardW - 28 });
    const cx = midX + 42;
    const cy = my + 52;
    charts.drawDonut(doc, cx, cy, 28, 14, catSlices);
    charts.drawLegend(doc, midX + 80, my + 24, catSlices.slice(0, 6), {
      fontSize: 6, rowH: 10, swatchSize: 6, width: cardW - 94,
      showValue: false,
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
  const cashCount = Number((channelMap['Cash'] || {}).gift_count || 0)
    + Number((channelMap['Online'] || {}).gift_count || 0)
    + Number((channelMap['Mailed in'] || {}).gift_count || 0)
    + Number((channelMap['Other'] || {}).gift_count || 0);
  const recurringCount = Number((channelMap['Recurring'] || {}).gift_count || 0);
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

  // ── Main right area: Gift by Fund matrix table ──
  const rightX = leftX + leftW + 12;
  const rightW = CW - leftW - 12;
  const rightY = 96;
  const tableH = 260;
  charts.drawCard(doc, rightX, rightY, rightW, tableH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });

  doc.fontSize(11).fillColor(C.navy).font('Helvetica-Bold')
    .text('Gift By Fund', rightX + 14, rightY + 10, { width: rightW - 28 });
  doc.font('Helvetica');

  const funds = (detail.funds || []).slice(0, 10);
  const fundTotal = funds.reduce((s, f) => s + Number(f.total || 0), 0);
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

  const rowH = 16;
  funds.forEach((f, i) => {
    const ry = hdrY + 18 + i * rowH;
    if (i % 2 === 0) doc.rect(rightX + 10, ry, rightW - 20, rowH).fill(C.zebra);
    const pct = fundTotal > 0 ? (Number(f.total) / fundTotal * 100).toFixed(2) : '0.00';
    // We don't have per-fund channel breakdowns — we approximate by applying
    // the overall channel ratio to each fund's gift_count as an indicative estimate.
    const giftsTotal = Math.max(1, Number(f.gift_count || 0));
    const cCash = Number((channelMap['Cash'] || {}).gift_count || 0);
    const cOnline = Number((channelMap['Online'] || {}).gift_count || 0);
    const cMail = Number((channelMap['Mailed in'] || {}).gift_count || 0);
    const cRec = Number((channelMap['Recurring'] || {}).gift_count || 0);
    const cTotal = cCash + cOnline + cMail + cRec;
    const proportion = (sub) => cTotal > 0 ? Math.round(giftsTotal * (sub / cTotal)) : 0;
    const vals = [
      (f.fund_description || 'Unknown').substring(0, 22),
      fmtD(f.total),
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
  if (funds.length === 0) {
    doc.fontSize(9).fillColor(C.gray).font('Helvetica-Oblique')
      .text('No fund-level detail available.', rightX + 14, hdrY + 30, { width: rightW - 28 });
    doc.font('Helvetica');
  }

  // ── Bottom row: Source pie + # Gifts by Source h-bar ──
  const botY = rightY + tableH + 10;
  const botH = PH - botY - 32;
  const botColW = (rightW - 10) / 2;
  charts.drawCard(doc, rightX, botY, botColW, botH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });
  charts.drawCard(doc, rightX + botColW + 10, botY, botColW, botH, { borderColor: '#cbd5e1', borderWidth: 1, radius: 4 });

  // Source of Gifts pie (cash/recurring/online/mailed)
  const srcSlices = channels.map(c => ({ label: c.channel, value: Number(c.gift_count || 0) })).filter(s => s.value > 0);
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('Source of Gifts', rightX + 12, botY + 8, { width: botColW - 24 });
  doc.font('Helvetica');
  if (srcSlices.length > 0) {
    const cx = rightX + 44;
    const cy = botY + botH / 2 + 8;
    charts.drawPieChart(doc, cx, cy, Math.min(36, (botH - 30) / 2.2), srcSlices);
    charts.drawLegend(doc, rightX + 90, botY + 26, srcSlices, {
      fontSize: 7, rowH: 11, swatchSize: 7, width: botColW - 100,
      valueFmt: v => fmtN(v),
    });
  }

  // # Gifts by Source horizontal bar
  doc.fontSize(9).fillColor(C.gray).font('Helvetica-Bold')
    .text('# Gifts by Source', rightX + botColW + 10 + 12, botY + 8, { width: botColW - 24 });
  doc.font('Helvetica');
  charts.drawHBarChart(doc, rightX + botColW + 10 + 12, botY + 26, botColW - 24,
    srcSlices.map(s => ({ label: s.label, value: s.value })), {
      labelW: 80, valueW: 40, rowH: 16, fontSize: 7,
      valueFmt: v => fmtN(v), barColor: C.blue,
    });

  // Narrative note below? We have no right-hand narrative on Direct Response page to match layout.
  // Instead, drop a mini narrative strip if content exists.
  if (narrative && (narrative.highlights || narrative.priorities || narrative.commentary)) {
    // Already tight; leave narrative for now. Future: add a bottom-of-page narrative strip.
  }
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
