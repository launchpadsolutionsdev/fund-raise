/**
 * CRM Excel/CSV Parser
 *
 * Parses RE NXT Query Editor exports (CSV or Excel) into normalized
 * records for the CRM gift tables. Uses streaming for CSV to handle
 * large files (600K+ rows) without exceeding memory limits.
 *
 * Handles the flat denormalized export where a single gift may appear
 * on multiple rows (one per fundraiser, soft credit, or matching gift).
 */
const fs = require('fs');
const readline = require('readline');
const { parse } = require('csv-parse');

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
  'email':                  'constituentEmail',
  'email address':          'constituentEmail',
  'constituent email':      'constituentEmail',
  'preferred email':        'constituentEmail',
  'phone':                  'constituentPhone',
  'phone number':           'constituentPhone',
  'preferred phone':        'constituentPhone',
  'home phone':             'constituentPhone',
  'mobile phone':           'constituentPhone',
  'address':                'constituentAddress',
  'preferred address':      'constituentAddress',
  'address line 1':         'constituentAddress',
  'street address':         'constituentAddress',
  'city':                   'constituentCity',
  'preferred city':         'constituentCity',
  'state':                  'constituentState',
  'preferred state':        'constituentState',
  'zip':                    'constituentZip',
  'zip code':               'constituentZip',
  'postal code':            'constituentZip',
  'preferred zip':          'constituentZip',

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

  // Additional constituent contact fields
  'addresses\\country':               'constituentCountry',
  'addresses\\type':                  'addressType',
  'addresses\\do not mail':           'addressDoNotMail',
  'phone numbers\\type':              'phoneType',
  'phone numbers\\do not call':       'phoneDoNotCall',
  'email addresses\\type':            'emailType',
  'email addresses\\do not email':    'emailDoNotEmail',

  // Common header variations
  'gift amt':                         'giftAmount',
  'amt':                              'giftAmount',
  'gift dt':                          'giftDate',
  'date':                             'giftDate',
  'rec id':                           'systemRecordId',
  'record id':                        'systemRecordId',
  'id':                               'giftId',
  'lookup id':                        'constituentLookupId',
  'constituent lookup id':            'constituentLookupId',
  'name':                             'constituentName',
  'primary addressee':                'primaryAddressee',
  'addressee':                        'primaryAddressee',
  'fund':                             'fundDescription',
  'fund desc':                        'fundDescription',
  'campaign':                         'campaignDescription',
  'campaign desc':                    'campaignDescription',
  'appeal':                           'appealDescription',
  'appeal desc':                      'appealDescription',
  'package':                          'packageDescription',
  'package description':              'packageDescription',
  'package id':                       'packageId',
  'gift type':                        'giftType',
  'type':                             'giftType',
  'pay method':                       'paymentType',
  'payment method':                   'paymentType',
  'reference':                        'giftReference',
  'gift reference':                   'giftReference',
  'constituent code':                 'constituentCode',
  'constituent codes\\description':   'constituentCode',
  'solicit codes\\description':       'solicitCode',

  // RE NXT nested field paths (backslash-separated)
  'email addresses\\email address':   'constituentEmail',
  'phone numbers\\number':            'constituentPhone',
  'addresses\\address':               'constituentAddress',
  'addresses\\city':                  'constituentCity',
  'addresses\\state':                 'constituentState',
  'addresses\\zip':                   'constituentZip',

  // Campaign category
  'campaign category':                'campaignCategory',
};

