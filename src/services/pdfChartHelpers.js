'use strict';

/**
 * PDFKit chart primitives for the Philanthropy Report.
 *
 * PDFKit ships line/rect primitives but no chart helpers. These functions
 * render pie/donut/bar charts directly into a PDFDocument using only
 * moveTo/lineTo/bezierCurveTo — no fonts, assets, or external deps.
 */

// ── Default palettes ──
const DEFAULT_PALETTE = [
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#ef4444', // red-500
  '#8b5cf6', // violet-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#6366f1', // indigo-500
  '#06b6d4', // cyan-500
  '#a855f7', // purple-500
];

const NAVY = '#003B5C';
const GRAY = '#6b7280';
const LIGHT_GRAY = '#e5e7eb';

// ── Arc approximation via cubic Bezier ──
// For an arc from startAngle to endAngle (radians, 0 = +x axis, ccw negative
// in screen space), split into ≤90° segments and draw each with a cubic.
function _arcTo(doc, cx, cy, r, startAngle, endAngle) {
  let current = startAngle;
  const step = Math.PI / 2; // 90° max per bezier segment for fidelity
  const dir = endAngle >= startAngle ? 1 : -1;
  while (Math.abs(endAngle - current) > 1e-6) {
    const remaining = endAngle - current;
    const theta = Math.abs(remaining) <= step ? remaining : dir * step;
    const h = (4 / 3) * Math.tan(theta / 4);
    const x0 = cx + r * Math.cos(current);
    const y0 = cy + r * Math.sin(current);
    const x3 = cx + r * Math.cos(current + theta);
    const y3 = cy + r * Math.sin(current + theta);
    const x1 = x0 - h * r * Math.sin(current);
    const y1 = y0 + h * r * Math.cos(current);
    const x2 = x3 + h * r * Math.sin(current + theta);
    const y2 = y3 - h * r * Math.cos(current + theta);
    doc.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    current += theta;
  }
}

/**
 * Draw a pie chart.
 * slices: [{ label, value, color? }]  — color is auto-assigned from palette if missing.
 * opts: { palette, strokeColor, strokeWidth }
 */
function drawPieChart(doc, cx, cy, r, slices, opts = {}) {
  const palette = opts.palette || DEFAULT_PALETTE;
  const strokeColor = opts.strokeColor || '#ffffff';
  const strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : 1;

  const total = slices.reduce((acc, s) => acc + Math.max(0, Number(s.value) || 0), 0);
  if (total <= 0) {
    // Empty pie — draw a light gray circle as a placeholder
    doc.circle(cx, cy, r).fill(LIGHT_GRAY);
    return;
  }

  let angle = -Math.PI / 2; // start at 12 o'clock
  slices.forEach((slice, i) => {
    const v = Math.max(0, Number(slice.value) || 0);
    if (v <= 0) return;
    const sweep = (v / total) * Math.PI * 2;
    const color = slice.color || palette[i % palette.length];

    doc.save();
    doc.moveTo(cx, cy);
    doc.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
    _arcTo(doc, cx, cy, r, angle, angle + sweep);
    doc.lineTo(cx, cy);
    doc.closePath();
    if (strokeWidth > 0) {
      doc.lineWidth(strokeWidth).fillAndStroke(color, strokeColor);
    } else {
      doc.fill(color);
    }
    doc.restore();

    angle += sweep;
  });
}

/**
 * Draw a donut chart (pie with a hole).
 */
function drawDonut(doc, cx, cy, rOuter, rInner, slices, opts = {}) {
  drawPieChart(doc, cx, cy, rOuter, slices, opts);
  // Overlay inner circle to create the donut hole
  doc.circle(cx, cy, rInner).fill(opts.holeColor || '#ffffff');
}

/**
 * Draw a legend as a vertical list.
 * items: [{ label, value?, color }]
 * opts: { fontSize (7), rowH (12), swatchSize (7), showValue (true), valueFmt(v) }
 */
