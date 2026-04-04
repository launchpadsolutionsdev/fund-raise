# Raiser's Edge NXT Knowledge Base

> Comprehensive reference for fundraising professionals using Blackbaud Raiser's Edge NXT (RE NXT). Covers both the web view (NXT interface) and the database view (classic RE interface).

---

## Web View vs. Database View

RE NXT has two interfaces:

- **Web view** — The modern browser-based interface at https://app.blackbaud.com. Best for quick lookups, lists, dashboards, and everyday tasks. Features a streamlined UI with constituent summaries, action reminders, and smart lists.
- **Database view** — The classic Windows-based Raiser's Edge interface, accessible via "Go to database view" from the web view. Required for advanced operations: traditional queries, batch entry, import/export, global changes, and detailed configuration.

### When to Use Which

| Task | Web View | Database View |
|------|----------|---------------|
| Look up a constituent | Yes | Yes |
| Create a smart list / filter | Yes | No (use Query) |
| Build a traditional query | No | Yes |
| Enter a single gift | Yes | Yes |
| Batch gift entry | No | Yes |
| Run reports | Limited | Full |
| Import data | No | Yes |
| Export data | Limited | Yes |
| Merge duplicates | Yes (basic) | Yes (advanced) |
| Manage acknowledgements | No | Yes |
| Global changes | No | Yes |
| Configure code tables | No | Yes |

---

## Queries

### Understanding Queries vs. Lists

- **Lists (web view)** — Also called "smart lists." Created in the web view using filters. Good for simple filtering (e.g., all constituents in a city). Limited filter options compared to queries. Found under **Lists** in the left navigation.
- **Queries (database view)** — The traditional, powerful data extraction tool. Supports complex AND/OR logic, nested criteria, output field selection, and multiple query types. Found under **Query** in the database view menu bar.

### Query Types

| Query Type | What It Queries | Common Uses |
|------------|----------------|-------------|
| **Constituent** | Donor/organization records | Mailing lists, donor segments, prospect lists |
| **Gift** | Individual gift transactions | Gift reports, acknowledgement lists, tax receipt runs |
| **Action** | Actions/tasks on constituents | Follow-up lists, stewardship tracking |
| **Membership** | Membership records | Renewal lists, lapsed member reports |
| **Event** | Event registrations | Attendee lists, event performance |
| **Campaign** | Campaign records | Campaign performance analysis |
| **Participant** | Event participants | Event-specific queries |

### How to Create a New Query (Database View)

1. Open the database view
2. Go to **Query** from the top menu bar (or press Ctrl+Q)
3. Click **New Query** (or File > New)
4. Select the query type (e.g., Constituent, Gift)
5. Choose **Dynamic** (updates each time) or **Static** (snapshot in time)
6. Set your criteria in the **Criteria** tab:
   - Browse the available fields in the left panel
   - Double-click a field to add it as a filter
   - Set the operator (equals, greater than, between, etc.) and value
   - Use AND/OR logic to combine multiple criteria
7. Set your output in the **Output** tab:
   - Browse available fields in the left panel
   - Double-click to add columns to your output
   - Drag to reorder columns
8. Optionally set **Sort** tab for ordering
9. Click the **Run** button (or press F5) to preview results
10. Save the query: File > Save As, give it a name and category

### AND vs. OR Logic in Queries

- **AND** — All criteria must be true (narrows results). "Donors who gave $1,000+ AND live in Thunder Bay"
- **OR** — Any criterion can be true (broadens results). "Donors who gave to Fund A OR Fund B"
- You can nest AND/OR groups by right-clicking criteria and selecting "Add AND Group" or "Add OR Group"

### Common Query Examples

#### All donors who gave $1,000+ in current fiscal year
- Query type: **Gift**
- Criteria:
  - Gift > Date: Between [fiscal year start] AND [today]
  - Gift > Amount: Greater than or equal to 1000
- Output: Constituent name, Gift amount, Gift date, Fund, Appeal
- Sort: Gift amount descending

#### All donors with no gift in the last 12 months (lapsed donors)
- Query type: **Constituent**
- Criteria:
  - Gift Information > Date of Last Gift: Less than [12 months ago]
  - OR Gift Information > Date of Last Gift: Is blank
- Output: Constituent name, Last gift date, Last gift amount, Total giving

