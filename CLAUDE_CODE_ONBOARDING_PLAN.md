# Claude Code Task: Build Bulletproof Multi-Tenant Onboarding System for Fund-Raise

## Context

Fund-Raise is a Node.js/Express/PostgreSQL philanthropy dashboard (monolithic, EJS-templated, no SPA). It currently serves one tenant (TBRHSF) and uses a static lookup table to map Blackbaud RE NXT export headers to internal fields, plus hardcoded regex patterns to classify gifts into departments. We need to make onboarding self-serve so any foundation can sign up, upload their data, and have a working dashboard — without us being on a Zoom call with them.

The core challenge: every foundation uses Raiser's Edge NXT differently. Some track events as campaigns, others as appeals. Some don't have an events department at all. Data quality varies wildly, especially at small nonprofits. The onboarding system must handle all of this gracefully.

## Tech Stack (do not change)
- Runtime: Node.js (v18+)
- Backend: Express.js
- Templating: EJS (server-rendered)
- ORM: Sequelize
- Database: PostgreSQL (Render-hosted)
- AI: Anthropic Claude API (claude-sonnet-4-20250514)
- Auth: Passport.js + Google OAuth 2.0
- File uploads: Multer
- Excel parsing: xlsx library
- CSS: Custom CSS with Manrope font
- Hosting: Render.com

## Brand (apply to all new UI)
- Font: Manrope (Google Fonts) — all weights 300-800
- Primary dark: #1A223D (navy)
- Primary accent: #3434D6 (indigo)
- Blue gradient: #1960F9 → #0D8CFF
- Cyan gradient: #12DEFF → #29C8F9
- Light surface: #EFF1F4 (snow)
- Grayscale: Cloud #EDEFF7, Smoke #D3D6E0, Steel #BCBFCC, Space #9DA2B3, Graphite #6E7180, Arsenic #40424D, Phantom #1E1E24
- Type scale: H1 64px, H2 48px, Sub1 32px, Sub2 24px, P1 18px, P2 16px

## Overview of Changes

There are 6 work streams. Build them in this order:

1. Expand the static header mapper with missing contact/address fields
2. Build the data privacy selection system
3. Build the guided query builder
4. Replace the hardcoded department classifier with AI-powered inference
5. Build the review/confirmation step with data health scorecard
6. Wire it all together into a multi-step onboarding wizard

---

## Work Stream 1: Expand Header Mapper

**File:** `src/services/crmExcelParser.js`

Add these entries to `STANDARD_COLUMN_MAP` (the existing static lookup table). These are standard RE NXT export headers that weren't included because our first tenant didn't export contact fields:

```javascript
// Additional constituent contact fields
'addresses\\country': 'constituentCountry',
'addresses\\type': 'addressType',
'addresses\\do not mail': 'addressDoNotMail',
'phone numbers\\type': 'phoneType',
'phone numbers\\do not call': 'phoneDoNotCall',
'email addresses\\type': 'emailType',
'email addresses\\do not email': 'emailDoNotEmail',

// Common header variations (some orgs export with slightly different headers)
'gift amt': 'giftAmount',
'gift amount': 'giftAmount',
'amt': 'giftAmount',
'gift dt': 'giftDate',
'date': 'giftDate',
'rec id': 'systemRecordId',
'record id': 'systemRecordId',
'id': 'giftId',
'lookup id': 'constituentLookupId',
'constituent lookup id': 'constituentLookupId',
'name': 'constituentName',
'primary addressee': 'primaryAddressee',
'addressee': 'primaryAddressee',
'fund': 'fundDescription',
'fund desc': 'fundDescription',
'campaign': 'campaignDescription',
'campaign desc': 'campaignDescription',
'appeal': 'appealDescription',
'appeal desc': 'appealDescription',
'package': 'packageDescription',
'package description': 'packageDescription',
'package id': 'packageId',
'gift type': 'giftType',
'type': 'giftType',
'pay method': 'paymentType',
'payment method': 'paymentType',
'reference': 'giftReference',
'gift reference': 'giftReference',
'constituent code': 'constituentCode',
'constituent codes\\description': 'constituentCode',
'solicit codes\\description': 'solicitCode',
```