function drawLegend(doc, x, y, items, opts = {}) {
  const fontSize = opts.fontSize || 7;
  const rowH = opts.rowH || 12;
  const swatch = opts.swatchSize || 7;
  const showValue = opts.showValue !== false;
  const valueFmt = opts.valueFmt || (v => String(v));
  const width = opts.width || 160;

  items.forEach((it, i) => {
    const ry = y + i * rowH;
    doc.rect(x, ry + 1, swatch, swatch).fill(it.color || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]);
    const labelX = x + swatch + 5;
    const labelW = showValue && it.value != null ? width - swatch - 5 - 55 : width - swatch - 5;
    doc.fontSize(fontSize).fillColor(opts.labelColor || NAVY)
      .text(it.label || '—', labelX, ry, { width: labelW, ellipsis: true, lineBreak: false });
    if (showValue && it.value != null) {
      doc.fontSize(fontSize).fillColor(opts.valueColor || GRAY)
        .text(valueFmt(it.value), x + width - 55, ry, { width: 55, align: 'right', lineBreak: false });
    }
  });
  return y + items.length * rowH;
}

/**
 * Horizontal bar chart.
 * items: [{ label, value, color? }]
 * opts: { labelW, valueW, barColor, rowH, fontSize, valueFmt, showZebra }
 */
function drawHBarChart(doc, x, y, width, items, opts = {}) {
  if (!items || items.length === 0) {
    doc.fontSize(8).fillColor(GRAY).text(opts.emptyLabel || 'No data available.', x, y + 4, { width });
    return y + 20;
  }
  const labelW = opts.labelW || 120;
  const valueW = opts.valueW || 55;
  const rowH = opts.rowH || 16;
  const fontSize = opts.fontSize || 7;
  const barMaxW = Math.max(20, width - labelW - valueW - 8);
  const valueFmt = opts.valueFmt || (v => String(v));
  const barColor = opts.barColor || '#3b82f6';
  const maxVal = Math.max(...items.map(it => Number(it.value) || 0), 1);

  items.forEach((it, i) => {
    const ry = y + i * rowH;
    if (opts.showZebra !== false && i % 2 === 0) {
      doc.rect(x, ry, width, rowH).fill('#f9fafb');
    }
    const barW = Math.max(2, (Number(it.value) / maxVal) * barMaxW);
    const rawLabel = it.label || '—';
    const name = rawLabel.length > 30 ? rawLabel.substring(0, 29) + '\u2026' : rawLabel;
    doc.fontSize(fontSize).fillColor(NAVY)
      .text(name, x + 4, ry + 3, { width: labelW - 8, lineBreak: false });
    doc.rect(x + labelW, ry + 3, barW, rowH - 6).fill(it.color || barColor);
    doc.fontSize(fontSize).fillColor(NAVY)
      .text(valueFmt(it.value), x + labelW + barW + 4, ry + 3, { width: valueW, lineBreak: false });
  });
  return y + items.length * rowH;
}

/**
 * Vertical grouped bar chart — two series side-by-side per category.
 * categories: [string]
 * series: [{ name, color, values: [number] }]   // values.length === categories.length
 * opts: { fontSize, leftAxisFmt, rightAxisFmt, axisColor }
 *
 * Useful for "# gifts vs $ raised" by category (Annual Giving slide).
 */
