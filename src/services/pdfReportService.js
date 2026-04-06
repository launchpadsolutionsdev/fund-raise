'use strict';

const PDFDocument = require('pdfkit');

// ── Brand Colors ──
const C = {
  navy: '#003B5C',
  blue: '#0072BB',
  gold: '#D4A843',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
  green: '#16a34a',
  red: '#dc2626',
  orange: '#d97706',
  white: '#FFFFFF',
};

const PAGE_W = 612; // letter width
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Formatting helpers ──
function fmtN(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function fmtD(n) { return '$' + fmtN(n); }
function fmtPct(n) { return Number(n || 0).toFixed(1) + '%'; }
function today() { return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
function fyLabel(fy) { return fy ? 'FY' + fy + ' (Apr ' + (fy - 1) + ' – Mar ' + fy + ')' : 'All Time'; }

// ── Create a new document ──
function createDoc() {
  return new PDFDocument({ size: 'letter', margins: { top: 50, bottom: 50, left: 50, right: 50 }, bufferPages: true });
}

// ── Title Page ──
function titlePage(doc, reportName, fy, subtitle) {
  doc.fontSize(28).fillColor(C.navy).text('Fund-Raise', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(20).fillColor(C.blue).text(reportName, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor(C.gray).text(fyLabel(fy), { align: 'center' });
  if (subtitle) {
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(C.gray).text(subtitle, { align: 'center' });
  }
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor(C.gray).text('Generated ' + today(), { align: 'center' });
  doc.moveDown(1);
  divider(doc, C.gold, 2);
  doc.moveDown(1);
}

// ── Section heading ──
function sectionHeading(doc, text, opts = {}) {
  const size = opts.size || 16;
  doc.fontSize(size).fillColor(C.navy).text(text);
  doc.moveDown(0.5);
}

// ── Sub-heading ──
function subHeading(doc, text) {
  doc.fontSize(12).fillColor(C.blue).text(text);
  doc.moveDown(0.3);
}

// ── Paragraph ──
function paragraph(doc, text) {
  doc.fontSize(9).fillColor(C.gray).text(text, { lineGap: 2 });
  doc.moveDown(0.4);
}

// ── Divider ──
function divider(doc, color, width) {
  doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
    .strokeColor(color || C.lightGray).lineWidth(width || 0.5).stroke();
  doc.moveDown(0.3);
}

// ── KPI Grid — 2-column layout ──
function kpiGrid(doc, items, opts = {}) {
  const colW = opts.colWidth || 245;
  const startX = MARGIN + 5;
  items.forEach((kpi, i) => {
    const col = i % 2;
    const x = startX + col * colW;
    if (col === 0 && i > 0) doc.moveDown(0.1);
    const y = doc.y;
    doc.fontSize(9).fillColor(C.gray).text(kpi[0], x, y, { width: 130 });
    doc.fontSize(12).fillColor(kpi[2] || C.navy).text(kpi[1], x + 130, y, { width: 110, align: 'right' });
    if (col === 1) doc.moveDown(0.3);
  });
  // If odd number, add spacing after last item
  if (items.length % 2 === 1) doc.moveDown(0.5);
}

// ── KPI Row — single horizontal line of KPIs ──
function kpiRow(doc, items) {
  const w = Math.floor(CONTENT_W / items.length);
  const y = doc.y;
  items.forEach((kpi, i) => {
    const x = MARGIN + i * w;
    doc.fontSize(8).fillColor(C.gray).text(kpi[0], x, y, { width: w, align: 'center' });
    doc.fontSize(14).fillColor(kpi[2] || C.navy).text(kpi[1], x, y + 12, { width: w, align: 'center' });
  });
  doc.y = y + 32;
  doc.moveDown(0.5);
}

// ── Ensure space — adds a new page if not enough room ──
function ensureSpace(doc, needed) {
  if (doc.y + needed > 700) {
    doc.addPage();
    return true;
  }
  return false;
}

// ── Table ──
// columns: [{ label, width, align }]
// rows: [[val, val, ...], ...]
function table(doc, columns, rows, opts = {}) {
  const tableX = MARGIN + 5;
  const maxRows = opts.maxRows || rows.length;
  const stripe = opts.stripe !== false;

  // Header
  let hx = tableX;
  doc.fontSize(8).fillColor(C.gray);
  const headerY = doc.y;
  columns.forEach(col => {
    doc.text(col.label, hx, headerY, { width: col.width, align: col.align || 'left' });
    hx += col.width;
  });
  doc.y = headerY + 12;
  divider(doc, C.lightGray, 0.5);

  // Rows
  const displayRows = rows.slice(0, maxRows);
  displayRows.forEach((row, ri) => {
    ensureSpace(doc, 16);

    // Stripe background
    if (stripe && ri % 2 === 1) {
      doc.save();
      doc.rect(MARGIN, doc.y - 2, CONTENT_W, 14).fill('#f9fafb');
      doc.restore();
    }

    let rx = tableX;
    const rowY = doc.y;
    row.forEach((val, ci) => {
      const col = columns[ci];
      const color = (typeof val === 'object' && val !== null) ? val.color : C.navy;
      const text = (typeof val === 'object' && val !== null) ? val.text : String(val != null ? val : '');
      doc.fontSize(9).fillColor(color);
      doc.text(text, rx, rowY, { width: col.width, align: col.align || 'left' });
      rx += col.width;
    });
    doc.y = rowY + 14;
  });
  doc.moveDown(0.3);
}

// ── YoY comparison row ──
function yoyRow(doc, label, current, prior, isDollar) {
  const fmt = isDollar ? fmtD : fmtN;
  const curN = Number(current), prevN = Number(prior);
  const pct = prevN > 0 ? ((curN - prevN) / prevN * 100).toFixed(1) : 'N/A';
  const isUp = curN >= prevN;
  doc.fontSize(9).fillColor(C.gray).text(label, MARGIN + 5, doc.y, { continued: true, width: 110 });
  doc.fillColor(C.navy).text('  ' + fmt(current), { continued: true });
  doc.fillColor(C.gray).text('  vs ' + fmt(prior), { continued: true });
  if (pct !== 'N/A') {
    doc.fillColor(isUp ? C.green : C.red).text('  (' + (isUp ? '+' : '') + pct + '%)', { continued: false });
  } else {
    doc.fillColor(C.gray).text('  (N/A)', { continued: false });
  }
  doc.moveDown(0.15);
}

// ── Footer on every page ──
function addFooters(doc, reportName, fy) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.fontSize(7).fillColor(C.gray);
    const footerY = 730;
    doc.moveTo(MARGIN, footerY).lineTo(PAGE_W - MARGIN, footerY).strokeColor(C.gold).lineWidth(0.5).stroke();
    doc.text('Fund-Raise  |  ' + reportName + '  |  ' + fyLabel(fy) + '  |  ' + today() + '  |  Confidential',
      MARGIN, footerY + 6, { width: CONTENT_W, align: 'center' });
    doc.text('Page ' + (i - range.start + 1) + ' of ' + range.count,
      MARGIN, footerY + 6, { width: CONTENT_W, align: 'right' });
    doc.restore();
  }
}

// ── Stream PDF to response ──
function streamPdf(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);
}

module.exports = {
  C, MARGIN, CONTENT_W,
  fmtN, fmtD, fmtPct, today, fyLabel,
  createDoc, titlePage, sectionHeading, subHeading, paragraph, divider,
  kpiGrid, kpiRow, ensureSpace, table, yoyRow, addFooters, streamPdf,
};
