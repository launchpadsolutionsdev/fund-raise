'use strict';

const pdf = require('./pdfReportService');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Executive Summary
// ─────────────────────────────────────────────────────────────────────────────
function generateExecutiveSummary(res, fy, { overview, priorOverview, topDonors, topFunds, topCampaigns, pyramid, retention }) {
  const doc = pdf.createDoc();
  const name = 'Executive Summary';
  pdf.streamPdf(res, doc, `Executive_Summary_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  // KPI grid
  const o = overview || {};
  pdf.sectionHeading(doc, 'Key Performance Indicators');
  pdf.kpiGrid(doc, [
    ['Total Raised', pdf.fmtD(o.total_raised || o.totalRaised || 0)],
    ['Total Gifts', pdf.fmtN(o.total_gifts || o.totalGifts || 0)],
    ['Unique Donors', pdf.fmtN(o.unique_donors || o.uniqueDonors || 0)],
    ['Average Gift', pdf.fmtD(o.avg_gift || o.avgGift || 0)],
    ['Largest Gift', pdf.fmtD(o.largest_gift || o.largestGift || 0)],
    ['Unique Funds', pdf.fmtN(o.unique_funds || o.uniqueFunds || 0)],
    ['Campaigns', pdf.fmtN(o.campaigns || o.campaign_count || 0)],
    ['Appeals', pdf.fmtN(o.appeals || o.appeal_count || 0)],
  ]);

  // YoY comparison
  if (priorOverview) {
    pdf.ensureSpace(doc, 100);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Year-over-Year Comparison');
    const p = priorOverview;
    pdf.yoyRow(doc, 'Total Raised', o.total_raised || o.totalRaised || 0, p.total_raised || p.totalRaised || 0, true);
    pdf.yoyRow(doc, 'Unique Donors', o.unique_donors || o.uniqueDonors || 0, p.unique_donors || p.uniqueDonors || 0, false);
    pdf.yoyRow(doc, 'Avg Gift', o.avg_gift || o.avgGift || 0, p.avg_gift || p.avgGift || 0, true);
    doc.moveDown(0.5);
  }

  // Retention section
  if (retention) {
    pdf.ensureSpace(doc, 100);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Donor Retention');
    const rateColor = Number(retention.retention_rate || 0) >= 50 ? pdf.C.green : pdf.C.red;
    pdf.kpiGrid(doc, [
      ['Retention Rate', pdf.fmtPct(retention.retention_rate), rateColor],
      ['Retained', pdf.fmtN(retention.retained)],
      ['Lapsed', pdf.fmtN(retention.lapsed)],
      ['New', pdf.fmtN(retention.brand_new)],
      ['Recovered', pdf.fmtN(retention.recovered)],
    ]);
  }

  // Top 10 Donors
  doc.addPage();
  pdf.sectionHeading(doc, 'Top 10 Donors');
  if (topDonors && topDonors.length) {
    const cols = [
      { label: '#', width: 30, align: 'right' },
      { label: 'Donor', width: 250 },
      { label: 'Total', width: 110, align: 'right' },
      { label: 'Gifts', width: 80, align: 'right' },
    ];
    const rows = topDonors.slice(0, 10).map((d, i) => {
      const dName = d.constituent_name || ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_id || 'Unknown';
      const total = d.total_credited || d.total_given || d.total || 0;
      return [i + 1, dName, pdf.fmtD(total), pdf.fmtN(d.gift_count || 0)];
    });
    pdf.table(doc, cols, rows);
  }

  // Top 10 Funds
  pdf.ensureSpace(doc, 80);
  pdf.sectionHeading(doc, 'Top 10 Funds');
  if (topFunds && topFunds.length) {
    const cols = [
      { label: '#', width: 30, align: 'right' },
      { label: 'Fund', width: 250 },
      { label: 'Total', width: 110, align: 'right' },
      { label: 'Gifts', width: 80, align: 'right' },
    ];
    const rows = topFunds.slice(0, 10).map((f, i) => [
      i + 1,
      f.fund_description || 'Unknown',
      pdf.fmtD(f.total || f.total_raised || 0),
      pdf.fmtN(f.gift_count || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Top 10 Campaigns
  pdf.ensureSpace(doc, 80);
  pdf.sectionHeading(doc, 'Top 10 Campaigns');
  if (topCampaigns && topCampaigns.length) {
    const cols = [
      { label: '#', width: 30, align: 'right' },
      { label: 'Campaign', width: 250 },
      { label: 'Total', width: 110, align: 'right' },
      { label: 'Gifts', width: 80, align: 'right' },
    ];
    const rows = topCampaigns.slice(0, 10).map((c, i) => [
      i + 1,
      c.campaign_description || 'Unknown',
      pdf.fmtD(c.total || c.total_raised || 0),
      pdf.fmtN(c.gift_count || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Giving Pyramid
  if (pyramid && pyramid.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Giving Pyramid');
    const cols = [
      { label: 'Gift Range', width: 150 },
      { label: 'Donors', width: 100, align: 'right' },
      { label: 'Total', width: 130, align: 'right' },
      { label: 'Avg Gift', width: 100, align: 'right' },
    ];
    const rows = pyramid.map(p => [
      p.band || '',
      pdf.fmtN(p.donors),
      pdf.fmtD(p.total),
      pdf.fmtD(p.avg_gift),
    ]);
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Retention Report
// ─────────────────────────────────────────────────────────────────────────────
function generateRetentionReport(res, fy, { retention, drilldown }) {
  const doc = pdf.createDoc();
  const name = 'Donor Retention Report';
  pdf.streamPdf(res, doc, `Retention_Report_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  // Overall KPIs
  const r = retention || {};
  const rateColor = Number(r.retention_rate || 0) >= 50 ? pdf.C.green : pdf.C.red;
  pdf.sectionHeading(doc, 'Retention Overview');
  pdf.kpiGrid(doc, [
    ['Retention Rate', pdf.fmtPct(r.retention_rate), rateColor],
    ['Prior Year Donors', pdf.fmtN(r.prior_donors)],
    ['Current Year Donors', pdf.fmtN(r.current_donors)],
    ['Retained', pdf.fmtN(r.retained)],
    ['Lapsed', pdf.fmtN(r.lapsed)],
    ['New', pdf.fmtN(r.brand_new)],
    ['Recovered', pdf.fmtN(r.recovered)],
  ]);

  if (drilldown) {
    // Retention Trend
    if (drilldown.retentionTrend && drilldown.retentionTrend.length) {
      pdf.ensureSpace(doc, 80);
      pdf.divider(doc);
      pdf.sectionHeading(doc, 'Retention Trend');
      const cols = [
        { label: 'FY', width: 80 },
        { label: 'Prior Donors', width: 130, align: 'right' },
        { label: 'Retained', width: 130, align: 'right' },
        { label: 'Rate', width: 130, align: 'right' },
      ];
      const rows = drilldown.retentionTrend.map(t => [
        t.fiscal_year || t.fy || '',
        pdf.fmtN(t.prior_donors),
        pdf.fmtN(t.retained),
        pdf.fmtPct(t.retention_rate || t.rate),
      ]);
      pdf.table(doc, cols, rows);
    }

    // By Giving Band
    if (drilldown.byGivingBand && drilldown.byGivingBand.length) {
      pdf.ensureSpace(doc, 80);
      pdf.divider(doc);
      pdf.sectionHeading(doc, 'Retention by Giving Band');
      const cols = [
        { label: 'Band', width: 150 },
        { label: 'Prior Donors', width: 110, align: 'right' },
        { label: 'Retained', width: 110, align: 'right' },
        { label: 'Rate', width: 100, align: 'right' },
      ];
      const rows = drilldown.byGivingBand.map(b => [
        b.band || b.giving_band || '',
        pdf.fmtN(b.prior_donors),
        pdf.fmtN(b.retained),
        pdf.fmtPct(b.retention_rate || b.rate),
      ]);
      pdf.table(doc, cols, rows);
    }

    // By Department
    if (drilldown.byDepartment && drilldown.byDepartment.length) {
      pdf.ensureSpace(doc, 80);
      pdf.divider(doc);
      pdf.sectionHeading(doc, 'Retention by Department');
      const cols = [
        { label: 'Department', width: 180 },
        { label: 'Prior Donors', width: 100, align: 'right' },
        { label: 'Retained', width: 100, align: 'right' },
        { label: 'Rate', width: 90, align: 'right' },
      ];
      const rows = drilldown.byDepartment.slice(0, 15).map(d => [
        d.department || '',
        pdf.fmtN(d.prior_donors),
        pdf.fmtN(d.retained),
        pdf.fmtPct(d.retention_rate || d.rate),
      ]);
      pdf.table(doc, cols, rows);
    }

    // By Fund
    if (drilldown.byFund && drilldown.byFund.length) {
      pdf.ensureSpace(doc, 80);
      pdf.divider(doc);
      pdf.sectionHeading(doc, 'Retention by Fund');
      const cols = [
        { label: 'Fund', width: 180 },
        { label: 'Prior Donors', width: 100, align: 'right' },
        { label: 'Retained', width: 100, align: 'right' },
        { label: 'Rate', width: 90, align: 'right' },
      ];
      const rows = drilldown.byFund.slice(0, 15).map(f => [
        f.fund_description || f.fund || '',
        pdf.fmtN(f.prior_donors),
        pdf.fmtN(f.retained),
        pdf.fmtPct(f.retention_rate || f.rate),
      ]);
      pdf.table(doc, cols, rows);
    }
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Scoring Report (RFM)
// ─────────────────────────────────────────────────────────────────────────────
function generateScoringReport(res, fy, { segments, donors }) {
  const doc = pdf.createDoc();
  const name = 'Donor Scoring & Segmentation (RFM)';
  pdf.streamPdf(res, doc, `Scoring_Report_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  pdf.paragraph(doc,
    'RFM scoring evaluates donors across three dimensions: Recency (how recently they gave), ' +
    'Frequency (how often they give), and Monetary value (how much they give). Each dimension is ' +
    'scored 1-5, producing a composite score used to segment donors into actionable categories.'
  );

  // Segment Summary
  if (segments) {
    pdf.ensureSpace(doc, 80);
    pdf.sectionHeading(doc, 'Segment Summary');
    const segmentOrder = [
      'Champion', 'Major Gift Prospect', 'Loyal & Active', 'At Risk - High Value',
      'At Risk - Frequent', 'New / Promising', 'Upgrade Candidate', 'Core Donor', 'Lapsed',
    ];
    const cols = [
      { label: 'Segment', width: 220 },
      { label: 'Donors', width: 120, align: 'right' },
      { label: 'Total Given', width: 140, align: 'right' },
    ];
    const rows = [];
    segmentOrder.forEach(seg => {
      if (segments[seg]) {
        const s = segments[seg];
        rows.push([seg, pdf.fmtN(s.count || s.donors || 0), pdf.fmtD(s.total || s.total_given || 0)]);
      }
    });
    // Include any segments not in the predefined order
    Object.keys(segments).forEach(seg => {
      if (!segmentOrder.includes(seg)) {
        const s = segments[seg];
        rows.push([seg, pdf.fmtN(s.count || s.donors || 0), pdf.fmtD(s.total || s.total_given || 0)]);
      }
    });
    if (rows.length) pdf.table(doc, cols, rows);
  }

  // Top Donors
  if (donors && donors.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Top Donors by RFM Score');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Donor', width: 140 },
      { label: 'Segment', width: 105 },
      { label: 'R', width: 25, align: 'center' },
      { label: 'F', width: 25, align: 'center' },
      { label: 'M', width: 25, align: 'center' },
      { label: 'Score', width: 45, align: 'right' },
      { label: 'Total Given', width: 90, align: 'right' },
    ];
    const rows = donors.slice(0, 50).map((d, i) => {
      const dName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_id || 'Unknown';
      return [
        i + 1, dName, d.segment || '',
        String(d.r || d.recency || ''), String(d.f || d.frequency || ''), String(d.m || d.monetary || ''),
        String(d.score || d.rfm_score || ''),
        pdf.fmtD(d.total_given || d.total || 0),
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Recurring Report
// ─────────────────────────────────────────────────────────────────────────────
function generateRecurringReport(res, fy, { patterns, donors }) {
  const doc = pdf.createDoc();
  const name = 'Recurring Donor Analysis';
  pdf.streamPdf(res, doc, `Recurring_Report_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  pdf.paragraph(doc,
    'This report identifies donors with recurring giving patterns based on gift frequency, ' +
    'consistency, and timing. Patterns include Monthly, Annual Faithful, Multi-Year, Frequent ' +
    '(Single Year), and Occasional donors.'
  );

  // Pattern Summary
  if (patterns && patterns.length) {
    pdf.ensureSpace(doc, 80);
    pdf.sectionHeading(doc, 'Pattern Summary');
    const patternOrder = ['Monthly', 'Annual Faithful', 'Multi-Year', 'Frequent (Single Year)', 'Occasional'];
    const cols = [
      { label: 'Pattern', width: 200 },
      { label: 'Donors', width: 130, align: 'right' },
      { label: 'Total Given', width: 150, align: 'right' },
    ];
    const ordered = [];
    patternOrder.forEach(p => {
      const found = patterns.find(pt => pt.pattern === p);
      if (found) ordered.push(found);
    });
    // Add any remaining patterns
    patterns.forEach(pt => {
      if (!patternOrder.includes(pt.pattern)) ordered.push(pt);
    });
    const rows = ordered.map(p => [
      p.pattern || '',
      pdf.fmtN(p.donors || p.donor_count || 0),
      pdf.fmtD(p.total || p.total_given || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Top Recurring Donors
  if (donors && donors.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Top Recurring Donors');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Donor', width: 130 },
      { label: 'Pattern', width: 95 },
      { label: 'Total Given', width: 75, align: 'right' },
      { label: 'Gifts', width: 45, align: 'right' },
      { label: 'Active Mo.', width: 60, align: 'right' },
      { label: 'Avg Days', width: 60, align: 'right' },
    ];
    const rows = donors.slice(0, 50).map((d, i) => {
      const dName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_id || 'Unknown';
      return [
        i + 1, dName, d.pattern || '',
        pdf.fmtD(d.total_given || d.total || 0),
        pdf.fmtN(d.gift_count || d.gifts || 0),
        pdf.fmtN(d.active_months || 0),
        pdf.fmtN(d.avg_days_between || 0),
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. LYBUNT / SYBUNT Report
// ─────────────────────────────────────────────────────────────────────────────
function generateLybuntReport(res, fy, { lybunt, sybunt, totalAtRisk, totalRevenueAtRisk, bands, topDonors, currentFY, priorFY }) {
  const doc = pdf.createDoc();
  const name = 'LYBUNT / SYBUNT Report';
  pdf.streamPdf(res, doc, `LYBUNT_SYBUNT_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  pdf.paragraph(doc,
    'LYBUNT (Last Year But Unfortunately Not This) identifies donors who gave last year but ' +
    'not yet this year. SYBUNT (Some Year But Unfortunately Not This) identifies donors who gave ' +
    'in a prior year (but not last year) and have not yet given this year. Both groups represent ' +
    'at-risk revenue that can be recovered through targeted outreach.'
  );

  const ly = lybunt || {};
  const sy = sybunt || {};

  // KPI row
  pdf.ensureSpace(doc, 80);
  pdf.kpiRow(doc, [
    ['LYBUNT Donors', pdf.fmtN(ly.donorCount || ly.donor_count || 0)],
    ['SYBUNT Donors', pdf.fmtN(sy.donorCount || sy.donor_count || 0)],
    ['Total At Risk', pdf.fmtN(totalAtRisk || 0)],
    ['Revenue At Risk', pdf.fmtD(totalRevenueAtRisk || 0), pdf.C.red],
  ]);

  // KPI grid
  pdf.ensureSpace(doc, 80);
  pdf.kpiGrid(doc, [
    ['LYBUNT Revenue at Risk', pdf.fmtD(ly.totalRevenue || ly.total_revenue || 0), pdf.C.red],
    ['LYBUNT Avg Gift', pdf.fmtD(ly.avgGift || ly.avg_gift || 0)],
    ['SYBUNT Revenue at Risk', pdf.fmtD(sy.totalRevenue || sy.total_revenue || 0), pdf.C.red],
    ['SYBUNT Avg Gift', pdf.fmtD(sy.avgGift || sy.avg_gift || 0)],
  ]);

  // Giving Band Distribution
  if (bands && bands.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Giving Band Distribution');
    const cols = [
      { label: 'Category', width: 100 },
      { label: 'Band', width: 150 },
      { label: 'Donors', width: 110, align: 'right' },
      { label: 'Total', width: 120, align: 'right' },
    ];
    const rows = bands.map(b => [
      b.category || '',
      b.band || b.giving_band || '',
      pdf.fmtN(b.donors || b.donor_count || 0),
      pdf.fmtD(b.total || b.total_given || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Top At-Risk Donors
  if (topDonors && topDonors.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Top At-Risk Donors');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Donor', width: 120 },
      { label: 'Category', width: 65 },
      { label: 'Last Yr Giving', width: 80, align: 'right' },
      { label: 'Lifetime', width: 80, align: 'right' },
      { label: 'Last Gift', width: 110, align: 'right' },
    ];
    const rows = topDonors.slice(0, 50).map((d, i) => [
      i + 1,
      d.donor_name || d.constituent_id || 'Unknown',
      d.category || '',
      pdf.fmtD(d.last_year_giving || d.prior_giving || 0),
      pdf.fmtD(d.lifetime_giving || d.lifetime_total || 0),
      d.last_gift_date || d.last_gift || '',
    ]);
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Gift Trends Report
// ─────────────────────────────────────────────────────────────────────────────
function generateGiftTrendsReport(res, fy, { monthlyTrend, distribution, yoyAvg, donorTrends, increasing, decreasing }) {
  const doc = pdf.createDoc();
  const name = 'Gift Trend Analysis';
  pdf.streamPdf(res, doc, `Gift_Trends_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  // KPI row
  pdf.kpiRow(doc, [
    ['Donors Increasing', pdf.fmtN(increasing || 0), pdf.C.green],
    ['Donors Decreasing', pdf.fmtN(decreasing || 0), pdf.C.red],
  ]);

  // Monthly Giving Trend
  if (monthlyTrend && monthlyTrend.length) {
    pdf.ensureSpace(doc, 80);
    pdf.sectionHeading(doc, 'Monthly Giving Trend');
    const cols = [
      { label: 'Month', width: 120 },
      { label: 'Gifts', width: 100, align: 'right' },
      { label: 'Total', width: 130, align: 'right' },
      { label: 'Average Gift', width: 120, align: 'right' },
    ];
    const rows = monthlyTrend.slice(0, 24).map(m => [
      m.month || m.gift_month || '',
      pdf.fmtN(m.gifts || m.gift_count || 0),
      pdf.fmtD(m.total || m.total_amount || 0),
      pdf.fmtD(m.avg_gift || m.average_gift || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Gift Size Distribution
  if (distribution && distribution.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Gift Size Distribution');
    const cols = [
      { label: 'Gift Range', width: 200 },
      { label: 'Gifts', width: 130, align: 'right' },
      { label: 'Total', width: 150, align: 'right' },
    ];
    const rows = distribution.map(d => [
      d.range || d.gift_range || d.band || '',
      pdf.fmtN(d.gifts || d.gift_count || 0),
      pdf.fmtD(d.total || d.total_amount || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // YoY Average Gift
  if (yoyAvg && yoyAvg.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'YoY Average Gift');
    const cols = [
      { label: 'FY', width: 80 },
      { label: 'Avg Gift', width: 140, align: 'right' },
      { label: 'Gifts', width: 130, align: 'right' },
      { label: 'Total', width: 130, align: 'right' },
    ];
    const rows = yoyAvg.map(y => [
      y.fiscal_year || y.fy || '',
      pdf.fmtD(y.avg_gift || y.average_gift || 0),
      pdf.fmtN(y.gifts || y.gift_count || 0),
      pdf.fmtD(y.total || y.total_amount || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // Donor Trends
  if (donorTrends && donorTrends.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Donor Trends');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Donor', width: 130 },
      { label: 'Trend', width: 80 },
      { label: 'Current Avg', width: 80, align: 'right' },
      { label: 'Prior Avg', width: 80, align: 'right' },
      { label: 'Change %', width: 80, align: 'right' },
    ];
    const rows = donorTrends.slice(0, 50).map((d, i) => {
      const dName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_id || 'Unknown';
      const trend = d.trend || '';
      const trendColor = trend === 'Increasing' ? pdf.C.green : trend === 'Decreasing' ? pdf.C.red : pdf.C.navy;
      const changeColor = Number(d.change_pct || 0) >= 0 ? pdf.C.green : pdf.C.red;
      return [
        i + 1, dName,
        { text: trend, color: trendColor },
        pdf.fmtD(d.current_avg || 0),
        pdf.fmtD(d.prior_avg || 0),
        { text: pdf.fmtPct(d.change_pct || 0), color: changeColor },
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Campaign Report
// ─────────────────────────────────────────────────────────────────────────────
function generateCampaignReport(res, fy, { campaigns }) {
  const doc = pdf.createDoc();
  const name = 'Campaign Performance Report';
  pdf.streamPdf(res, doc, `Campaign_Report_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  const campArr = campaigns || [];
  pdf.kpiRow(doc, [
    ['Total Campaigns', pdf.fmtN(campArr.length)],
  ]);

  // Campaign Performance table
  if (campArr.length) {
    pdf.ensureSpace(doc, 80);
    pdf.sectionHeading(doc, 'Campaign Performance');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Campaign', width: 160 },
      { label: 'Total Raised', width: 80, align: 'right' },
      { label: 'Donors', width: 55, align: 'right' },
      { label: 'Gifts', width: 50, align: 'right' },
      { label: 'Avg Gift', width: 70, align: 'right' },
      { label: 'Score', width: 45, align: 'right' },
    ];
    const rows = campArr.map((c, i) => [
      i + 1,
      c.campaign_description || 'Unknown',
      pdf.fmtD(c.total_raised || c.total || 0),
      pdf.fmtN(c.donors || c.donor_count || 0),
      pdf.fmtN(c.gifts || c.gift_count || 0),
      pdf.fmtD(c.avg_gift || 0),
      String(c.effectiveness_score != null ? c.effectiveness_score : ''),
    ]);
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Fund Health Report
// ─────────────────────────────────────────────────────────────────────────────
function generateFundHealthReport(res, fy, { funds, grandTotal, dependency, fundGrowth, trendingUp, trendingDown }) {
  const doc = pdf.createDoc();
  const name = 'Fund Health Report';
  pdf.streamPdf(res, doc, `Fund_Health_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  const dep = dependency || {};
  pdf.sectionHeading(doc, 'Overview');
  pdf.kpiGrid(doc, [
    ['Total Raised', pdf.fmtD(grandTotal || 0)],
    ['Total Funds', pdf.fmtN((funds || []).length)],
    ['Top Fund Concentration', (dep.topFundPct || 0) + '%'],
    ['Top 3 Concentration', (dep.top3FundPct || 0) + '%'],
  ]);

  // Fund Performance
  if (funds && funds.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Fund Performance');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Fund', width: 185 },
      { label: 'Total', width: 85, align: 'right' },
      { label: 'Donors', width: 60, align: 'right' },
      { label: 'Gifts', width: 55, align: 'right' },
      { label: '% of Total', width: 70, align: 'right' },
    ];
    const rows = funds.slice(0, 30).map((f, i) => [
      i + 1,
      f.fund_description || 'Unknown',
      pdf.fmtD(f.total || f.total_raised || 0),
      pdf.fmtN(f.donors || f.donor_count || 0),
      pdf.fmtN(f.gifts || f.gift_count || 0),
      (f.pct_of_total || 0) + '%',
    ]);
    pdf.table(doc, cols, rows);
  }

  // Fund Growth YoY
  if (fundGrowth && fundGrowth.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Fund Growth YoY');
    const cols = [
      { label: 'Fund', width: 200 },
      { label: 'Current', width: 95, align: 'right' },
      { label: 'Prior', width: 95, align: 'right' },
      { label: 'Growth %', width: 90, align: 'right' },
    ];
    const rows = fundGrowth.map(f => {
      const growth = Number(f.growth_pct || f.growth || 0);
      const growthColor = growth >= 0 ? pdf.C.green : pdf.C.red;
      return [
        f.fund_description || f.fund || 'Unknown',
        pdf.fmtD(f.current || f.current_total || 0),
        pdf.fmtD(f.prior || f.prior_total || 0),
        { text: growth.toFixed(1) + '%', color: growthColor },
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Lifecycle Report
// ─────────────────────────────────────────────────────────────────────────────
function generateLifecycleReport(res, fy, { stages, atRiskDonors }) {
  const doc = pdf.createDoc();
  const name = 'Donor Lifecycle Report';
  pdf.streamPdf(res, doc, `Lifecycle_Report_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  // Lifecycle Stages
  if (stages && stages.length) {
    pdf.sectionHeading(doc, 'Lifecycle Stages');
    const cols = [
      { label: 'Stage', width: 220 },
      { label: 'Donors', width: 130, align: 'right' },
      { label: 'Total Giving', width: 140, align: 'right' },
    ];
    const rows = stages.map(s => [
      s.stage || s.lifecycle_stage || '',
      pdf.fmtN(s.donors || s.donor_count || 0),
      pdf.fmtD(s.total || s.total_giving || 0),
    ]);
    pdf.table(doc, cols, rows);
  }

  // At-Risk Donors
  if (atRiskDonors && atRiskDonors.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'At-Risk Donors');
    const cols = [
      { label: '#', width: 22, align: 'right' },
      { label: 'Donor', width: 100 },
      { label: 'Risk Type', width: 68 },
      { label: 'Lifetime', width: 65, align: 'right' },
      { label: 'Gifts', width: 40, align: 'right' },
      { label: 'Current', width: 60, align: 'right' },
      { label: 'Prior', width: 60, align: 'right' },
      { label: 'Last Gift', width: 70, align: 'right' },
    ];
    const rows = atRiskDonors.slice(0, 50).map((d, i) => {
      const dName = ((d.first_name || '') + ' ' + (d.last_name || '')).trim() || d.constituent_id || 'Unknown';
      const riskType = d.risk_type || d.riskType || '';
      const riskColor = riskType === 'Declining' ? pdf.C.red : pdf.C.orange;
      return [
        i + 1, dName,
        { text: riskType, color: riskColor },
        pdf.fmtD(d.lifetime_total || d.lifetime_giving || 0),
        pdf.fmtN(d.lifetime_gifts || d.gift_count || 0),
        pdf.fmtD(d.current || d.current_giving || 0),
        pdf.fmtD(d.prior || d.prior_giving || 0),
        d.last_gift_date || d.last_gift || '',
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Upgrade / Downgrade Report
// ─────────────────────────────────────────────────────────────────────────────
function generateUpgradeDowngradeReport(res, fy, { categories, totalCurrentRevenue, totalPriorRevenue, netChange, distribution, topMovers, currentFY, priorFY }) {
  const doc = pdf.createDoc();
  const name = 'Donor Upgrade / Downgrade Report';
  pdf.streamPdf(res, doc, `Upgrade_Downgrade_FY${fy}.pdf`);
  pdf.titlePage(doc, name, fy);

  // KPI grid
  const netChangeColor = Number(netChange || 0) >= 0 ? pdf.C.green : pdf.C.red;
  pdf.sectionHeading(doc, 'Revenue Overview');
  pdf.kpiGrid(doc, [
    ['Current FY Revenue', pdf.fmtD(totalCurrentRevenue || 0)],
    ['Prior FY Revenue', pdf.fmtD(totalPriorRevenue || 0)],
    ['Net Change', pdf.fmtD(netChange || 0), netChangeColor],
  ]);

  // Category Summary
  if (categories && categories.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Category Summary');
    const cols = [
      { label: 'Category', width: 120 },
      { label: 'Donors', width: 65, align: 'right' },
      { label: 'Current Revenue', width: 100, align: 'right' },
      { label: 'Prior Revenue', width: 100, align: 'right' },
      { label: 'Revenue Change', width: 100, align: 'right' },
    ];
    const rows = categories.map(c => {
      const change = Number(c.revenue_change || c.net_change || 0);
      const changeColor = change >= 0 ? pdf.C.green : pdf.C.red;
      return [
        c.category || '',
        pdf.fmtN(c.donors || c.donor_count || 0),
        pdf.fmtD(c.current_revenue || c.current || 0),
        pdf.fmtD(c.prior_revenue || c.prior || 0),
        { text: pdf.fmtD(change), color: changeColor },
      ];
    });
    pdf.table(doc, cols, rows);
  }

  // Change Distribution
  if (distribution && distribution.length) {
    pdf.ensureSpace(doc, 80);
    pdf.divider(doc);
    pdf.sectionHeading(doc, 'Change Distribution');
    const cols = [
      { label: 'Band', width: 200 },
      { label: 'Donors', width: 130, align: 'right' },
      { label: 'Net Change', width: 150, align: 'right' },
    ];
    const rows = distribution.map(d => {
      const net = Number(d.net_change || d.change || 0);
      const color = net >= 0 ? pdf.C.green : pdf.C.red;
      return [
        d.band || '',
        pdf.fmtN(d.donors || d.donor_count || 0),
        { text: pdf.fmtD(net), color },
      ];
    });
    pdf.table(doc, cols, rows);
  }

  // Top Movers
  if (topMovers && topMovers.length) {
    doc.addPage();
    pdf.sectionHeading(doc, 'Top Movers');
    const cols = [
      { label: '#', width: 25, align: 'right' },
      { label: 'Donor', width: 140 },
      { label: 'Category', width: 95 },
      { label: 'Current', width: 80, align: 'right' },
      { label: 'Prior', width: 80, align: 'right' },
      { label: 'Change', width: 80, align: 'right' },
    ];
    const rows = topMovers.slice(0, 50).map((d, i) => {
      const change = Number(d.change || d.revenue_change || 0);
      const changeColor = change >= 0 ? pdf.C.green : pdf.C.red;
      return [
        i + 1,
        d.donor_name || d.constituent_id || 'Unknown',
        d.category || '',
        pdf.fmtD(d.current || d.current_revenue || 0),
        pdf.fmtD(d.prior || d.prior_revenue || 0),
        { text: pdf.fmtD(change), color: changeColor },
      ];
    });
    pdf.table(doc, cols, rows);
  }

  pdf.addFooters(doc, name, fy);
  doc.end();
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  generateExecutiveSummary,
  generateRetentionReport,
  generateScoringReport,
  generateRecurringReport,
  generateLybuntReport,
  generateGiftTrendsReport,
  generateCampaignReport,
  generateFundHealthReport,
  generateLifecycleReport,
  generateUpgradeDowngradeReport,
};
