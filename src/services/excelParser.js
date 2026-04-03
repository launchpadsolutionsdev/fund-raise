/**
 * Parse department Excel files.
 * Each spreadsheet has three sheets: REPORT, RAW, INSTRUCTIONS.
 */
const XLSX = require('xlsx');

function parseDepartmentFile(filePath, department) {
  const wb = XLSX.readFile(filePath);
  const sheetNames = wb.SheetNames.map(s => s.toLowerCase());

  if (!sheetNames.includes('report')) {
    throw new Error(`Missing 'REPORT' sheet in ${department} file`);
  }

  const reportIdx = sheetNames.indexOf('report');
  const reportWs = wb.Sheets[wb.SheetNames[reportIdx]];

  const result = {
    summary: {},
    giftTypes: [],
    sources: [],
    funds: [],
    rawGifts: [],
  };

  parseReportSheet(reportWs, department, result);

  if (sheetNames.includes('raw')) {
    const rawIdx = sheetNames.indexOf('raw');
    const rawWs = wb.Sheets[wb.SheetNames[rawIdx]];
    parseRawSheet(rawWs, department, result);
  }

  return result;
}

function safeFloat(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,%]/g, '').trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

function safeInt(val) {
  const f = safeFloat(val);
  return f != null ? Math.round(f) : null;
}

function parseReportSheet(ws, department, result) {
  const summary = result.summary;
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const rows = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= Math.min(range.e.c, 9); c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      row.push(cell ? cell.v : null);
    }
    rows.push(row);
  }

  let parsingGiftTypes = false;
  let parsingTpGiftTypes = false;
  let parsingSources = false;
  let parsingFunds = false;
  let parsingTpFunds = false;

  for (const row of rows) {
    const cellA = row[0];
    const cellB = row[1];
    const label = (cellA != null ? String(cellA).trim().toLowerCase() : '');

    // Summary metrics
    if (label.startsWith('total gifts')) {
      summary.totalGifts = safeInt(cellB);
      if (department === 'events' && row[4] != null) {
        summary.thirdPartyTotalGifts = safeInt(row[4]);
      }
    } else if (label.startsWith('total amount') || label.startsWith('total bequest')) {
      summary.totalAmount = safeFloat(cellB);
      if (department === 'events' && row[4] != null) {
        summary.thirdPartyTotalAmount = safeFloat(row[4]);
      }
    } else if (label === '% to goal') {
      summary.pctToGoal = safeFloat(cellB);
      if (department === 'events' && row[4] != null) {
        summary.thirdPartyPctToGoal = safeFloat(row[4]);
      }
    } else if (label.includes('goal') && label.endsWith('goal') && !label.startsWith('%')) {
      summary.goal = safeFloat(cellB);
      if (department === 'events' && row[4] != null) {
        summary.thirdPartyGoal = safeFloat(row[4]);
      }
    } else if (label === 'average legacy gift' && department === 'legacy_giving') {
      summary.avgGift = safeFloat(cellB);
    } else if (label.includes('new confirmed expectancies') && department === 'legacy_giving') {
      summary.newExpectancies = safeInt(cellB);
    } else if (label.includes('open estates') && department === 'legacy_giving') {
      summary.openEstates = safeInt(cellB);
    } else if (label.includes('recorded expectancies') && department === 'legacy_giving') {
      summary.recordedExpectancies = safeInt(cellB);
    }

    // Section detection
    if (label === 'gift type' || label === 'gift types') {
      parsingGiftTypes = true; parsingSources = false; parsingFunds = false;
      parsingTpGiftTypes = department === 'events';
      continue;
    } else if (label === 'source' || label === 'sources') {
      parsingGiftTypes = false; parsingSources = true; parsingFunds = false;
      continue;
    } else if (label.includes('gift by fund') || label.includes('gifts by fund') || label === 'fund' || label === 'funds') {
      parsingGiftTypes = false; parsingSources = false; parsingFunds = true;
      parsingTpFunds = department === 'events';
      continue;
    }

    // Parse breakdown rows
    if (parsingGiftTypes && label && label !== 'total') {
      if (cellA && cellB != null && !label.startsWith('gift type')) {
        result.giftTypes.push({
          giftType: String(cellA).trim(),
          amount: safeInt(cellB),
          pctOfGifts: safeFloat(row[2]),
          category: 'primary',
        });
        if (parsingTpGiftTypes && row[4] != null) {
          result.giftTypes.push({
            giftType: String(cellA).trim(),
            amount: safeInt(row[4]),
            pctOfGifts: safeFloat(row[5]),
            category: 'third_party',
          });
        }
      } else if (!cellA || label === '') {
        parsingGiftTypes = false;
        parsingTpGiftTypes = false;
      }
    }

    if (parsingSources && label && label !== 'total') {
      if (cellA && cellB != null && !label.startsWith('source')) {
        result.sources.push({
          source: String(cellA).trim(),
          amount: safeInt(cellB),
          pctOfGifts: safeFloat(row[2]),
        });
      } else if (!cellA || label === '') {
        parsingSources = false;
      }
    }

    if (parsingFunds && label && label !== 'total' && label !== 'grand total') {
      if (cellA && cellB != null && !label.startsWith('fund') && !label.includes('gift by fund') && !label.includes('gifts by fund')) {
        const fundEntry = {
          fundName: String(cellA).trim(),
          amount: safeFloat(cellB),
          pctOfTotal: safeFloat(row[2]),
          category: 'primary',
        };
        if (['annual_giving', 'direct_mail'].includes(department)) {
          fundEntry.onetimeCount = safeInt(row[3]);
          fundEntry.recurringCount = safeInt(row[4]);
          fundEntry.onlineCount = safeInt(row[5]);
          fundEntry.mailedInCount = safeInt(row[6]);
          fundEntry.totalCount = safeInt(row[7]);
        }
        result.funds.push(fundEntry);

        if (parsingTpFunds && row[3] != null) {
          result.funds.push({
            fundName: String(cellA).trim(),
            amount: safeFloat(row[3]),
            pctOfTotal: safeFloat(row[4]),
            category: 'third_party',
          });
        }
      } else if (!cellA || label === '') {
        parsingFunds = false;
        parsingTpFunds = false;
      }
    }
  }
}

function parseRawSheet(ws, department, result) {
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (data.length < 2) return;

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const gift = {
      primaryAddressee: row[0] != null ? String(row[0]) : null,
      appealId: row[1] != null ? String(row[1]) : null,
      splitAmount: safeFloat(row[2]),
      fundDescription: row[3] != null ? String(row[3]) : null,
      giftId: safeInt(row[4]),
      giftType: row[5] != null ? String(row[5]) : null,
      giftReference: row[6] != null ? String(row[6]) : null,
      giftDate: parseDate(row[7]),
      extraField: row[8] != null ? String(row[8]) : null,
    };
    result.rawGifts.push(gift);
  }
}

function parseDate(val) {
  if (val == null) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

module.exports = { parseDepartmentFile };
