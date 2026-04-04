/**
 * CRM Excel Parser
 *
 * Parses RE NXT Query Editor exports into normalized records
 * for the CRM gift tables. Handles the flat denormalized export
 * where a single gift may appear on multiple rows (one per
 * fundraiser, soft credit, or matching gift).
 */
const XLSX = require('xlsx');

// ---------------------------------------------------------------------------
// Standard column mapping: NXT Query Editor header → model field
// ---------------------------------------------------------------------------

const STANDARD_COLUMN_MAP = {
  // Gift core
  'gift amount':            'giftAmount',
  'gift code':              'giftCode',
  'gift date':              'giftDate',
  'gift id':                'giftId',
  'gift status':            'giftStatus',
  'gift payment type':      'giftPaymentType',
  'gift acknowledge':       'giftAcknowledge',
  'gift acknowledge date':  'giftAcknowledgeDate',
  'gift receipt amount':    'giftReceiptAmount',
  'gift batch number':      'giftBatchNumber',
  'gift date added':        'giftDateAdded',
  'gift date last changed': 'giftDateLastChanged',

  // Constituent
  'system record id':       'systemRecordId',
  'constituent id':         'constituentId',
  'first name':             'firstName',
  'last name':              'lastName',

  // Fund
  'fund category':          'fundCategory',
  'fund description':       'fundDescription',
  'fund id':                'fundId',
  'fund notes':             'fundNotes',

  // Campaign
  'campaign id':            'campaignId',
  'campaign description':   'campaignDescription',
  'campaign notes':         'campaignNotes',
  'campaign start date':    'campaignStartDate',
  'campaign end date':      'campaignEndDate',

  // Appeal
  'appeal category':        'appealCategory',
  'appeal description':     'appealDescription',
  'appeal id':              'appealId',
  'appeal notes':           'appealNotes',
  'appeal start date':      'appealStartDate',
  'appeal end date':        'appealEndDate',

  // Fundraiser (goes to crm_gift_fundraisers)
  'fundraiser name':        'fundraiserName',
  'fundraiser first name':  'fundraiserFirstName',
  'fundraiser last name':   'fundraiserLastName',
  'fundraiser amount':      'fundraiserAmount',

  // Soft Credit (goes to crm_gift_soft_credits)
  'soft credit amount':              'softCreditAmount',
  'soft credit recipient first name':'recipientFirstName',
  'soft credit recipient id':        'recipientId',
  'soft credit recipient last name': 'recipientLastName',
  'soft credit recipient name':      'recipientName',

  // Matching Gift (goes to crm_gift_matches)
  'match acknowledge':                'matchAcknowledge',
  'match acknowledge date':           'matchAcknowledgeDate',
  'matching gift added by':           'matchAddedBy',
  'match constituent code':           'matchConstituentCode',
  'matching gift date added':         'matchDateAdded',
  'matching gift date last changed':  'matchDateLastChanged',
  'match gift code':                  'matchGiftCode',
  'match gift date':                  'matchGiftDate',
  'match gift id':                    'matchGiftId',
  'match gift is anonymous':          'matchIsAnonymous',
  'match receipt amount':             'matchReceiptAmount',
  'match receipt date':               'matchReceiptDate',
};

// Fields that belong to each sub-table
const GIFT_FIELDS = new Set([
  'giftAmount', 'giftCode', 'giftDate', 'giftId', 'giftStatus',
  'giftPaymentType', 'giftAcknowledge', 'giftAcknowledgeDate',
  'giftReceiptAmount', 'giftBatchNumber', 'giftDateAdded', 'giftDateLastChanged',
  'systemRecordId', 'constituentId', 'firstName', 'lastName',
  'fundCategory', 'fundDescription', 'fundId', 'fundNotes',
  'campaignId', 'campaignDescription', 'campaignNotes', 'campaignStartDate', 'campaignEndDate',
  'appealCategory', 'appealDescription', 'appealId', 'appealNotes', 'appealStartDate', 'appealEndDate',
]);

const FUNDRAISER_FIELDS = new Set([
  'fundraiserName', 'fundraiserFirstName', 'fundraiserLastName', 'fundraiserAmount',
]);

const SOFT_CREDIT_FIELDS = new Set([
  'softCreditAmount', 'recipientFirstName', 'recipientId', 'recipientLastName', 'recipientName',
]);

