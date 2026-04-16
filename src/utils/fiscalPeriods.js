'use strict';

/**
 * Fiscal period helpers — used by Board Report variants (full FY, quarterly, monthly)
 * and anywhere else we need FY-relative date ranges.
 *
 * All helpers respect the tenant's configured fiscal year start month so a July-FY
 * tenant's "Q1" is Jul–Sep, not Apr–Jun.
 *
 * Date range contract matches the existing fyToDateRange() in routes/crmDashboard.js:
 *   { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' (exclusive), fy, fyMonth }
 */

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function normalizeFyStart(fyStartMonth) {
  const m = Number(fyStartMonth);
  if (!m || m < 1 || m > 12) return 4;
  return m;
}

/**
 * Given an FY and its start month, return the calendar (year, month) for the Nth
 * month of that fiscal year where fyMonthOffset is 1..12 (1 = first month of FY).
 */
function fyMonthOffsetToCalendar(fy, fyStartMonth, fyMonthOffset) {
  fyStartMonth = normalizeFyStart(fyStartMonth);
  // The FY starts in month `fyStartMonth` of year `fy - baseOffset`.
  // Jan-start FYs are labeled by the same calendar year they start in; all others
  // are labeled by the calendar year they END in.
  const baseOffset = fyStartMonth === 1 ? 0 : 1;
  const startYear = Number(fy) - baseOffset;
  const zeroIdx = Number(fyMonthOffset) - 1; // 0..11
  const calMonth = ((fyStartMonth - 1) + zeroIdx) % 12 + 1;
  const yearAdd = Math.floor(((fyStartMonth - 1) + zeroIdx) / 12);
  return { calYear: startYear + yearAdd, calMonth };
}

/** Full FY range (same output shape as routes/crmDashboard.js fyToDateRange). */
function fyToDateRange(fy, fyStartMonth) {
  if (!fy) return null;
  const year = Number(fy);
  if (isNaN(year)) return null;
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const m = String(fyStartMonth).padStart(2, '0');
  const offset = fyStartMonth === 1 ? 0 : 1;
  return {
    startDate: `${year - offset}-${m}-01`,
    endDate: `${year - offset + 1}-${m}-01`, // exclusive upper bound
    fy: year,
    fyMonth: fyStartMonth,
  };
}

/** Single-month range inside a fiscal year. fyMonthOffset: 1..12 */
function fyMonthToDateRange(fy, fyStartMonth, fyMonthOffset) {
  if (!fy || !fyMonthOffset) return null;
  const offset = Number(fyMonthOffset);
  if (isNaN(offset) || offset < 1 || offset > 12) return null;
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const { calYear, calMonth } = fyMonthOffsetToCalendar(fy, fyStartMonth, offset);
  const nextCalMonth = calMonth === 12 ? 1 : calMonth + 1;
  const nextCalYear = calMonth === 12 ? calYear + 1 : calYear;
  return {
    startDate: `${calYear}-${String(calMonth).padStart(2, '0')}-01`,
    endDate: `${nextCalYear}-${String(nextCalMonth).padStart(2, '0')}-01`,
    fy: Number(fy),
    fyMonth: fyStartMonth,
  };
}

/** Quarter range inside a fiscal year. q: 1..4 where Q1 = first 3 months of the FY. */
function fyQuarterToDateRange(fy, fyStartMonth, q) {
  if (!fy || !q) return null;
  const quarter = Number(q);
  if (isNaN(quarter) || quarter < 1 || quarter > 4) return null;
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const firstOffset = (quarter - 1) * 3 + 1;
  const lastOffset = quarter * 3;
  const start = fyMonthToDateRange(fy, fyStartMonth, firstOffset);
  const end = fyMonthToDateRange(fy, fyStartMonth, lastOffset);
  if (!start || !end) return null;
  return {
    startDate: start.startDate,
    endDate: end.endDate, // exclusive; the month after the quarter ends
    fy: Number(fy),
    fyMonth: fyStartMonth,
  };
}

/** e.g. "FY2026 (Apr 2025 – Mar 2026)" or "FY2026 (Jan – Dec 2026)" */
function fyRangeLabel(fy, fyStartMonth) {
  if (!fy) return 'All Time';
  fyStartMonth = normalizeFyStart(fyStartMonth);
  if (fyStartMonth === 1) {
    return `FY${fy} (Jan – Dec ${fy})`;
  }
  const startYear = Number(fy) - 1;
  const startShort = SHORT_MONTHS[fyStartMonth - 1];
  const endShort = SHORT_MONTHS[(fyStartMonth - 2 + 12) % 12];
  return `FY${fy} (${startShort} ${startYear} – ${endShort} ${fy})`;
}