Also add these new fields to the CrmGift model (`src/models/crmGift.js`) — add columns for any fields above that don't already exist in the model:
- `constituentCountry` (STRING)
- `addressType` (STRING)
- `addressDoNotMail` (BOOLEAN)
- `phoneType` (STRING)
- `phoneDoNotCall` (BOOLEAN)
- `emailType` (STRING)
- `emailDoNotEmail` (BOOLEAN)
- `constituentLookupId` (STRING)
- `constituentName` (STRING)
- `constituentCode` (STRING)
- `solicitCode` (STRING)
- `packageDescription` (STRING)
- `packageId` (STRING)

---

## Work Stream 2: Data Privacy Selection

### Concept

Before uploading data, the tenant admin selects which data categories they want to include. This selection determines:
- What fields appear in the guided query builder instructions (Work Stream 3)
- Which columns get mapped during import (unmapped categories are silently ignored)
- Which dashboard modules/sections are visible vs hidden

### Database

Add a new model `TenantDataConfig` (`src/models/tenantDataConfig.js`):

```javascript
{
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.UUID, allowNull: false, unique: true },
  
  // Data categories — all boolean, default true except gifts which is always true
  includeGiftCore: { type: DataTypes.BOOLEAN, defaultValue: true },        // Always true, not user-configurable
  includeConstituentContact: { type: DataTypes.BOOLEAN, defaultValue: true }, // Email, phone, address
  includeCampaigns: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeAppeals: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeFunds: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeFundraiserCredits: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeSoftCredits: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeMatchingGifts: { type: DataTypes.BOOLEAN, defaultValue: true },
  includeConstituentCodes: { type: DataTypes.BOOLEAN, defaultValue: true },
  
  // Fiscal year configuration
  fiscalYearStartMonth: { type: DataTypes.INTEGER, defaultValue: 4 },  // 1-12, default April
  
  // AI-inferred department configuration (populated after first import)
  detectedDepartments: { type: DataTypes.JSONB, defaultValue: null },
  // Structure: { departments: ['Annual Giving', 'Events', ...], classificationRules: {...}, confidence: 0.92, inferredAt: timestamp }
  departmentClassificationRules: { type: DataTypes.JSONB, defaultValue: null },
  // Structure: [{ department: 'Events', field: 'appealDescription', pattern: 'gala|dinner|golf|auction', priority: 1 }, ...]
  
  // Onboarding state tracking
  onboardingStep: { type: DataTypes.INTEGER, defaultValue: 1 },  // 1-6
  onboardingCompletedAt: { type: DataTypes.DATE, defaultValue: null },
  
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE
}
```

Associate with Tenant: `Tenant.hasOne(TenantDataConfig)` and `TenantDataConfig.belongsTo(Tenant)`

### Route

Add `src/routes/onboarding.js`:

- `GET /onboarding` — render the onboarding wizard (determines which step to show based on `onboardingStep`)
- `POST /onboarding/data-config` — save data privacy selections + fiscal year
- `GET /onboarding/query-guide` — render the guided query builder with field checklist based on saved data config
- `POST /onboarding/upload-preview` — same as existing `/crm-upload/preview` but filtered by data config
- `POST /onboarding/upload-process` — triggers import + AI inference
- `GET /onboarding/review` — shows data health scorecard + detected departments
- `POST /onboarding/confirm` — finalizes onboarding, sets `onboardingCompletedAt`
- `GET /onboarding/status/:importId` — poll import + inference progress

### UI

Create `views/onboarding/data-config.ejs`:

Build a clean card-based UI where each data category is a toggleable card. Layout should be a grid of cards, each with:
- Category name (bold, Manrope SemiBold)
- Brief description of what's included
- Toggle switch (on/off)
- "Gift Core" card is always on and visually locked (slightly different styling, no toggle)

Categories to display:
1. **Gift Data** (always on, locked) — Gift ID, amount, date, type, status, payment method, batch number. "Required for Fund-Raise to work."
2. **Constituent Contact Info** — Name, email, phone, address. "Enable donor lookup and contact details."
3. **Campaigns** — Campaign ID, name, category. "Track giving by campaign."
4. **Appeals** — Appeal ID, name, category. "Track giving by appeal/solicitation."
5. **Funds** — Fund ID, name, category. "Track giving by designated fund."
6. **Fundraiser Credits** — Fundraiser name, credit amount. "Track gift officer assignments."
7. **Soft Credits** — Recipient name, amount. "Track soft credit allocations."
8. **Matching Gifts** — Match ID, amount, date. "Track corporate matching."
9. **Constituent Codes** — Code descriptions. "Donor segmentation and classification."