const MATCH_FIELDS = new Set([
  'matchAcknowledge', 'matchAcknowledgeDate', 'matchAddedBy', 'matchConstituentCode',
  'matchDateAdded', 'matchDateLastChanged', 'matchGiftCode', 'matchGiftDate',
  'matchGiftId', 'matchIsAnonymous', 'matchReceiptAmount', 'matchReceiptDate',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    return null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

function parseAmount(val) {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[$,\s]/g, '').trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

function parseBoolean(val) {
  if (val == null) return null;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(s)) return true;
  if (['no', 'false', '0', 'n'].includes(s)) return false;
  return null;
}

function cleanString(val) {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

// Date fields that need date parsing
const DATE_FIELDS = new Set([
  'giftDate', 'giftAcknowledgeDate', 'giftDateAdded', 'giftDateLastChanged',
  'campaignStartDate', 'campaignEndDate', 'appealStartDate', 'appealEndDate',
  'matchAcknowledgeDate', 'matchGiftDate', 'matchReceiptDate',
  'matchDateAdded', 'matchDateLastChanged',
]);

// Amount fields that need numeric parsing
const AMOUNT_FIELDS = new Set([
  'giftAmount', 'giftReceiptAmount', 'fundraiserAmount',
  'softCreditAmount', 'matchReceiptAmount',
]);

const BOOLEAN_FIELDS = new Set(['matchIsAnonymous']);

function coerceValue(field, raw) {
  if (DATE_FIELDS.has(field)) return parseDate(raw);
  if (AMOUNT_FIELDS.has(field)) return parseAmount(raw);
  if (BOOLEAN_FIELDS.has(field)) return parseBoolean(raw);
  return cleanString(raw);
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/**
 * Auto-map Excel headers to model fields using the standard mapping.
 * Returns { mapping: { colIndex: fieldName }, unmapped: [headerName, ...] }
 */
function autoMapColumns(headers) {
  const mapping = {};
  const unmapped = [];

  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    if (raw == null) continue;
    const normalized = String(raw).trim().toLowerCase();
    const field = STANDARD_COLUMN_MAP[normalized];
    if (field) {
      mapping[i] = field;
    } else if (normalized) {
      unmapped.push(String(raw).trim());
    }
  }

  return { mapping, unmapped };
}

// ---------------------------------------------------------------------------
// Parse the Excel file
// ---------------------------------------------------------------------------

/**
 * Parse an NXT Query Editor export file.
 *
 * Returns {
 *   gifts: Map<giftId, giftRecord>,
 *   fundraisers: Array<{ giftId, ...fundraiserFields }>,
 *   softCredits: Array<{ giftId, ...softCreditFields }>,
 *   matches: Array<{ giftId, ...matchFields }>,
 *   stats: { totalRows, uniqueGifts, fundraiserRows, softCreditRows, matchRows },
 *   columnMapping: { colIndex: fieldName },
 *   unmappedColumns: string[],
 * }
 */
function parseCrmExport(filePath, customMapping = null) {
  const wb = XLSX.readFile(filePath, { cellDates: true });

  // Use first sheet
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  if (data.length < 2) {
    throw new Error('File appears empty — need at least a header row and one data row.');
  }

  const headers = data[0];
  const { mapping, unmapped } = customMapping
    ? { mapping: customMapping, unmapped: [] }
    : autoMapColumns(headers);

  // Check we have the critical field: Gift ID
  const hasGiftId = Object.values(mapping).includes('giftId');
  if (!hasGiftId) {
    throw new Error('Could not find a "Gift ID" column. This is required to identify unique gifts.');
  }

  const gifts = new Map();
  const fundraisers = [];
  const softCredits = [];
  const matches = [];

  for (let rowIdx = 1; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row || row.length === 0) continue;

    // Parse all mapped values
    const parsed = {};
    for (const [colIdx, field] of Object.entries(mapping)) {
      parsed[field] = coerceValue(field, row[parseInt(colIdx)]);
    }

    const giftId = parsed.giftId;
    if (!giftId) continue; // Skip rows without a gift ID

    // Upsert gift record (first occurrence wins for core fields)
    if (!gifts.has(giftId)) {
      const giftRecord = {};
      for (const [field, value] of Object.entries(parsed)) {
        if (GIFT_FIELDS.has(field)) {
          giftRecord[field] = value;
        }
      }
      gifts.set(giftId, giftRecord);
    }

    // Extract fundraiser if any fundraiser field is populated
    const hasFundraiser = [...FUNDRAISER_FIELDS].some(f => parsed[f] != null);
    if (hasFundraiser) {
      const fr = { giftId };
      for (const field of FUNDRAISER_FIELDS) {
        if (parsed[field] !== undefined) fr[field] = parsed[field];
      }
      fundraisers.push(fr);
    }

    // Extract soft credit if any soft credit field is populated
    const hasSoftCredit = [...SOFT_CREDIT_FIELDS].some(f => parsed[f] != null);
    if (hasSoftCredit) {
      const sc = { giftId };
      for (const field of SOFT_CREDIT_FIELDS) {
        if (parsed[field] !== undefined) sc[field] = parsed[field];
      }
      softCredits.push(sc);
    }

    // Extract match if any match field is populated
    const hasMatch = [...MATCH_FIELDS].some(f => parsed[f] != null);
    if (hasMatch) {
      const m = { giftId };
      for (const field of MATCH_FIELDS) {
        if (parsed[field] !== undefined) m[field] = parsed[field];
      }
      matches.push(m);
    }
  }

  return {
    gifts,
    fundraisers,
    softCredits,
    matches,
    stats: {
      totalRows: data.length - 1,
      uniqueGifts: gifts.size,
      fundraiserRows: fundraisers.length,
      softCreditRows: softCredits.length,
      matchRows: matches.length,
    },
    columnMapping: mapping,
    unmappedColumns: unmapped,
  };
}

module.exports = {
  parseCrmExport,
  autoMapColumns,
  STANDARD_COLUMN_MAP,
};