// Fields that belong to each sub-table
const GIFT_FIELDS = new Set([
  'giftAmount', 'giftCode', 'giftDate', 'giftId', 'giftStatus',
  'giftPaymentType', 'giftAcknowledge', 'giftAcknowledgeDate',
  'giftReceiptAmount', 'giftBatchNumber', 'giftDateAdded', 'giftDateLastChanged',
  'giftType', 'giftReference', 'paymentType',
  'systemRecordId', 'constituentId', 'firstName', 'lastName',
  'constituentEmail', 'constituentPhone', 'constituentAddress', 'constituentCity', 'constituentState', 'constituentZip',
  'constituentCountry', 'addressType', 'addressDoNotMail',
  'phoneType', 'phoneDoNotCall', 'emailType', 'emailDoNotEmail',
  'constituentLookupId', 'constituentName', 'primaryAddressee', 'constituentCode', 'solicitCode',
  'fundCategory', 'fundDescription', 'fundId', 'fundNotes',
  'campaignId', 'campaignDescription', 'campaignCategory', 'campaignNotes', 'campaignStartDate', 'campaignEndDate',
  'appealCategory', 'appealDescription', 'appealId', 'appealNotes', 'appealStartDate', 'appealEndDate',
  'packageDescription', 'packageId',
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
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    // Try common date formats
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
    if (!cleaned) return null;
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

const DATE_FIELDS = new Set([
  'giftDate', 'giftAcknowledgeDate', 'giftDateAdded', 'giftDateLastChanged',
  'campaignStartDate', 'campaignEndDate', 'appealStartDate', 'appealEndDate',
  'matchAcknowledgeDate', 'matchGiftDate', 'matchReceiptDate',
  'matchDateAdded', 'matchDateLastChanged',
]);

const AMOUNT_FIELDS = new Set([
  'giftAmount', 'giftReceiptAmount', 'fundraiserAmount',
  'softCreditAmount', 'matchReceiptAmount',
]);

const BOOLEAN_FIELDS = new Set([
  'matchIsAnonymous', 'addressDoNotMail', 'phoneDoNotCall', 'emailDoNotEmail',
]);

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
 * Auto-map headers to model fields using the standard mapping.
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
// Read just the CSV headers (memory-safe)
// ---------------------------------------------------------------------------

/**
 * Read only the first line of a CSV to get headers.
 * Uses streaming so a 267MB file doesn't blow memory.
 */
function readCsvHeaders(filePath) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      rl.close();
      stream.destroy();
      // Parse the header line as CSV (handles quoted fields)
      const parser = parse(line, { delimiter: ',', relax_column_count: true });
      const rows = [];
      parser.on('readable', () => {
        let record;
        while ((record = parser.read()) !== null) rows.push(record);
      });
      parser.on('end', () => resolve(rows[0] || []));
      parser.on('error', reject);
    });

    rl.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Streaming CSV parser
// ---------------------------------------------------------------------------

/**
 * Parse a CSV file using streaming. Processes row by row to stay
 * under memory limits even for 600K+ row files.
 *
 * Calls onBatch(batchType, records) periodically so the caller
 * can write to the database in chunks.
 *
 * @param {string} filePath
 * @param {object} mapping - { colIndex: fieldName }
 * @param {function} onGiftBatch - async (gifts[]) called per batch
 * @param {function} onFundraiserBatch - async (fundraisers[]) called per batch
 * @param {function} onSoftCreditBatch - async (softCredits[]) called per batch
 * @param {function} onMatchBatch - async (matches[]) called per batch
 * @param {number} batchSize - rows per batch (default 500)
 * @returns {object} stats
 */