Also include a fiscal year start month dropdown (January through December, default April).

Style with Fund-Raise brand colors. Use navy (#1A223D) for card headers when toggled on, snow (#EFF1F4) background for the card body, indigo (#3434D6) for the toggle accent color.

---

## Work Stream 3: Guided Query Builder

### Concept

After the user saves their data config, show them step-by-step instructions for running the RE NXT export query. The field checklist dynamically adjusts based on what categories they selected.

### UI

Create `views/onboarding/query-guide.ejs`:

This should be a numbered step-by-step guide with the following sections:

**Step 1: Open Query Editor**
- Text: "In Raiser's Edge NXT, go to Analysis → Query → New Query"
- Text: "Select Gift as the query type"
- Text: "Select Dynamic as the query format"

**Step 2: Set Output Fields**
- Dynamically generated checklist based on their data config
- Each field shows the exact RE NXT field path the user needs to add
- Group fields by category with headers matching their selected categories
- Include a "Select All" checkbox per category

The field checklist should be generated server-side based on `TenantDataConfig`. Here is the master field list by category:

```javascript
const QUERY_FIELD_GUIDE = {
  giftCore: {
    label: 'Gift Data',
    alwaysIncluded: true,
    fields: [
      'Gift ID',
      'Gift Amount', 
      'Gift Date',
      'Gift Code',
      'Gift Status',
      'Gift Type',
      'Payment Type',
      'Acknowledge',
      'Receipt',
      'Batch Number',
      'Date Added',
      'Date Last Changed',
      'System Record ID',
      'Constituent ID',
      'First Name',
      'Last Name',
      'Gift Reference'
    ]
  },
  constituentContact: {
    label: 'Constituent Contact Info',
    configKey: 'includeConstituentContact',
    fields: [
      'Email Addresses\\Email Address',
      'Email Addresses\\Type',
      'Email Addresses\\Do Not Email',
      'Phone Numbers\\Number',
      'Phone Numbers\\Type',
      'Phone Numbers\\Do Not Call',
      'Addresses\\Address',
      'Addresses\\City',
      'Addresses\\State',
      'Addresses\\ZIP',
      'Addresses\\Country',
      'Addresses\\Type',
      'Addresses\\Do Not Mail'
    ]
  },
  campaigns: {
    label: 'Campaigns',
    configKey: 'includeCampaigns',
    fields: [
      'Campaign ID',
      'Campaign Description',
      'Campaign Category',
      'Campaign Start Date',
      'Campaign End Date'
    ]
  },
  appeals: {
    label: 'Appeals',
    configKey: 'includeAppeals',
    fields: [
      'Appeal ID',
      'Appeal Description',
      'Appeal Category'
    ]
  },
  funds: {
    label: 'Funds',
    configKey: 'includeFunds',
    fields: [
      'Fund ID',
      'Fund Description',
      'Fund Category'
    ]
  },
  fundraiserCredits: {
    label: 'Fundraiser Credits',
    configKey: 'includeFundraiserCredits',
    fields: [
      'Fundraiser Name',
      'Fundraiser First Name',
      'Fundraiser Credit Amount'
    ]
  },
  softCredits: {
    label: 'Soft Credits',
    configKey: 'includeSoftCredits',
    fields: [
      'Soft Credit Amount',
      'Soft Credit Recipient Name',
      'Soft Credit Constituent ID'
    ]
  },
  matchingGifts: {
    label: 'Matching Gifts',
    configKey: 'includeMatchingGifts',
    fields: [
      'Matching Gift ID',
      'Matching Gift Date Added',
      'Matching Receipt Amount'
    ]
  },
  constituentCodes: {
    label: 'Constituent Codes',
    configKey: 'includeConstituentCodes',
    fields: [
      'Constituent Codes\\Description'
    ]
  }
};
```

Only show categories where the corresponding `TenantDataConfig` value is `true`.

**Step 3: Export**
- Text: "Click the Results tab to run the query"
- Text: "Click the export icon (disk icon) to download as CSV"
- Text: "Save the file — you'll upload it in the next step"

**Step 4: Upload**
- A file drop zone (reuse the existing drag-and-drop pattern from `views/upload/crm-upload.ejs`)
- Accept .csv, .xlsx, .xls — max 300 MB
- When file is dropped, trigger the preview step (Work Stream 4 integration)

Include a "Copy field list" button that copies all the required field names to the clipboard as a newline-separated list, so users can reference it while building their query in RE NXT.

Also include a collapsible "Save these instructions" section that persists the query configuration so they can reference it for future re-uploads. Store this in `TenantDataConfig.queryInstructions` (add a JSONB column for this).

---

## Work Stream 4: AI-Powered Department Inference

This is the most critical work stream. It replaces the hardcoded regex department classifier with a per-tenant AI inference system.

### How It Works

After the CRM import completes (all rows are in the database), run an AI inference step:

1. **Sample the data.** Query 500 random gifts from `CrmGift` for this tenant. Include all available fields: giftAmount, giftDate, giftType, fundDescription, fundCategory, fundId, campaignDescription, campaignId, campaignCategory, appealDescription, appealId, appealCategory, giftCode, constituentCode, packageDescription.

2. **Build the inference prompt.** Send the sample to Claude with a carefully structured prompt (see below).

3. **Parse the response.** Claude returns structured JSON with detected departments and classification rules.

4. **Store the rules.** Save to `TenantDataConfig.detectedDepartments` and `TenantDataConfig.departmentClassificationRules`.

5. **Reclassify all gifts.** Run the new rules against every gift in the tenant's CrmGift table, updating the `department` column.

### The Inference Prompt

Create a new service `src/services/departmentInferenceService.js`:

```javascript
async function inferDepartmentStructure(tenantId) {
  // 1. Pull 500 random gifts
  const sampleGifts = await CrmGift.findAll({
    where: { tenantId },
    order: Sequelize.literal('RANDOM()'),
    limit: 500,
    attributes: [
      'giftAmount', 'giftDate', 'giftType', 'giftCode',
      'fundDescription', 'fundCategory', 'fundId',
      'campaignDescription', 'campaignId',
      'appealDescription', 'appealId', 'appealCategory',
      'constituentCode', 'packageDescription'
    ],
    raw: true
  });

  // 2. Also get distinct values for key fields to show patterns
  const distinctFunds = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('fundDescription')), 'value']],
    raw: true
  });
  const distinctCampaigns = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('campaignDescription')), 'value']],
    raw: true
  });
  const distinctAppeals = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('appealDescription')), 'value']],
    raw: true
  });
  const distinctGiftCodes = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('giftCode')), 'value']],
    raw: true
  });
  const distinctFundCategories = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('fundCategory')), 'value']],
    raw: true
  });
  const distinctAppealCategories = await CrmGift.findAll({
    where: { tenantId },
    attributes: [[Sequelize.fn('DISTINCT', Sequelize.col('appealCategory')), 'value']],
    raw: true
  });

  // 3. Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: buildInferencePrompt(sampleGifts, {
        funds: distinctFunds.map(r => r.value).filter(Boolean),
        campaigns: distinctCampaigns.map(r => r.value).filter(Boolean),
        appeals: distinctAppeals.map(r => r.value).filter(Boolean),
        giftCodes: distinctGiftCodes.map(r => r.value).filter(Boolean),
        fundCategories: distinctFundCategories.map(r => r.value).filter(Boolean),
        appealCategories: distinctAppealCategories.map(r => r.value).filter(Boolean)
      })
    }]
  });

  // 4. Parse response and store
  const result = JSON.parse(response.content[0].text);
  
  await TenantDataConfig.update({
    detectedDepartments: {
      departments: result.departments,
      confidence: result.confidence,
      inferredAt: new Date(),
      summary: result.summary
    },
    departmentClassificationRules: result.classificationRules
  }, { where: { tenantId } });

  // 5. Reclassify all gifts using new rules
  await reclassifyGifts(tenantId, result.classificationRules);
}
```

### The Prompt Template

```javascript
function buildInferencePrompt(sampleGifts, distinctValues) {
  return `You are analyzing fundraising data from a nonprofit foundation that uses Blackbaud Raiser's Edge NXT. Your job is to determine what fundraising departments this organization operates and create classification rules for assigning each gift to a department.

IMPORTANT CONTEXT:
- Every nonprofit organizes their RE NXT data differently
- Some track events as campaigns, others as appeals, others as funds
- Some foundations don't have certain departments at all (e.g., no Events department)
- Campaign, Fund, and Appeal fields are used inconsistently across organizations
- Data quality varies — some fields may be empty, inconsistent, or poorly maintained
- Common fundraising departments include: Annual Giving, Major Gifts, Events, Direct Mail, Legacy/Planned Giving, Capital Campaign, Corporate/Foundation Relations, Stewardship
- Not every organization will have all of these — only detect departments that clearly exist in the data

DISTINCT VALUES IN THIS DATABASE:

Fund Descriptions: ${JSON.stringify(distinctValues.funds.slice(0, 100))}

Fund Categories: ${JSON.stringify(distinctValues.fundCategories.slice(0, 50))}

Campaign Descriptions: ${JSON.stringify(distinctValues.campaigns.slice(0, 100))}

Appeal Descriptions: ${JSON.stringify(distinctValues.appeals.slice(0, 100))}

Appeal Categories: ${JSON.stringify(distinctValues.appealCategories.slice(0, 50))}

Gift Codes: ${JSON.stringify(distinctValues.giftCodes.slice(0, 50))}

SAMPLE OF 500 GIFTS (showing key classification fields):
${JSON.stringify(sampleGifts.slice(0, 500), null, 0)}

INSTRUCTIONS:
1. Analyze the distinct values and sample data to determine which fundraising departments this organization operates.
2. Determine HOW they organize their data — do they use campaigns, appeals, funds, or gift codes to distinguish departments? Which field is their primary organizational field?
3. Create classification rules that can be applied programmatically to assign every gift to a department.
4. If a gift doesn't match any rule, assign it to a default department (usually Annual Giving or General).
5. Be conservative — only detect departments you're confident exist based on clear patterns in the data.

Respond with ONLY valid JSON (no markdown, no backticks, no preamble) in this exact structure:

{
  "departments": ["Annual Giving", "Events", "Major Gifts"],
  "summary": "This foundation tracks 3 departments. Events are identified through appeal descriptions containing event names. Major gifts are identified by gift amounts over $10,000. Everything else falls under Annual Giving.",
  "primaryOrganizationalField": "appealDescription",
  "dataStructureNotes": "This organization uses appeals to track individual solicitations and events. Campaigns appear to represent fiscal years. Funds track designated vs unrestricted giving.",
  "confidence": 0.87,
  "classificationRules": [
    {
      "department": "Events",
      "priority": 1,
      "field": "appealDescription",
      "matchType": "regex",
      "pattern": "gala|dinner|golf|auction|tournament|walk|run|concert",
      "caseSensitive": false,
      "rationale": "Appeal descriptions contain event-specific names"
    },
    {
      "department": "Events",
      "priority": 2,
      "field": "appealCategory",
      "matchType": "exact",
      "pattern": "Special Event",
      "caseSensitive": false,
      "rationale": "Appeal category explicitly labels events"
    },
    {
      "department": "Major Gifts",
      "priority": 3,
      "field": "giftAmount",
      "matchType": "gte",
      "pattern": "10000",
      "rationale": "Gifts of $10,000+ are typically major gifts"
    },
    {
      "department": "Annual Giving",
      "priority": 99,
      "field": "*",
      "matchType": "default",
      "pattern": "",
      "rationale": "Default department for unclassified gifts"
    }
  ]
}`;
}
```

### Reclassification Function

```javascript
async function reclassifyGifts(tenantId, rules) {
  // Sort rules by priority (lowest number = highest priority)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);
  
  // Process in batches of 500
  const batchSize = 500;
  let offset = 0;
  let totalUpdated = 0;
  
  while (true) {
    const gifts = await CrmGift.findAll({
      where: { tenantId },
      limit: batchSize,
      offset,
      raw: true
    });
    
    if (gifts.length === 0) break;
    
    for (const gift of gifts) {
      let department = null;
      
      for (const rule of sortedRules) {
        if (rule.matchType === 'default') {
          department = rule.department;
          break;
        }
        
        const fieldValue = gift[rule.field];
        if (fieldValue == null) continue;
        
        let matched = false;
        switch (rule.matchType) {
          case 'regex':
            matched = new RegExp(rule.pattern, rule.caseSensitive ? '' : 'i').test(String(fieldValue));
            break;
          case 'exact':
            matched = rule.caseSensitive 
              ? String(fieldValue).trim() === rule.pattern 
              : String(fieldValue).trim().toLowerCase() === rule.pattern.toLowerCase();
            break;
          case 'gte':
            matched = parseFloat(fieldValue) >= parseFloat(rule.pattern);
            break;
          case 'contains':
            matched = rule.caseSensitive
              ? String(fieldValue).includes(rule.pattern)
              : String(fieldValue).toLowerCase().includes(rule.pattern.toLowerCase());
            break;
        }
        
        if (matched) {
          department = rule.department;
          break;
        }
      }
      
      if (department && department !== gift.department) {
        await CrmGift.update({ department }, { where: { id: gift.id } });
        totalUpdated++;
      }
    }
    
    offset += batchSize;
  }
  
  return totalUpdated;
}
```

### Updating the Existing Classifier

Modify `src/services/crmDepartmentClassifier.js`:

- Keep the existing `classifyDepartment()` function as a fallback
- Add a new function `classifyDepartmentByTenantRules(gift, rules)` that uses the AI-generated rules from `TenantDataConfig`
- In the import flow (`src/services/crmImportService.js`), check if the tenant has `departmentClassificationRules` set:
  - If yes: use `classifyDepartmentByTenantRules()`
  - If no (first import, onboarding in progress): use the existing `classifyDepartment()` as initial classification, then run AI inference after import completes and reclassify

---

## Work Stream 5: Review & Confirmation Step

### Data Health Scorecard

After import + AI inference completes, show the user a summary of what was detected.

Create `views/onboarding/review.ejs`:

**Section 1: Import Summary**
- Total gifts imported: X
- Date range: [earliest gift date] to [latest gift date]  
- Columns mapped: X of Y (Z unmapped)
- If there are unmapped columns, list them with a note: "These columns were not recognized and were skipped. This is normal — Fund-Raise focuses on the core fundraising fields."

**Section 2: Data Quality Indicators**
Show a set of metric cards:
- **Gift completeness**: % of gifts with all core fields populated (amount, date, type)
- **Fund coverage**: % of gifts with a fund description
- **Campaign coverage**: % of gifts with a campaign description  
- **Appeal coverage**: % of gifts with an appeal description
- Each card should have a color indicator: green (>80%), amber (50-80%), red (<50%)
- If a category was opted out in data config, show it as "Not included" in gray

**Section 3: Detected Departments**
- Display the AI's department detection results
- Show each detected department as a card with:
  - Department name
  - Number of gifts classified to it
  - Total dollar amount
  - The classification rationale (from the AI response)
- Show the AI's confidence score
- Include an "Adjust" button that lets the user rename departments, merge two departments, or remove a department (which reclassifies those gifts to the default)

**Section 4: Data Structure Summary**
- Display the AI's `dataStructureNotes` — a plain-English explanation of how this foundation uses campaigns vs appeals vs funds
- This gets stored and injected into Ask Fund-Raise's system prompt for this tenant

**Confirm Button**
- "Launch Dashboard" button at the bottom
- On click: sets `onboardingCompletedAt`, refreshes materialized views, warms cache, redirects to main dashboard

---

## Work Stream 6: Onboarding Wizard Shell

### UI Structure

Create `views/onboarding/wizard.ejs` as the parent template. This is a multi-step wizard with a progress indicator at the top.

**Progress bar**: Horizontal stepper showing 5 steps:
1. Organization Setup (existing — org name, admin user creation via Google OAuth) 
2. Data Configuration (Work Stream 2)
3. Export Guide (Work Stream 3)  
4. Upload & Analysis (Work Stream 3's upload zone + Work Stream 4's AI inference)
5. Review & Launch (Work Stream 5)

Each step is a separate EJS partial loaded into the wizard shell. Navigation:
- "Back" and "Next" buttons at the bottom
- "Next" validates the current step before proceeding
- Step 4 (Upload) has no "Next" — it auto-advances when import + inference completes
- Step 5 has "Launch Dashboard" instead of "Next"

**Routing logic**: When a user hits `GET /onboarding`, check their `TenantDataConfig.onboardingStep`. If `onboardingCompletedAt` is set, redirect to the main dashboard. Otherwise, render the wizard at their current step. This means if they close the browser and come back, they resume where they left off.

**Middleware**: Add middleware to all non-onboarding routes that checks if the current user's tenant has completed onboarding. If not, redirect to `/onboarding`. Exceptions: `/auth/*` routes, `/api/*` routes, static assets.

### Styling

The wizard should feel premium and trustworthy. These are nonprofit executives who may not be tech-savvy — the UI needs to feel simple and guided, not overwhelming.

- Use the Fund-Raise brand colors (navy backgrounds for step headers, snow for content areas)
- Large, readable text (Manrope, 18px minimum for body copy in the wizard)
- Generous spacing — don't cram fields together
- Each step should have a clear headline explaining what this step does and why
- Progress indicator should show completed steps with a checkmark icon, current step highlighted in indigo, future steps in gray

---

## Work Stream 7: Dashboard Degradation Logic

When a tenant has opted out of certain data categories, the dashboard must gracefully hide features that depend on missing data.

### Implementation

Create a utility function `src/utils/featureFlags.js`:

```javascript
function getEnabledFeatures(tenantDataConfig) {
  return {
    showConstituentDetails: tenantDataConfig.includeConstituentContact,
    showCampaignAnalysis: tenantDataConfig.includeCampaigns,
    showAppealAnalysis: tenantDataConfig.includeAppeals,
    showFundBreakdown: tenantDataConfig.includeFunds,
    showFundraiserCredits: tenantDataConfig.includeFundraiserCredits,
    showSoftCredits: tenantDataConfig.includeSoftCredits,
    showMatchingGifts: tenantDataConfig.includeMatchingGifts,
    showConstituentCodes: tenantDataConfig.includeConstituentCodes
  };
}
```

Pass this to every EJS template via middleware. In the templates, conditionally render sections:

```ejs
<% if (features.showCampaignAnalysis) { %>
  <!-- Campaign breakdown charts -->
<% } %>
```

The AI system prompt for Ask Fund-Raise should also include a note about which data categories are available:

```
This foundation has included the following data categories: Gift Data, Appeals, Funds.
The following categories were NOT included: Constituent Contact Info, Campaigns, Fundraiser Credits, Soft Credits, Matching Gifts.
Do not reference or query fields from excluded categories. If the user asks about excluded data, explain that their organization chose not to include that data and suggest they can update their data configuration in Settings.
```

---

## Important Notes

1. **Do not break existing functionality.** The current CRM upload flow at `/crm-upload/*` should continue to work for existing tenants. The onboarding wizard is for NEW tenants. Existing tenants (where `onboardingCompletedAt` is already set or where there is no `TenantDataConfig` record) should skip the onboarding flow entirely.

2. **The AI inference is a one-time step during onboarding**, but should be re-runnable. Add a "Re-analyze data structure" button in Settings that re-runs the inference with the current data. This is useful after a subsequent upload if the foundation's data changes.

3. **Error handling on the AI inference step is critical.** If Claude's response isn't valid JSON, or if the response structure doesn't match the expected schema, catch the error gracefully. Show the user a message like "We couldn't automatically detect your departments. You can set them up manually or try re-uploading." Provide a manual department configuration fallback — simple form where they name their departments and write basic rules.

4. **The import is still destructive** (deletes and re-imports). This is fine. The AI inference re-runs after each import, so department rules stay current.

5. **Test with TBRHSF data.** After building, the existing TBRHSF data should still work. Create a `TenantDataConfig` record for TBRHSF with all categories enabled, fiscal year starting April, and run the AI inference on the existing data to verify it produces sensible department rules that match or improve upon the current hardcoded regex patterns.

6. **Add the new header mapper entries (Work Stream 1) to the `coerceValue()` function in `crmExcelParser.js`** — specifically, the new boolean fields (`addressDoNotMail`, `phoneDoNotCall`, `emailDoNotEmail`) need the yes/true/1 → true coercion.

7. **The department weekly snapshot upload system is DEPRECATED.** The following files and features are legacy and being sunsetted: `src/routes/upload.js`, `src/services/excelParser.js`, `public/js/upload.js`, `views/upload/upload.ejs`, and the `Snapshot`, `DepartmentSummary`, `GiftTypeBreakdown`, `SourceBreakdown`, `FundBreakdown`, `RawGift` models. Do NOT modify, reference, or integrate with any of these files. Do not wire any onboarding or dashboard logic into the snapshot system. All dashboard data should come exclusively from the CRM import pipeline (`/crm-upload/*`, `crmExcelParser.js`, `crmImportService.js`, `CrmGift` model and related tables).
