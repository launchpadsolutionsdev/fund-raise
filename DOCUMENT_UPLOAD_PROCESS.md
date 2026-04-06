# Document Upload & Header Detection Process

## Overview

The application supports two distinct upload workflows for importing fundraising data:

1. **Department Spreadsheet Upload** - Weekly Excel snapshots for 5 departments
2. **CRM Data Import** - Large CSV/Excel exports from Blackbaud RE NXT Query Editor

**Important:** Header detection uses a **static lookup table** with 60+ mapped Blackbaud NXT headers, not AI/ML. The AI (Claude) is used only for post-import analytics and insights.

---

## Table of Contents

- [Architecture Diagram](#architecture-diagram)
- [1. Department Spreadsheet Upload](#1-department-spreadsheet-upload)
- [2. CRM Data Import](#2-crm-data-import)
- [3. Header Detection & Column Mapping](#3-header-detection--column-mapping)
- [4. File Parsing](#4-file-parsing)
- [5. Department Classification](#5-department-classification)
- [6. Database Schema](#6-database-schema)
- [7. Key Files Reference](#7-key-files-reference)

---

## Architecture Diagram

```
User Browser                        Server                              Database
───────────                        ──────                              ────────

[Drag & Drop File]
       │
       ▼
[Frontend Validation]
  (.xlsx/.xls/.csv, size check)
       │
       ├──── Department Upload ──────► POST /upload/process
       │                                    │
       │                                    ▼
       │                              parseDepartmentFile()
       │                              (excelParser.js)
       │                                    │
       │                                    ▼
       │                              saveDepartmentData() ──────► Snapshot + DepartmentData
       │
       └──── CRM Import ────────────► POST /crm-upload/preview
                                            │
                                            ▼
                                      readCsvHeaders() / XLSX read
                                            │
                                            ▼
                                      autoMapColumns()  ◄── STANDARD_COLUMN_MAP
                                      (60+ header lookup)        (lookup table)
                                            │
                                            ▼
                                      Return mapping to UI
                                            │
                                            ▼
                                      User confirms mapping
                                            │
                                            ▼
                                      POST /crm-upload/process
                                            │
                                            ▼
                                      importCrmFile()  (async/background)
                                            │
                                            ├── Delete existing CRM data
                                            ├── Stream-parse CSV / load Excel
                                            ├── coerceValue() per field
                                            ├── classifyDepartment() per row
                                            ├── Batch insert (every 25 rows)
                                            │       │
                                            │       ▼
                                            │   CrmGift, CrmGiftFundraiser,
                                            │   CrmGiftSoftCredit, CrmGiftMatch
                                            │
                                            ├── Refresh materialized views
                                            └── Warm dashboard cache
                                                        │
              Poll GET /crm-upload/status/:id  ◄────────┘
              (every 3 seconds until complete)
```

---

## 1. Department Spreadsheet Upload

### Frontend

**View:** `views/upload/upload.ejs`
**JS:** `public/js/upload.js`

- Upload form with 5 drag-and-drop zones (one per department):
  - Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving
- File constraints: `.xlsx` / `.xls`, max 50 MB
- Date picker auto-selects next Monday as snapshot date
- Calculates FY 2025-2026 cumulative period (April 1 - report date)

### Backend

**Route:** `src/routes/upload.js` - `POST /upload/process`

**Flow:**

1. Multer receives files (temp storage at `/tmp/uploads/`, 50 MB limit)
2. Validates snapshot date is provided
3. Checks for existing snapshot at that date (returns `409` if exists, unless `overwrite=true`)
4. Creates `Snapshot` record in database
5. For each uploaded file:
   - Calls `parseDepartmentFile(filePath, department)`
   - Calls `saveDepartmentData()` to persist
6. Returns `200` (all success) or `207` (partial failures)
7. Cleans up temp files

### Department Excel Format

Each department file must contain these sheets:

| Sheet | Purpose |
|-------|---------|
| **REPORT** | Summary metrics and breakdowns |
| **RAW** (optional) | Individual gift records |
| **INSTRUCTIONS** | Template instructions (ignored) |

**REPORT sheet parsing** (`excelParser.js:53-190`) detects sections by label matching:

| Label Pattern | Extracted Data |
|---------------|---------------|
| "total gifts" | `summary.totalGifts` |
| "total amount" | `summary.totalAmount` |
| "% to goal" | `summary.pctToGoal` |
| "gift type/types" | Gift type breakdown (type, amount, %) |
| "source/sources" | Source breakdown (source, amount, %) |
| "gift by fund/funds" | Fund breakdown (name, amount, %, category) |

**RAW sheet parsing** (`excelParser.js:192-214`) extracts per-gift records:
- `primaryAddressee`, `appealId`, `splitAmount`, `fundDescription`, `giftId`, `giftType`, `giftReference`, `giftDate`, `extraField`

---

## 2. CRM Data Import

### Frontend

**View:** `views/upload/crm-upload.ejs`

Two-step workflow:

#### Step 1: Preview

- User uploads CSV/Excel file (max 300 MB)
- Frontend sends `POST /crm-upload/preview`
- Server reads headers only and returns column mapping
- UI displays:
  - Mapped columns grouped by category (gift, fund, campaign, appeal, fundraiser, soft credit, match)
  - Unmapped columns list
  - Validation: "Gift ID" column required

#### Step 2: Import

- User clicks "Import" (confirmation dialog)
- Frontend sends `POST /crm-upload/process`
- Server returns immediately with import ID
- Frontend polls `GET /crm-upload/status/:id` every 3 seconds
- Shows live progress: gifts/sec rate, total processed
- Auto-refreshes on completion

### Backend

**Route:** `src/routes/crmUpload.js`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/crm-upload/` | GET | Upload page with import history & CRM stats |
| `/crm-upload/preview` | POST | Read headers, return column mapping |
| `/crm-upload/process` | POST | Start async import |
| `/crm-upload/status/:id` | GET | Poll import progress |
| `/crm-upload/history` | GET | Last 20 imports |
| `/crm-upload/stats` | GET | Current CRM record counts |

---

## 3. Header Detection & Column Mapping

### How It Works

**File:** `src/services/crmExcelParser.js` - `autoMapColumns()` (lines 212-229)

Header detection is a **pure lookup table** approach - no AI or fuzzy matching:

```javascript
function autoMapColumns(headers) {
  const mapping = {};
  const unmapped = [];

  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    if (raw == null) continue;
    const normalized = String(raw).trim().toLowerCase();
    const field = STANDARD_COLUMN_MAP[normalized];  // Exact lookup
    if (field) {
      mapping[i] = field;
    } else if (normalized) {
      unmapped.push(String(raw).trim());
    }
  }

  return { mapping, unmapped };
}
```

**Algorithm:**

1. Iterate over each column header from the file
2. Normalize: `trim()` + `toLowerCase()`
3. Look up normalized header in `STANDARD_COLUMN_MAP`
4. If match found: record `columnIndex → internalFieldName`
5. If no match: add to `unmapped[]` list for user review

### STANDARD_COLUMN_MAP

The lookup table maps 60+ known Blackbaud NXT export headers to internal field names:

| Excel Header | Internal Field | Category |
|-------------|---------------|----------|
| `gift id` | `giftId` | Gift Core |
| `gift amount` | `giftAmount` | Gift Core |
| `gift date` | `giftDate` | Gift Core |
| `gift code` | `giftCode` | Gift Core |
| `gift status` | `giftStatus` | Gift Core |
| `payment type` | `paymentType` | Gift Core |
| `acknowledge` | `acknowledge` | Gift Core |
| `receipt` | `receipt` | Gift Core |
| `batch number` | `batchNumber` | Gift Core |
| `date added` | `dateAdded` | Gift Core |
| `date last changed` | `dateLastChanged` | Gift Core |
| `system record id` | `systemRecordId` | Constituent |
| `constituent id` | `constituentId` | Constituent |
| `first name` | `firstName` | Constituent |
| `last name` | `lastName` | Constituent |
| `email addresses\\email address` | `constituentEmail` | Constituent |
| `phone numbers\\number` | `constituentPhone` | Constituent |
| `addresses\\address` | `constituentAddress` | Constituent |
| `addresses\\city` | `constituentCity` | Constituent |
| `addresses\\state` | `constituentState` | Constituent |
| `addresses\\zip` | `constituentZip` | Constituent |
| `fund category` | `fundCategory` | Fund |
| `fund description` | `fundDescription` | Fund |
| `fund id` | `fundId` | Fund |
| `campaign id` | `campaignId` | Campaign |
| `campaign description` | `campaignDescription` | Campaign |
| `appeal category` | `appealCategory` | Appeal |
| `appeal description` | `appealDescription` | Appeal |
| `appeal id` | `appealId` | Appeal |
| `fundraiser name` | `fundraiserName` | Fundraiser |
| `fundraiser first name` | `fundraiserFirstName` | Fundraiser |
| `fundraiser credit amount` | `fundraiserAmount` | Fundraiser |
| `soft credit amount` | `softCreditAmount` | Soft Credit |
| `soft credit recipient name` | `recipientName` | Soft Credit |
| `matching gift id` | `matchGiftId` | Match |
| `matching gift date added` | `matchDateAdded` | Match |
| `matching receipt amount` | `matchReceiptAmount` | Match |

*(Partial list - full map contains 60+ entries in `crmExcelParser.js` lines 19-108)*

### Field Categories

Fields are grouped into categories that determine which database table they populate:

```
GIFT_FIELDS      → CrmGift table (core gift + constituent + fund + campaign + appeal)
FUNDRAISER_FIELDS → CrmGiftFundraiser table
SOFT_CREDIT_FIELDS → CrmGiftSoftCredit table
MATCH_FIELDS      → CrmGiftMatch table
```

### Preview Response

The `/crm-upload/preview` endpoint returns:

```json
{
  "fileName": "RE_Export_2025.csv",
  "fileSize": 267000000,
  "totalColumns": 45,
  "mappedColumns": 38,
  "unmappedColumns": ["Custom Field 1", "Notes"],
  "hasGiftId": true,
  "categories": {
    "gift": 18,
    "fund": 3,
    "campaign": 4,
    "appeal": 5,
    "fundraiser": 4,
    "softCredit": 4,
    "match": 6
  }
}
```

---

## 4. File Parsing

### CSV Parsing (Memory-Efficient Streaming)

**File:** `src/services/crmExcelParser.js`

#### Header-Only Read

`readCsvHeaders(filePath)` (lines 239-260):
- Uses Node.js `readline` + `createReadStream` to read **only the first line**
- Prevents loading 267 MB+ files into memory
- Parses the CSV header line with `csv-parse`

#### Full Stream Parse

`streamParseCsv(filePath, mapping, callbacks)` (lines 282-376):

1. Creates a read stream with `csv-parse` (skip header line via `from_line: 2`)
2. For each row:
   - Maps column indices to field names using the mapping
   - Calls `coerceValue()` for type conversion
   - Separates into 4 record types: gifts, fundraisers, soft credits, matches
   - Deduplicates within batch (by `giftId` + key field)
3. Flushes to database every 25 rows via callbacks
4. Uses `for await` loop for backpressure handling

### Excel Parsing (In-Memory)

`parseCrmExcel(filePath, customMapping)` (lines 382-470):

- Loads entire file with `xlsx` library
- Converts first sheet to JSON with header row
- Runs `autoMapColumns()` on headers
- Processes all rows, separates into Maps/arrays by record type
- Suitable for smaller `.xlsx` / `.xls` files

### Type Coercion

`coerceValue(field, raw)` (lines 197-202):

| Field Type | Conversion |
|-----------|-----------|
| Date fields (`giftDate`, `dateAdded`, etc.) | Handles Excel serial dates, ISO strings, JS Date objects |
| Amount fields (`giftAmount`, `softCreditAmount`, etc.) | Strips `$`, `,`, spaces; parses to float |
| Boolean fields (`acknowledge`, `receipt`, etc.) | `yes/true/1/y` → `true`; `no/false/0/n` → `false` |
| String fields (default) | Trim whitespace, convert empty to `null` |

---

## 5. Department Classification

**File:** `src/services/crmDepartmentClassifier.js`

Each imported CRM gift is automatically classified into one of 5 departments using **rule-based regex pattern matching** (not AI).

### Classification Priority (highest to lowest)

| Priority | Field(s) Checked | Logic |
|----------|-----------------|-------|
| 1 | `appealCategory`, `fundCategory` | Regex match against department patterns |
| 2 | `giftCode` | Regex match against department code patterns |
| 3 | `appealDescription` + `campaignDescription` | Combined text regex match |
| 4 | `fundDescription` | Regex match against fund patterns |
| 5 | `giftAmount` | `>= $10,000` → Major Gifts |
| Default | — | Annual Giving |

### Regex Patterns

```
Legacy Giving:  /legacy|planned|bequest|estate|endow/i
Events:         /event|gala|dinner|auction|golf|benefit|tournament/i
Major Gifts:    /major|leadership|principal|capital|transform/i
Direct Mail:    /mail|dm|solicitation|postal|letter/i
Annual Giving:  /annual|giving|phonathon|fund.?drive|unrestrict/i
```

---

## 6. Database Schema

### CrmImport (Import Log)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenantId` | UUID | Tenant identifier |
| `uploadedBy` | UUID | User who initiated import |
| `fileName` | String | Original file name |
| `fileSize` | Integer | File size in bytes |
| `status` | Enum | `processing` / `completed` / `failed` |
| `totalRows` | Integer | Total rows processed |
| `giftsUpserted` | Integer | Gifts inserted/updated |
| `fundraisersUpserted` | Integer | Fundraiser records |
| `softCreditsUpserted` | Integer | Soft credit records |
| `matchesUpserted` | Integer | Match records |
| `columnMapping` | JSONB | Column index → field mapping used |
| `errorMessage` | Text | Error details if failed |

### CrmGift

Core gift record with constituent, fund, campaign, and appeal data. Includes pre-computed `department` field from classification.

### CrmGiftFundraiser / CrmGiftSoftCredit / CrmGiftMatch

Related records linked to gifts via `giftId` foreign key.

---

## 7. Key Files Reference

| File | Purpose |
|------|---------|
| `views/upload/upload.ejs` | Department upload form |
| `views/upload/crm-upload.ejs` | CRM upload form + inline JS |
| `public/js/upload.js` | Department upload frontend logic |
| `src/routes/upload.js` | Department upload API routes |
| `src/routes/crmUpload.js` | CRM upload API routes |
| `src/services/excelParser.js` | Department Excel file parser |
| `src/services/crmExcelParser.js` | CRM CSV/Excel parser + `autoMapColumns()` |
| `src/services/crmImportService.js` | CRM import orchestration |
| `src/services/crmDepartmentClassifier.js` | Rule-based department assignment |
| `src/models/crmImport.js` | Import log model |
| `src/models/crmGift.js` | Gift record model |
| `src/models/crmGiftFundraiser.js` | Fundraiser credit model |
| `src/models/crmGiftSoftCredit.js` | Soft credit model |
| `src/models/crmGiftMatch.js` | Matching gift model |

---

## Summary

- **Header detection is not AI-powered.** It uses a static lookup table (`STANDARD_COLUMN_MAP`) that maps 60+ known Blackbaud RE NXT column headers to internal field names via case-insensitive exact string matching.
- **Department classification is rule-based.** Regex patterns on appeal/fund/campaign metadata assign gifts to one of 5 departments.
- **Large file handling uses streaming.** CSV files are parsed row-by-row with backpressure support to handle 267 MB+ exports without memory issues.
- **The import is destructive.** Each CRM import deletes all existing tenant data and re-imports from scratch (fresh import strategy).
- **AI (Claude) is used only post-import** for analytics, dashboards, trend analysis, and content generation - never for parsing or header detection.