#### Monthly recurring donors
- Query type: **Gift**
- Criteria:
  - Gift > Type: Equals "Recurring Gift"
  - Gift > Gift Status: Equals "Active"
- Output: Constituent name, Gift amount, Frequency, Start date, Fund

#### Donors by postal code (for regional analysis)
- Query type: **Constituent**
- Criteria:
  - Address > Preferred Address > ZIP/Postal Code: Starts with "P7" (Thunder Bay area)
- Output: Constituent name, Address, Total giving, Last gift date

#### Gifts to a specific fund this year
- Query type: **Gift**
- Criteria:
  - Gift > Fund > Description: Equals "[Fund Name]"
  - Gift > Date: Between [fiscal year start] AND [today]
- Output: Constituent name, Gift amount, Gift date, Appeal, Campaign

#### Board members
- Query type: **Constituent**
- Criteria:
  - Constituent Code > Description: Equals "Board Member"
- Output: Name, Email, Phone, Address, Constituent Code date

---

## Solicitor / Fundraiser Tracking

### How Solicitor Attribution Works in RE NXT

RE NXT tracks solicitor/fundraiser performance through three mechanisms:

1. **Solicitor Soft Credits on Gifts** — When a gift is entered, a soft credit with type "Solicitor" can be added to credit the staff member who secured it. This is the most reliable way to track which gifts a fundraiser secured.

2. **Fundraiser Relationship Assignments** — On a constituent record, a relationship can be created linking them to their assigned fundraiser/solicitor (e.g., "Fundraiser" relationship type). This tracks portfolio assignments — who manages which donors.

3. **Solicitor Field on Gifts** — Some organizations use the solicitor field directly on gift records (available in database view gift entry).

### Querying Solicitor Performance (Database View)

#### All gifts secured by a specific solicitor
- Query type: **Gift**
- Criteria:
  - Gift > Soft Credit > Constituent > Name: Equals "[Solicitor Name]"
  - Gift > Soft Credit > Type: Equals "Solicitor"
  - Gift > Date: Between [fiscal year start] AND [today]
- Output: Constituent name (donor), Gift amount, Gift date, Fund, Appeal, Campaign
- Sort: Gift date descending
- **Summary:** Check "Sum" on the Gift Amount output field to see total secured