/** e.g. "FY2026 Q2 (Jul – Sep 2025)" — collapses year suffix when start/end share one. */
function fyQuarterLabel(fy, fyStartMonth, q) {
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const startOffset = (q - 1) * 3 + 1;
  const endOffset = q * 3;
  const start = fyMonthOffsetToCalendar(fy, fyStartMonth, startOffset);
  const end = fyMonthOffsetToCalendar(fy, fyStartMonth, endOffset);
  if (start.calYear === end.calYear) {
    return `FY${fy} Q${q} (${SHORT_MONTHS[start.calMonth - 1]} – ${SHORT_MONTHS[end.calMonth - 1]} ${start.calYear})`;
  }
  return `FY${fy} Q${q} (${SHORT_MONTHS[start.calMonth - 1]} ${start.calYear} – ${SHORT_MONTHS[end.calMonth - 1]} ${end.calYear})`;
}

/** e.g. "June 2025" */
function fyMonthLabel(fy, fyStartMonth, fyMonthOffset) {
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const { calYear, calMonth } = fyMonthOffsetToCalendar(fy, fyStartMonth, fyMonthOffset);
  return `${FULL_MONTHS[calMonth - 1]} ${calYear}`;
}

/** e.g. "Jun 2025" — for compact filenames / UI */
function fyMonthLabelShort(fy, fyStartMonth, fyMonthOffset) {
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const { calYear, calMonth } = fyMonthOffsetToCalendar(fy, fyStartMonth, fyMonthOffset);
  return `${SHORT_MONTHS[calMonth - 1]} ${calYear}`;
}

/**
 * Build a period descriptor for Board Report generation.
 *
 * Returns a normalized object the renderer can consume directly, or null if the
 * inputs are invalid (e.g. missing fy, out-of-range quarter).
 *
 * type: 'fy' | 'quarter' | 'month' (default 'fy')
 */
function buildPeriodDescriptor({ type, fy, quarter, month, fyStartMonth }) {
  fyStartMonth = normalizeFyStart(fyStartMonth);
  const fyNum = Number(fy);
  if (!fyNum || isNaN(fyNum)) return null;

  if (type === 'quarter') {
    const q = Number(quarter);
    if (!q || q < 1 || q > 4) return null;
    const dateRange = fyQuarterToDateRange(fyNum, fyStartMonth, q);
    const priorDateRange = fyQuarterToDateRange(fyNum - 1, fyStartMonth, q);
    const label = fyQuarterLabel(fyNum, fyStartMonth, q);
    return {
      type: 'quarter',
      fy: fyNum,
      quarter: q,
      fyStartMonth,
      dateRange,
      priorDateRange,
      label,
      headerSubtitle: 'Board Report · Quarterly',
      filenameStem: `Board_Report_FY${fyNum}_Q${q}`,
      showRetention: false,
      priorPeriodLabel: `FY${fyNum - 1} Q${q}`,
    };
  }

  if (type === 'month') {
    const m = Number(month);
    if (!m || m < 1 || m > 12) return null;
    const dateRange = fyMonthToDateRange(fyNum, fyStartMonth, m);
    const priorDateRange = fyMonthToDateRange(fyNum - 1, fyStartMonth, m);
    const label = fyMonthLabel(fyNum, fyStartMonth, m);
    const shortLabel = fyMonthLabelShort(fyNum, fyStartMonth, m);
    return {
      type: 'month',
      fy: fyNum,
      month: m,
      fyStartMonth,
      dateRange,
      priorDateRange,
      label,
      headerSubtitle: 'Board Report · Monthly',
      filenameStem: `Board_Report_${shortLabel.replace(/\s+/g, '_')}`,
      showRetention: false,
      priorPeriodLabel: fyMonthLabelShort(fyNum - 1, fyStartMonth, m),
    };
  }

  // Default: full fiscal year (matches legacy Board Report behavior)
  const dateRange = fyToDateRange(fyNum, fyStartMonth);
  const priorDateRange = fyToDateRange(fyNum - 1, fyStartMonth);
  const label = fyRangeLabel(fyNum, fyStartMonth);
  return {
    type: 'fy',
    fy: fyNum,
    fyStartMonth,
    dateRange,
    priorDateRange,
    label,
    headerSubtitle: 'Board Report',
    filenameStem: `Board_Report_FY${fyNum}`,
    showRetention: true,
    priorPeriodLabel: `FY${fyNum - 1}`,
  };
}

module.exports = {
  FULL_MONTHS,
  SHORT_MONTHS,
  normalizeFyStart,
  fyMonthOffsetToCalendar,
  fyToDateRange,
  fyMonthToDateRange,
  fyQuarterToDateRange,
  fyRangeLabel,
  fyQuarterLabel,
  fyMonthLabel,
  fyMonthLabelShort,
  buildPeriodDescriptor,
};
