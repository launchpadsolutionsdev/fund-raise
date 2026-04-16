'use strict';

const PDFDocument = require('pdfkit');
const { Tenant } = require('../models');
const {
  getCrmOverview, getTopDonors, getTopFunds, getTopCampaigns,
  getGivingPyramid, getDepartmentAnalytics, getFundraiserLeaderboard,
  getDonorRetention,
} = require('./crmDashboardService');

/**
 * Render a branded Board Report PDF for a given period (full FY, quarter, or
 * month). Writes the PDF directly to the response as application/pdf.
 *
 * `period` comes from buildPeriodDescriptor() in src/utils/fiscalPeriods.js
 * and carries { type, fy, dateRange, priorDateRange, label, headerSubtitle,
 * filenameStem, showRetention, ... }.
 */
async function renderBoardReport(res, { tenantId, period }) {
  const fy = period.fy;
  const dateRange = period.dateRange;
  const priorDateRange = period.priorDateRange || null;

  // Fetch all data in parallel
  const batch = [
    getCrmOverview(tenantId, dateRange),
    getTopDonors(tenantId, dateRange, 5),
    getTopFunds(tenantId, dateRange, 5),
    getTopCampaigns(tenantId, dateRange, 5),
    getGivingPyramid(tenantId, dateRange),
    Tenant.findByPk(tenantId),
    getDepartmentAnalytics(tenantId, dateRange),
    getFundraiserLeaderboard(tenantId, dateRange),
  ];
  if (priorDateRange) batch.push(getCrmOverview(tenantId, priorDateRange));
  if (priorDateRange && period.showRetention) batch.push(getDonorRetention(tenantId, fy));
  const results = await Promise.all(batch);
  const overview = results[0];
  const topDonors = results[1].slice(0, 5);
  const topFunds = results[2].slice(0, 5);
  const topCampaigns = results[3].slice(0, 5);
  const pyramid = results[4] || [];
  const tenant = results[5];
  const deptData = results[6] || {};
  const fundraiserData = results[7] || [];
  const priorOverview = priorDateRange ? results[8] : null;
  const retention = (priorDateRange && period.showRetention) ? results[9] : null;
  const departments = (deptData.summary || []).slice(0, 6);
  const topFundraisers = fundraiserData.slice(0, 10);

  // Helpers
  const fmtN = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const fmtD = n => '$' + fmtN(n);
  const fmtCompact = n => {
    const v = Number(n || 0);
    if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
    return '$' + fmtN(v);
  };
  const yoyPct = (cur, prev) => {
    const c = Number(cur), p = Number(prev);
    if (!p) return null;
    return ((c - p) / p * 100).toFixed(1);
  };
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const fyLabel = period.label;
  const orgName = (tenant && tenant.name) ? tenant.name : 'Fund-Raise';

  // Colors
  const navy = '#003B5C';
  const blue = '#0072BB';
  const gold = '#D4A843';
  const gray = '#6b7280';
  const lightGray = '#f3f4f6';
  const green = '#16a34a';
  const red = '#dc2626';
  const white = '#FFFFFF';

  // Create PDF — landscape letter, tight margins
  const doc = new PDFDocument({
    size: 'letter',
    layout: 'landscape',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  const filename = period.filenameStem + '_' + new Date().toISOString().split('T')[0] + '.pdf';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  doc.pipe(res);

  const PW = 792; // page width (letter landscape)
  const PH = 612; // page height
  const M = 28;   // margin
  const CW = PW - M * 2; // content width

  // ════════════════════════════════════════════════════════════════════
  // HEADER BAR (0–44)
  // ════════════════════════════════════════════════════════════════════
  doc.rect(0, 0, PW, 44).fill(navy);
  doc.fontSize(16).fillColor(white).text(orgName, M + 4, 11, { width: 300 });
  doc.fontSize(9).fillColor(gold).text(period.headerSubtitle, M + 4, 30, { width: 300 });
  doc.fontSize(9).fillColor(white).text(fyLabel, PW / 2 - 100, 16, { width: 200, align: 'center' });
  doc.fontSize(7).fillColor('#94a3b8').text('Date Pulled: ' + today, PW - M - 160, 18, { width: 156, align: 'right' });

  // ════════════════════════════════════════════════════════════════════
  // 4 HERO KPI CARDS (y: 52–104)
  // ════════════════════════════════════════════════════════════════════
  const o = overview;
  const cardY = 52;
  const cardH = 52;
  const cardGap = 8;
  const cardW = (CW - cardGap * 3) / 4;

  // When we don't have retention data (quarterly/monthly), show Avg Gift instead
  // so the 4-KPI layout stays consistent across every variant.
  const heroKpis = [
    { label: 'Total Raised', value: fmtCompact(o.total_raised), raw: o.total_raised, priorRaw: priorOverview ? priorOverview.total_raised : null },
    { label: 'Total Gifts', value: fmtN(o.total_gifts), raw: o.total_gifts, priorRaw: priorOverview ? priorOverview.total_gifts : null },
    { label: 'Unique Donors', value: fmtN(o.unique_donors), raw: o.unique_donors, priorRaw: priorOverview ? priorOverview.unique_donors : null },
    retention
      ? { label: 'Retention Rate', value: retention.retention_rate + '%', raw: null, priorRaw: null }
      : { label: 'Avg Gift', value: fmtCompact(o.avg_gift), raw: o.avg_gift, priorRaw: priorOverview ? priorOverview.avg_gift : null },
  ];

  heroKpis.forEach((kpi, i) => {
    const x = M + i * (cardW + cardGap);
    doc.roundedRect(x, cardY, cardW, cardH, 3).fill(lightGray);
    doc.fontSize(18).fillColor(navy).text(kpi.value, x + 8, cardY + 6, { width: cardW - 16 });
    doc.fontSize(7).fillColor(gray).text(kpi.label, x + 8, cardY + 28, { width: cardW - 16 });
    // YoY delta
    if (kpi.priorRaw !== null) {
      const pct = yoyPct(kpi.raw, kpi.priorRaw);
      if (pct !== null) {
        const isUp = Number(pct) >= 0;
        doc.fontSize(7).fillColor(isUp ? green : red)
          .text((isUp ? '+' : '') + pct + '% YoY', x + 8, cardY + 39, { width: cardW - 16 });
      }
    }
    if (i === 3 && retention) {
      const rateNum = Number(retention.retention_rate);
      doc.fontSize(7).fillColor(rateNum >= 50 ? green : red)
        .text(fmtN(retention.retained) + ' retained / ' + fmtN(retention.lapsed) + ' lapsed', x + 8, cardY + 39, { width: cardW - 16 });
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 3-COLUMN TABLES: Donors | Funds | Campaigns (y: 112–290)
  // ════════════════════════════════════════════════════════════════════
  const tblY = 114;
  const tblGap = 12;
  const tblW = (CW - tblGap * 2) / 3;
  const rowH = 15;

  function drawTable(title, items, x, nameKey, valKey) {
    // Title
    doc.fontSize(9).fillColor(navy).text(title, x, tblY, { width: tblW });
    // Header line
    const hdrY = tblY + 14;
    doc.moveTo(x, hdrY).lineTo(x + tblW, hdrY).strokeColor('#d1d5db').lineWidth(0.5).stroke();
    // Column headers
    doc.fontSize(6).fillColor(gray)
      .text('#', x + 2, hdrY + 3, { width: 12 })
      .text('Name', x + 14, hdrY + 3, { width: tblW - 80 })
      .text('Amount', x + tblW - 65, hdrY + 3, { width: 63, align: 'right' });
    const dataStartY = hdrY + 14;
    // Rows
    items.forEach((item, i) => {
      const ry = dataStartY + i * rowH;
      const name = typeof nameKey === 'function' ? nameKey(item) : (item[nameKey] || 'Unknown');
      const val = typeof valKey === 'function' ? valKey(item) : item[valKey];
      const truncName = name.length > 30 ? name.substring(0, 29) + '\u2026' : name;
      // Zebra stripe
      if (i % 2 === 0) doc.rect(x, ry - 1, tblW, rowH).fill('#f9fafb');
      doc.fontSize(8).fillColor(navy)
        .text((i + 1) + '.', x + 2, ry + 1, { width: 12 })
        .text(truncName, x + 14, ry + 1, { width: tblW - 82 })
        .text(val, x + tblW - 66, ry + 1, { width: 64, align: 'right' });
    });
    // Fill empty rows so all columns are same height
    for (let i = items.length; i < 5; i++) {
      const ry = dataStartY + i * rowH;
      if (i % 2 === 0) doc.rect(x, ry - 1, tblW, rowH).fill('#f9fafb');
      doc.fontSize(8).fillColor('#d1d5db').text('\u2014', x + 14, ry + 1, { width: 50 });
    }
    // Bottom line
    const endY = dataStartY + 5 * rowH;
    doc.moveTo(x, endY).lineTo(x + tblW, endY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  }

  // Col 1: Donors
  drawTable('Top 5 Donors', topDonors, M,
    d => ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_name || d.constituent_id || 'Anonymous',
    d => fmtD(d.total_credited || d.total_given || d.total || 0));

  // Col 2: Funds
  drawTable('Top 5 Funds', topFunds, M + tblW + tblGap,
    'fund_description',
    f => fmtD(f.total));

  // Col 3: Campaigns
  drawTable('Top 5 Campaigns', topCampaigns, M + (tblW + tblGap) * 2,
    'campaign_description',
    c => fmtD(c.total));

  // ════════════════════════════════════════════════════════════════════
  // KEY METRICS BAR (y: 210–240) — single horizontal row
  // ════════════════════════════════════════════════════════════════════
  const metricsY = 218;
  doc.rect(M, metricsY, CW, 24).fill(lightGray);
  const mColW = CW / 4;
  const metrics = [
    ['Avg Gift', fmtD(o.avg_gift)],
    ['Largest Gift', fmtD(o.largest_gift)],
    ['Funds', fmtN(o.unique_funds) + ' unique'],
    ['Campaigns', fmtN(o.unique_campaigns) + '  |  Appeals: ' + fmtN(o.unique_appeals)],
  ];
  metrics.forEach(([lbl, val], i) => {
    const mx = M + i * mColW + 10;
    doc.fontSize(6).fillColor(gray).text(lbl, mx, metricsY + 4, { width: mColW - 20 });
    doc.fontSize(8).fillColor(navy).text(val, mx, metricsY + 13, { width: mColW - 20 });
  });

  // ════════════════════════════════════════════════════════════════════
  // RETENTION BAR (y: 250–286) — only if retention data exists
  // ════════════════════════════════════════════════════════════════════
  const retY = 250;
  if (retention) {
    doc.fontSize(9).fillColor(navy).text('Donor Retention', M, retY, { width: 200 });
    const barY = retY + 14;
    const barH = 12;
    const totalDonors = Number(retention.retained) + Number(retention.lapsed) + Number(retention.brand_new) + Number(retention.recovered);
    if (totalDonors > 0) {
      const retW = (Number(retention.retained) / totalDonors) * CW;
      const newW = (Number(retention.brand_new) / totalDonors) * CW;
      const recW = (Number(retention.recovered) / totalDonors) * CW;
      const lapW = (Number(retention.lapsed) / totalDonors) * CW;
      let bx = M;
      if (retW > 0) { doc.rect(bx, barY, retW, barH).fill(green); bx += retW; }
      if (newW > 0) { doc.rect(bx, barY, newW, barH).fill(blue); bx += newW; }
      if (recW > 0) { doc.rect(bx, barY, recW, barH).fill(gold); bx += recW; }
      if (lapW > 0) { doc.rect(bx, barY, lapW, barH).fill(red); }
      // Legend
      const legY = barY + barH + 4;
      doc.fontSize(6);
      let lx = M;
      doc.rect(lx, legY + 1, 6, 6).fill(green);
      doc.fillColor(gray).text('Retained ' + fmtN(retention.retained), lx + 8, legY, { width: 100 }); lx += 90;
      doc.rect(lx, legY + 1, 6, 6).fill(blue);
      doc.fillColor(gray).text('New ' + fmtN(retention.brand_new), lx + 8, legY, { width: 80 }); lx += 65;
      doc.rect(lx, legY + 1, 6, 6).fill(gold);
      doc.fillColor(gray).text('Recovered ' + fmtN(retention.recovered), lx + 8, legY, { width: 100 }); lx += 90;
      doc.rect(lx, legY + 1, 6, 6).fill(red);
      doc.fillColor(gray).text('Lapsed ' + fmtN(retention.lapsed), lx + 8, legY, { width: 80 });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // GIVING PYRAMID — full-width horizontal bars (y: 296–rest)
  // ════════════════════════════════════════════════════════════════════
  const pyrY = retention ? 296 : 258;
  if (pyramid && pyramid.length) {
    doc.fontSize(9).fillColor(navy).text('Giving Pyramid', M, pyrY, { width: 200 });
    const pyrStartY = pyrY + 14;
    doc.moveTo(M, pyrStartY).lineTo(M + CW, pyrStartY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Layout: label (90px) | bar (flexible) | value (60px) | donors (50px)
    const labelW = 80;
    const valW = 55;
    const donorW = 60;
    const barAreaStart = M + labelW;
    const barAreaW = CW - labelW - valW - donorW - 10;
    const maxTotal = Math.max(...pyramid.map(p => Number(p.total || p.band_total || 0)), 1);

    // Column headers
    doc.fontSize(6).fillColor(gray)
      .text('Gift Range', M, pyrStartY + 3, { width: labelW })
      .text('Donors', M + CW - donorW, pyrStartY + 3, { width: donorW, align: 'right' });

    const pyrRowH = pyramid.length <= 7 ? 16 : 13;
    const pyrDataY = pyrStartY + 12;

    // Color gradient for bars (light blue to dark blue)
    const barColors = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'];

    pyramid.forEach((p, i) => {
      const ry = pyrDataY + i * pyrRowH;
      const total = Number(p.total || p.band_total || 0);
      const donors = Number(p.donors || p.donor_count || 0);
      const barW = Math.max(2, (total / maxTotal) * barAreaW);
      const band = p.band || '';

      // Zebra
      if (i % 2 === 0) doc.rect(M, ry - 1, CW, pyrRowH).fill('#fafbfc');

      // Label
      doc.fontSize(7).fillColor(gray).text(band, M + 2, ry + 3, { width: labelW - 6 });
      // Bar
      const barColor = barColors[Math.min(i, barColors.length - 1)];
      doc.rect(barAreaStart, ry + 1, barW, pyrRowH - 5).fill(barColor);
      // Amount inside or next to bar
      doc.fontSize(7).fillColor(navy).text(fmtCompact(total), barAreaStart + barW + 4, ry + 3, { width: valW });
      // Donor count
      doc.fontSize(7).fillColor(gray).text(fmtN(donors), M + CW - donorW, ry + 3, { width: donorW - 4, align: 'right' });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // DEPARTMENT PERFORMANCE — compact strip below pyramid
  // ════════════════════════════════════════════════════════════════════
  const pyrRows = (pyramid && pyramid.length) ? pyramid.length : 0;
  const pyrRowHActual = pyrRows <= 7 ? 16 : 13;
  const deptY = pyrY + 14 + 12 + pyrRows * pyrRowHActual + 8;

  if (departments.length > 0) {
    doc.fontSize(8).fillColor(navy).text('Department Performance', M, deptY, { width: 200 });
    const deptBarY = deptY + 12;
    const deptColW = CW / Math.min(departments.length, 6);
    const deptLabels = {
      annual_giving: 'Annual Giving',
      direct_mail: 'Direct Mail',
      events: 'Events',
      major_gifts: 'Major Gifts',
      legacy_giving: 'Legacy Giving',
      corporate: 'Corporate',
    };
    doc.rect(M, deptBarY, CW, 63).fill(lightGray);
    departments.forEach((d, i) => {
      const dx = M + i * deptColW + 6;
      const label = deptLabels[d.department] || d.department || 'Other';
      doc.fontSize(8).fillColor(gray).text(label, dx, deptBarY + 6, { width: deptColW - 12 });
      doc.fontSize(12).fillColor(navy).text(fmtCompact(d.total_amount), dx, deptBarY + 22, { width: deptColW - 12 });
      doc.fontSize(7).fillColor(gray).text(fmtN(d.gift_count) + ' gifts / ' + fmtN(d.donor_count) + ' donors', dx, deptBarY + 42, { width: deptColW - 12 });
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // PAGE 1 FOOTER
  // ════════════════════════════════════════════════════════════════════
  const footY = PH - 18;
  doc.moveTo(M, footY - 3).lineTo(M + CW, footY - 3).strokeColor(gold).lineWidth(0.6).stroke();
  doc.fontSize(6).fillColor(gray).text(
    'Generated by Fund-Raise  |  ' + today + '  |  Confidential - for board use only',
    M, footY, { width: CW, align: 'center' }
  );

  // ════════════════════════════════════════════════════════════════════
  // PAGE 2 — Top 10 Fundraiser Performance
  // ════════════════════════════════════════════════════════════════════
  if (topFundraisers.length > 0) {
    doc.addPage({ size: 'letter', layout: 'landscape', margins: { top: 0, bottom: 0, left: 0, right: 0 } });

    // Header bar
    doc.rect(0, 0, PW, 38).fill(navy);
    doc.fontSize(14).fillColor(white).text(orgName, M + 4, 9, { width: 300 });
    doc.fontSize(8).fillColor(gold).text('Fundraiser Performance  |  ' + fyLabel, M + 4, 25, { width: 400 });
    doc.fontSize(7).fillColor('#94a3b8').text(today, PW - M - 130, 15, { width: 126, align: 'right' });

    // Top 10 Fundraisers table
    const frY = 54;
    doc.fontSize(11).fillColor(navy).text('Top 10 Fundraiser Performance', M, frY, { width: 400 });
    const frHdrY = frY + 18;
    doc.moveTo(M, frHdrY).lineTo(M + CW, frHdrY).strokeColor('#d1d5db').lineWidth(0.5).stroke();

    // Column layout
    const frCols = {
      rank: { x: M + 4, w: 20 },
      name: { x: M + 28, w: 240 },
      gifts: { x: M + 280, w: 80 },
      donors: { x: M + 370, w: 80 },
      raised: { x: M + 470, w: 120 },
      bar: { x: M + 596, w: CW - 600 },
    };

    // Column headers
    doc.fontSize(7).fillColor(gray)
      .text('#', frCols.rank.x, frHdrY + 4, { width: frCols.rank.w })
      .text('Fundraiser', frCols.name.x, frHdrY + 4, { width: frCols.name.w })
      .text('Gifts', frCols.gifts.x, frHdrY + 4, { width: frCols.gifts.w, align: 'right' })
      .text('Donors', frCols.donors.x, frHdrY + 4, { width: frCols.donors.w, align: 'right' })
      .text('Total Raised', frCols.raised.x, frHdrY + 4, { width: frCols.raised.w, align: 'right' });

    const frDataY = frHdrY + 18;
    const frRowH = 22;
    const maxRaised = Math.max(...topFundraisers.map(f => Number(f.total_credited || f.total_gift_amount || 0)), 1);

    topFundraisers.forEach((f, i) => {
      const ry = frDataY + i * frRowH;
      const name = ((f.fundraiser_first_name || '') + ' ' + (f.fundraiser_last_name || '')).trim() || f.fundraiser_name || 'Unknown';
      const truncName = name.length > 35 ? name.substring(0, 34) + '...' : name;
      const raised = Number(f.total_credited || f.total_gift_amount || 0);
      const barW = Math.max(2, (raised / maxRaised) * frCols.bar.w);

      // Zebra stripe
      if (i % 2 === 0) doc.rect(M, ry - 2, CW, frRowH).fill('#f9fafb');

      doc.fontSize(9).fillColor(navy)
        .text((i + 1) + '.', frCols.rank.x, ry + 3, { width: frCols.rank.w })
        .text(truncName, frCols.name.x, ry + 3, { width: frCols.name.w });
      doc.fontSize(9).fillColor(gray)
        .text(fmtN(f.gift_count), frCols.gifts.x, ry + 3, { width: frCols.gifts.w, align: 'right' })
        .text(fmtN(f.donor_count), frCols.donors.x, ry + 3, { width: frCols.donors.w, align: 'right' });
      doc.fontSize(9).fillColor(navy)
        .text(fmtD(raised), frCols.raised.x, ry + 3, { width: frCols.raised.w, align: 'right' });

      // Mini bar chart
      const barColor = i < 3 ? blue : '#93c5fd';
      doc.rect(frCols.bar.x, ry + 2, barW, frRowH - 7).fill(barColor);
    });

    // Bottom line
    const frEndY = frDataY + topFundraisers.length * frRowH;
    doc.moveTo(M, frEndY).lineTo(M + CW, frEndY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // Page 2 footer
    const foot2Y = PH - 18;
    doc.moveTo(M, foot2Y - 3).lineTo(M + CW, foot2Y - 3).strokeColor(gold).lineWidth(0.6).stroke();
    doc.fontSize(6).fillColor(gray).text(
      'Generated by Fund-Raise  |  ' + today + '  |  Confidential - for board use only  |  Page 2',
      M, foot2Y, { width: CW, align: 'center' }
    );
  }

  doc.end();
}

module.exports = { renderBoardReport };