async function streamParseCsv(filePath, mapping, { onGiftBatch, onFundraiserBatch, onSoftCreditBatch, onMatchBatch, batchSize = 25 }) {
  const giftIdsSeen = new Set();
  let giftBatch = [];
  let fundraiserBatch = [];
  let softCreditBatch = [];
  let matchBatch = [];

  let totalRows = 0;
  let uniqueGifts = 0;
  let fundraiserRows = 0;
  let softCreditRows = 0;
  let matchRows = 0;

  async function flush() {
    if (giftBatch.length && onGiftBatch) { await onGiftBatch(giftBatch); giftBatch = []; }
    if (fundraiserBatch.length && onFundraiserBatch) { await onFundraiserBatch(fundraiserBatch); fundraiserBatch = []; }
    if (softCreditBatch.length && onSoftCreditBatch) { await onSoftCreditBatch(softCreditBatch); softCreditBatch = []; }
    if (matchBatch.length && onMatchBatch) { await onMatchBatch(matchBatch); matchBatch = []; }
  }

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const parser = stream.pipe(parse({
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    from_line: 2, // skip header
  }));

  // Use for-await to get natural backpressure — parser pauses while we await DB writes
  for await (const row of parser) {
    totalRows++;

    const parsed = {};
    for (const [colIdx, field] of Object.entries(mapping)) {
      parsed[field] = coerceValue(field, row[parseInt(colIdx)]);
    }

    const giftId = parsed.giftId;
    if (!giftId) continue;

    if (!giftIdsSeen.has(giftId)) {
      giftIdsSeen.add(giftId);
      uniqueGifts++;
      const giftRecord = {};
      for (const [field, value] of Object.entries(parsed)) {
        if (GIFT_FIELDS.has(field)) giftRecord[field] = value;
      }
      giftBatch.push(giftRecord);
    }

    const hasFundraiser = [...FUNDRAISER_FIELDS].some(f => parsed[f] != null);
    if (hasFundraiser) {
      const fr = { giftId };
      for (const field of FUNDRAISER_FIELDS) {
        if (parsed[field] !== undefined) fr[field] = parsed[field];
      }
      fundraiserBatch.push(fr);
      fundraiserRows++;
    }

    const hasSoftCredit = [...SOFT_CREDIT_FIELDS].some(f => parsed[f] != null);
    if (hasSoftCredit) {
      const sc = { giftId };
      for (const field of SOFT_CREDIT_FIELDS) {
        if (parsed[field] !== undefined) sc[field] = parsed[field];
      }
      softCreditBatch.push(sc);
      softCreditRows++;
    }

    const hasMatch = [...MATCH_FIELDS].some(f => parsed[f] != null);
    if (hasMatch) {
      const m = { giftId };
      for (const field of MATCH_FIELDS) {
        if (parsed[field] !== undefined) m[field] = parsed[field];
      }
      matchBatch.push(m);
      matchRows++;
    }

    if (giftBatch.length >= batchSize || fundraiserBatch.length >= batchSize ||
        softCreditBatch.length >= batchSize || matchBatch.length >= batchSize) {
      await flush();
    }

    if (totalRows % 50000 === 0) {
      console.log(`[CRM PARSER] ${totalRows.toLocaleString()} rows, ${uniqueGifts.toLocaleString()} unique gifts...`);
    }
  }

  // Flush remaining
  await flush();

  return { totalRows, uniqueGifts, fundraiserRows, softCreditRows, matchRows };
}

// ---------------------------------------------------------------------------
// Excel parser (for .xlsx/.xls — smaller files only)
// ---------------------------------------------------------------------------

function parseCrmExcel(filePath, customMapping = null) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  if (data.length < 2) {
    throw new Error('File appears empty — need at least a header row and one data row.');
  }

  const headers = data[0];
  const { mapping, unmapped } = customMapping
    ? { mapping: customMapping, unmapped: [] }
    : autoMapColumns(headers);

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

    const parsed = {};
    for (const [colIdx, field] of Object.entries(mapping)) {
      parsed[field] = coerceValue(field, row[parseInt(colIdx)]);
    }

    const giftId = parsed.giftId;
    if (!giftId) continue;

    if (!gifts.has(giftId)) {
      const giftRecord = {};
      for (const [field, value] of Object.entries(parsed)) {
        if (GIFT_FIELDS.has(field)) giftRecord[field] = value;
      }
      gifts.set(giftId, giftRecord);
    }

    const hasFundraiser = [...FUNDRAISER_FIELDS].some(f => parsed[f] != null);
    if (hasFundraiser) {
      const fr = { giftId };
      for (const field of FUNDRAISER_FIELDS) {
        if (parsed[field] !== undefined) fr[field] = parsed[field];
      }
      fundraisers.push(fr);
    }

    const hasSoftCredit = [...SOFT_CREDIT_FIELDS].some(f => parsed[f] != null);
    if (hasSoftCredit) {
      const sc = { giftId };
      for (const field of SOFT_CREDIT_FIELDS) {
        if (parsed[field] !== undefined) sc[field] = parsed[field];
      }
      softCredits.push(sc);
    }

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
  autoMapColumns,
  readCsvHeaders,
  streamParseCsv,
  parseCrmExcel,
  STANDARD_COLUMN_MAP,
  GIFT_FIELDS,
  FUNDRAISER_FIELDS,
  SOFT_CREDIT_FIELDS,
  MATCH_FIELDS,
};