function drawGroupedBar(doc, x, y, width, height, categories, series, opts = {}) {
  const fontSize = opts.fontSize || 6;
  const axisColor = opts.axisColor || LIGHT_GRAY;
  const labelColor = opts.labelColor || GRAY;
  const padLeft = 38;
  const padRight = 6;
  const padBottom = 30;
  const padTop = 10;
  const plotW = width - padLeft - padRight;
  const plotH = height - padBottom - padTop;
  const plotX = x + padLeft;
  const plotY = y + padTop;

  if (!categories || categories.length === 0 || !series || series.length === 0) {
    doc.fontSize(8).fillColor(GRAY).text(opts.emptyLabel || 'No data available.', x + 8, y + height / 2, { width });
    return;
  }

  // Max across all series
  const allValues = series.flatMap(s => (s.values || []).map(v => Number(v) || 0));
  const maxVal = Math.max(...allValues, 1);

  // Horizontal gridlines (4)
  doc.lineWidth(0.4).strokeColor(axisColor);
  for (let g = 0; g <= 4; g++) {
    const gy = plotY + plotH - (g / 4) * plotH;
    doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).stroke();
    const gv = (g / 4) * maxVal;
    doc.fontSize(fontSize).fillColor(labelColor).text(
      opts.axisFmt ? opts.axisFmt(gv) : String(Math.round(gv)),
      x, gy - 3, { width: padLeft - 4, align: 'right', lineBreak: false }
    );
  }

  // Bars
  const groupW = plotW / categories.length;
  const barGap = Math.max(1, groupW * 0.08);
  const barW = Math.max(2, (groupW - barGap * (series.length + 1)) / series.length);

  categories.forEach((cat, ci) => {
    const groupX = plotX + ci * groupW + barGap;
    series.forEach((s, si) => {
      const val = Number((s.values || [])[ci]) || 0;
      const bh = (val / maxVal) * plotH;
      const bx = groupX + si * (barW + barGap);
      const by = plotY + plotH - bh;
      doc.rect(bx, by, barW, bh).fill(s.color || DEFAULT_PALETTE[si % DEFAULT_PALETTE.length]);
      if (opts.showValueLabels && val > 0) {
        doc.fontSize(fontSize).fillColor(NAVY).text(
          opts.valueFmt ? opts.valueFmt(val) : String(val),
          bx - 2, by - fontSize - 1, { width: barW + 4, align: 'center', lineBreak: false }
        );
      }
    });
    // Category label
    const labelText = cat.length > 10 ? cat.substring(0, 9) + '\u2026' : cat;
    doc.fontSize(fontSize).fillColor(labelColor).text(
      labelText, groupX - barGap, plotY + plotH + 3,
      { width: groupW, align: 'center', lineBreak: false }
    );
  });

  // Series legend below
  if (opts.showLegend !== false) {
    const legendY = plotY + plotH + padBottom - 10;
    let lx = plotX;
    series.forEach((s) => {
      doc.rect(lx, legendY + 1, 6, 6).fill(s.color || DEFAULT_PALETTE[0]);
      doc.fontSize(fontSize).fillColor(labelColor)
        .text(s.name || '', lx + 9, legendY, { width: 80, lineBreak: false });
      lx += 80;
    });
  }
}

/**
 * Draw a "card" frame — rounded rectangle with a bold blue border, matching
 * the PowerPoint's visual language.
 */
function drawCard(doc, x, y, w, h, opts = {}) {
  const borderColor = opts.borderColor || '#1e40af';
  const borderWidth = opts.borderWidth != null ? opts.borderWidth : 2;
  const radius = opts.radius != null ? opts.radius : 8;
  const fill = opts.fill || '#ffffff';
  doc.roundedRect(x, y, w, h, radius).fill(fill);
  doc.lineWidth(borderWidth).strokeColor(borderColor);
  doc.roundedRect(x, y, w, h, radius).stroke();
}

/**
 * Labeled KPI block inside a card — used for "GOAL  $1,200,000" sections.
 * Returns the Y coordinate after the block.
 */
function drawKpiBlock(doc, x, y, w, label, value, opts = {}) {
  const labelColor = opts.labelColor || '#3b82f6';
  const valueColor = opts.valueColor || '#1e3a8a';
  const labelSize = opts.labelSize || 11;
  const valueSize = opts.valueSize || 18;
  doc.fontSize(labelSize).fillColor(labelColor)
    .font('Helvetica-Bold').text(label, x, y, { width: w, lineBreak: false });
  doc.fontSize(valueSize).fillColor(valueColor)
    .font('Helvetica-Bold').text(value, x, y + labelSize + 3, { width: w, lineBreak: false });
  doc.font('Helvetica'); // reset
  return y + labelSize + valueSize + 8;
}

module.exports = {
  DEFAULT_PALETTE,
  drawPieChart,
  drawDonut,
  drawLegend,
  drawHBarChart,
  drawGroupedBar,
  drawCard,
  drawKpiBlock,
};