#### All donors assigned to a specific fundraiser
- Query type: **Constituent**
- Criteria:
  - Relationships > Relationship Type: Equals "Fundraiser" (or your org's equivalent)
  - Relationships > Related Constituent > Name: Equals "[Fundraiser Name]"
- Output: Constituent name, Total giving, Last gift date, Phone, Email
- Sort: Total giving descending

#### Solicitor performance comparison (all solicitors)
- Query type: **Gift**
- Criteria:
  - Gift > Soft Credit > Type: Equals "Solicitor"
  - Gift > Date: Between [fiscal year start] AND [today]
- Output: Soft Credit Constituent name (solicitor), Gift amount, Gift date, Fund
- Sort: Soft Credit Constituent name
- **Summary:** Group by Soft Credit Constituent name, Sum on Gift Amount
- *This gives you a leaderboard of all solicitors by total gifts secured*

#### Fundraiser Performance Report (Database View)
1. Go to database view
2. Navigate to **Reports** > **Gift Reports** > **Solicitor Performance Summary**
3. Set parameters:
   - Date range (e.g., current fiscal year)
   - Solicitor filter (specific person or all)
4. The report shows: gifts secured per solicitor, total amount, number of gifts, average gift
5. Export to Excel for further analysis

### Best Practices for Solicitor Tracking

- **Consistent attribution:** Ensure every major gift has a solicitor soft credit added. Without this, fundraiser performance reports will be incomplete.
- **Relationship assignments:** Keep donor-to-fundraiser relationships up to date. When portfolio assignments change, update the relationship end date and create a new one.
- **Review regularly:** Run the Solicitor Performance Summary report monthly to catch any gaps in attribution.
- **Ask Fund-Raise integration:** With Deep Dive turned on, you can ask "How is [name] performing?" and the system will pull their portfolio data from Blackbaud, including assigned donors and gifts secured via soft credits.

---

## Gift Entry

### Adding a Single Gift (Web View)

1. Search for and open the constituent's record
2. Click **Add gift** (or the + button in the Giving section)
3. Fill in required fields:
   - **Amount** — The gift amount
   - **Date** — Date the gift was received
   - **Type** — Cash, Check, Credit Card, In-Kind, Stock/Property, etc.
   - **Pay method** — How the gift was paid
4. Add gift details:
   - **Fund** — Which fund receives the gift (required)
   - **Campaign** — Which campaign, if applicable
   - **Appeal** — Which appeal generated the gift
5. Add any **soft credits**, **tributes**, or **acknowledgements**
6. Click **Save**

### Batch Gift Entry (Database View)

Batch entry is the most efficient way to enter multiple gifts:

1. Go to database view
2. Navigate to **Batch** from the menu
3. Click **New Batch**
4. Select a batch template (or create one):
   - Templates define which fields appear and default values
   - Common templates: "Standard Gift Entry," "Pledge Payment," "Recurring Gift"
5. Set batch defaults:
   - **Date** — Default gift date for the batch
   - **Type** — Default gift type
   - **Fund** — Default fund (can be overridden per gift)
6. Enter gifts row by row:
   - Tab through fields for speed
   - Use binocular icon or F7 to look up constituents
   - The batch total updates automatically at the bottom
7. When finished, **validate** the batch (catches errors)
8. **Commit** the batch to post all gifts to constituent records

### Gift Types Explained

| Type | Description | Tax Receiptable? |
|------|-------------|-----------------|
| **Cash** | Cash, cheques, money orders | Yes |
| **Credit Card** | Visa, Mastercard, Amex | Yes |
| **In-Kind** | Goods or services donated | Depends on fair market value |
| **Stock/Property** | Securities, real estate | Yes (at fair market value) |
| **Pledge** | Promise to give in future | No (until payment received) |
| **Recurring Gift** | Automatic regular gift | Yes (per payment) |
| **Planned Gift** | Bequest, life insurance, etc. | No (expectancy) |
| **Gift-in-Kind** | Non-monetary donations | Yes (if appraised) |
| **Matching Gift** | Corporate match of employee gift | Yes |
| **Pay-Cash** | Pledge payment by cash/cheque | Yes |
| **Pay-Credit Card** | Pledge payment by credit card | Yes |

### Pledges and Pledge Payments

**Creating a pledge:**
1. Add a gift with Type = "Pledge"
2. Set the total pledge amount
3. Set the pledge schedule (number of instalments, frequency, start date)
4. Optionally set up automatic reminders

**Recording a pledge payment:**
1. Open the constituent's record
2. Find the pledge in their giving history
3. Click "Apply payment" or add a new gift with Type = "Pay-Cash" / "Pay-Credit Card"
4. Link it to the existing pledge
5. The pledge balance updates automatically

### Soft Credits

A soft credit recognizes someone for a gift without them being the actual donor:
- **Spouse/partner** — When one spouse writes the cheque but both should be credited
- **Matching gift company** — The employer who matched the gift
- **Solicitor** — The person who solicited the gift
- **Tribute** — Gift made in honour or memory of someone

To add a soft credit:
1. Open the gift record
2. Go to the Soft Credits tab
3. Click Add
4. Search for and select the soft credit recipient
5. Set the soft credit amount and type

### Tributes (In Honour / In Memory)

1. Open the gift record
2. Go to the Tributes section
3. Select tribute type: "In Honour of" or "In Memory of"
4. Search for or create the tribute (the person being honoured/memorialized)
5. Optionally set up acknowledgement letters to the donor AND to the honouree/family

---

## Constituent Management

### Adding a New Constituent

**Web view:**
1. Click **Add** > **Individual** or **Organization** from the top navigation
2. Fill in required fields: Name (first, last), and optionally address, email, phone
3. Before saving, check for duplicates — the system may warn you of potential matches
4. Click **Save**

**Database view:**
1. Go to Records > New Individual (or New Organization)
2. Fill in the Bio 1 tab (name, gender, title, suffix)
3. Fill in the Bio 2 tab (birth date, marital status, spouse)
4. Add address on the Address tab
5. Add phone/email on the Phones/Email tab
6. Click Save and Close

### Constituent Codes

Constituent codes categorize donors (e.g., "Board Member," "Volunteer," "Major Donor," "Staff"):

1. Open the constituent record
2. Go to the **Constituent Codes** section
3. Click **Add**
4. Select the code from the dropdown
5. Set the date from and optionally date to
6. Click Save

### Merging Duplicate Constituents

**Web view (basic merge):**
1. Open one of the duplicate records
2. Click the **More** menu (three dots) > **Merge**
3. Search for the other duplicate
4. Review the merge preview — select which data to keep from each record
5. Click **Merge**

**Database view (advanced merge):**
1. Go to **Tools** > **Merge Two Constituents**
2. Select the two records
3. Choose which record will be the "surviving" record
4. Review each field and select which value to keep
5. All gifts, actions, and relationships from the merged record transfer to the survivor
6. Click **Merge**

**Important:** Merging is irreversible. Always verify before merging. Back up data if possible.

### Relationships

Relationships link two constituents (e.g., spouse, employer, child):

1. Open the constituent record
2. Go to the **Relationships** section
3. Click **Add relationship**
4. Search for the related constituent
5. Select the relationship type (Spouse, Child, Employee, Friend, etc.)
6. Set the reciprocal type (automatically suggested)
7. Click Save

### Communication Preferences

To set how a constituent prefers to be contacted:

1. Open the constituent record
2. Go to **Communication preferences** (or the Comm Prefs tab in database view)
3. Set preferences:
   - **Send mail** — Yes/No
   - **Send email** — Yes/No
   - **Solicit** — Do Not Solicit flag
   - **Receipt preference** — Email or Mail
4. These flags are respected by queries and acknowledgement processes

---

## Acknowledgements & Tax Receipting

### Canadian Tax Receipting Context

For Canadian charities like TBRHSF:
- Official donation receipts must comply with **Canada Revenue Agency (CRA)** requirements
- Receipts must include: charity name and BN/registration number, donor name and address, gift date, gift amount, receipt number, eligible amount, and a statement that it is an official receipt for income tax purposes
- Advantage/benefit amounts must be disclosed (e.g., gala ticket value)
- Receipts can be issued per gift or as an annual consolidated receipt
- Pledges are NOT receiptable until payment is received
- In-kind gifts require fair market value appraisal

### Setting Up Acknowledgement Letters (Database View)

1. Go to **Configuration** > **Tables** > **Acknowledgement/Receipt Letters**
2. Add letter templates or link to Word/mail merge templates
3. Configure the letter content with merge fields:
   - `<<Addressee>>`, `<<Gift Amount>>`, `<<Gift Date>>`, `<<Fund>>`, etc.
4. Set up default acknowledgement letters per fund or gift type

### Running the Acknowledgement Process (Database View)

1. Go to **Mail** > **Acknowledgements**
2. Select the gifts to acknowledge:
   - Use a query to select specific gifts (e.g., "all unacknowledged gifts this month")
   - Or select date range and filters
3. Choose the letter template
4. Set parameters:
   - **Mark as acknowledged** — Updates the gift's acknowledgement status
   - **Create control report** — For auditing
5. Run the process — generates letters and updates statuses

### Receipt Numbering

- Configure receipt number format in Configuration > Business Rules
- Ensure sequential numbering for CRA compliance
- Separate numbering sequences can be set for different receipt types

---

## Reports

### Common Built-In Reports (Database View)

| Report | Location | Purpose |
|--------|----------|---------|
| **Donor Summary** | Reports > Donor | Summary of giving by donor |
| **Gift Detail** | Reports > Gift | Detailed gift listing |
| **LYBUNT** | Reports > Donor | Last Year But Unfortunately Not This Year |
| **SYBUNT** | Reports > Donor | Some Years But Unfortunately Not This Year |
| **Top Donors** | Reports > Donor | Ranked by total giving |
| **Pledge Status** | Reports > Gift | Outstanding pledges |
| **Campaign Progress** | Reports > Campaign | Revenue vs. goal by campaign |
| **Fund Performance** | Reports > Fund | Revenue by fund |

### Running a Report

1. Go to database view > **Reports**
2. Select the report category and specific report
3. Set parameters:
   - Date range
   - Filters (constituent query, fund, campaign, etc.)
   - Sorting and grouping options
4. Click **Preview** to view on screen
5. Click **Print** or **Export** (to Excel, PDF, or Word)

### Exporting Data to Excel

**From a query:**
1. Run the query
2. Click **Export** in the toolbar
3. Choose format: Excel (.xlsx)
4. Select which output fields to include
5. Click Export

**From the web view list:**
1. Open the list
2. Click the **Export** button (download icon)
3. Select CSV or Excel format

---

## Import / Export

### Importing Data (Database View)

1. Go to **Admin** > **Import**
2. Select the import type:
   - **Constituent** — New constituent records
   - **Gift** — Gift records (requires matching to existing constituents)
   - **Address** — Update addresses
3. Map your import file columns to RE fields:
   - Select your CSV/Excel file
   - Map each column header to the corresponding RE field
   - Set defaults for unmapped required fields
4. Set import options:
   - **Create new records** or **Update existing only**
   - **Match criteria** — How to find existing records (name, lookup ID, etc.)
   - **Duplicate handling** — Skip, update, or create new
5. **Validate** the import first (catches errors before committing)
6. **Import** — Process the records
7. Review the exception report for any records that failed

### Export Definitions (Database View)

1. Go to **Admin** > **Export**
2. Create a new export or use an existing one
3. Select the export type (Constituent, Gift, etc.)
4. Choose output fields
5. Apply filters (use a query to limit records)
6. Set the output format (CSV, Excel, tab-delimited)
7. Run the export

---

## Common Errors & Troubleshooting

### "Record is in use by another user"
- **Cause:** Another user (or a background process) has the record open
- **Fix:** Wait a few minutes and try again. If persistent, ask an admin to check who has the record locked (Administration > Application > Lock Management in database view)

### "Duplicate record found"
- **Cause:** A constituent with a matching name/email already exists
- **Fix:** Review the potential match. If it's the same person, open their existing record instead. If it's genuinely a different person, proceed with creating a new record and add distinguishing info

### "Token expired" or authentication errors
- **Cause:** Your Blackbaud session has expired
- **Fix:** Log out and log back in. If using API integrations, refresh the OAuth token

### "Required field is missing" during gift entry
- **Cause:** A required field (usually Fund) is not filled in
- **Fix:** Check all required fields (marked with asterisks). Fund is always required. Check business rules for additional required fields

### "Batch out of balance"
- **Cause:** The expected batch total doesn't match the actual total of entered gifts
- **Fix:** Review each gift in the batch. Check for typos in amounts. The batch control total at the top must match the sum of all gifts

### "Query returned no results"
- **Cause:** Criteria too restrictive, or data doesn't exist
- **Fix:** Relax criteria one at a time. Check date formats. Verify field values match exactly (some fields are case-sensitive). Try running with fewer criteria to isolate the issue

### "Cannot delete constituent — related records exist"
- **Cause:** The constituent has gifts, actions, or other linked records
- **Fix:** You must delete or reassign all related records first, or consider making the constituent inactive instead of deleting

### "Import failed — field mapping error"
- **Cause:** A column in your import file doesn't match any RE field, or data format is wrong
- **Fix:** Verify date formats (YYYY-MM-DD or MM/DD/YYYY). Ensure amounts are numeric (no dollar signs or commas). Check that code table values match exactly

### Web view loading slowly or showing errors
- **Cause:** Browser cache issues, network problems, or Blackbaud service issues
- **Fix:** Clear browser cache. Try a different browser. Check status.blackbaud.com for service outages. Disable browser extensions that may interfere

### "Insufficient security rights"
- **Cause:** Your user account doesn't have permission for that action
- **Fix:** Contact your Blackbaud administrator to review your security group settings (Configuration > Security in database view)

---

## Tips & Best Practices

### Data Entry
- Always search for an existing constituent before creating a new one
- Use consistent naming conventions (e.g., "Dr." not "Doctor")
- Enter addresses in the standard Canada Post format
- Use constituent codes to categorize donors systematically
- Enter gifts promptly to keep acknowledgement timelines on track

### Queries
- Save frequently used queries with descriptive names and categories
- Use dynamic queries for recurring reports (they update automatically)
- Use static queries for point-in-time snapshots
- Test complex queries with a small date range first before running broadly
- Document your query criteria in the query description field

### Acknowledgements
- Set up auto-acknowledgement rules to ensure no gift goes unthanked
- Generate receipts promptly — CRA allows issuing by February 28 for the prior year
- Keep a log of all receipts issued for audit purposes
- Use receipt stacks for batch processing of year-end receipts

### Performance
- Archive old data periodically to keep the database fast
- Run large queries and reports during off-peak hours
- Close unused records to free locks
- Use the web view for quick lookups and the database view for heavy data work
