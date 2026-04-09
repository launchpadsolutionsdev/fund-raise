# Fund-Raise: Complete Platform Guide

> **The fundraising intelligence platform for RE NXT foundations.**
> 30+ dashboards, AI-powered conversational analytics, donor scoring, and smart writing tools — one platform that replaces Insight Designer, MissionBI, Crystal Reports, and standalone AI tools.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Platform Overview](#platform-overview)
3. [CRM Dashboards](#crm-dashboards)
4. [Deep Donor Analytics](#deep-donor-analytics)
5. [Ask Fund-Raise — AI Assistant (In-Depth)](#ask-fund-raise--ai-assistant-in-depth)
6. [AI Writing Tools](#ai-writing-tools)
7. [PDF Reports & Exports](#pdf-reports--exports)
8. [Team Collaboration & Productivity](#team-collaboration--productivity)
9. [Action Centre](#action-centre)
10. [Data Import & Integration](#data-import--integration)
11. [Administration & Settings](#administration--settings)
12. [Role-Based Access Guide](#role-based-access-guide)
13. [Use Case Scenarios](#use-case-scenarios)
14. [What Fund-Raise Replaces](#what-fund-raise-replaces)
15. [Frequently Asked Questions](#frequently-asked-questions)

---

## Getting Started

### Step 1: Sign Up & Create Your Organization

Visit the Fund-Raise platform and click **"Get Started Free."** You'll be guided through a quick onboarding wizard:

1. **Create Your Account** — Enter your name, email, and password. You'll become the first Admin for your organization.
2. **Name Your Organization** — Provide your foundation's name. This creates your private, isolated tenant — your data is never shared with other organizations.
3. **Invite Your Team** — Add team members by email. You can assign roles:
   - **Admin** — Full access to all features, settings, and user management
   - **Uploader** — Can import data, use AI tools, and access all dashboards
   - **Viewer** — Read-only access to dashboards and reports
4. **Import Your Data** — Upload your first CRM export (CSV or Excel). Fund-Raise auto-maps your columns and validates the data before import.

### Step 2: Import Your CRM Data

Fund-Raise supports two methods for getting your data in:

- **CSV/Excel Upload** — Export your gift data from Blackbaud RE NXT (or any CRM), then upload it through the Data Import page. Fund-Raise's auto-mapping engine matches your column headers to its data model — gift amount, date, donor name, fund, campaign, appeal, gift type, and more.
- **Blackbaud RE NXT Direct Connection** — Connect your Blackbaud SKY API credentials (Admin only) for live constituent lookups. This doesn't replace the CSV import for bulk data — it adds real-time lookup capabilities on top.

### Step 3: Explore Your Dashboards

Once data is imported, every dashboard populates automatically. No configuration, no report building, no SQL. Just navigate the sidebar and explore:

- **CRM Dashboard** — Your command centre with KPI cards, progress bars, and proactive insights
- **Donor Scoring** — Instant RFM segmentation of your entire donor base
- **Retention Analytics** — See who's lapsing and who's staying
- **30+ more dashboards** — Each one pre-built and ready to go

### Step 4: Meet Ask Fund-Raise

Click **"Ask Fund-Raise"** in the sidebar to open the AI assistant. Ask questions in plain English:

- *"How are we tracking against our overall goal?"*
- *"Who are our top 10 donors and their trends?"*
- *"Which department is performing best this year?"*

Ask Fund-Raise has access to all your imported data and can generate charts, tables, and actionable recommendations on the fly.

---

## Platform Overview

Fund-Raise is an all-in-one fundraising intelligence platform designed specifically for foundations using Blackbaud RE NXT. It consolidates analytics, AI, reporting, and team tools into a single platform.

### Key Numbers

- **30+ pre-built dashboards** — from CRM overview to deep donor analytics
- **50 AI-powered tools** — powering Ask Fund-Raise's analytical capabilities
- **6 AI writing tools** — thank-you letters, impact stories, meeting prep, and more
- **10 one-click PDF reports** — publication-ready board reports
- **5 fundraising departments tracked** — Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving
- **Unlimited users** — no per-seat fees

### Architecture

- **Multi-tenant** — Each organization's data is completely isolated using PostgreSQL row-level security
- **Role-based access** — Admins, Uploaders, and Viewers each see exactly what they need
- **Dark & light mode** — Full theme support across every page
- **Mobile-responsive** — Access dashboards and AI from any device

---

## CRM Dashboards

Fund-Raise includes 30+ pre-built dashboards that populate automatically when you import data. No configuration required.

### CRM Master Dashboard

Your command centre. At a glance you see:

- **KPI Cards** — Total raised, unique donors, average gift, largest gift, gift count
- **Progress Bars** — Visual goal tracking for the organization and each department
- **Proactive Insights** — AI-generated alerts highlighting what needs attention (e.g., "Major Gifts is 15% behind pace")
- **Recent Gifts Table** — Latest gifts with donor, amount, fund, and date
- **Department Breakdown** — Side-by-side performance across all five departments
- **Donor Segments** — Quick view of your donor base composition

### Department Dashboards

Each of the five departments gets its own dedicated dashboard:

| Department | Key Metrics | Unique Features |
|---|---|---|
| **Annual Giving** | Total raised, donor count, avg gift, goal progress | Channel mix (online vs. mailed, one-time vs. recurring) |
| **Direct Mail** | Campaign response rates, appeal performance | Appeal-level breakdowns, channel analysis |
| **Events** | Foundation events + third-party events | Separate tracking for third-party revenue streams |
| **Major Gifts** | High-value gift tracking, top donor concentration | Donor concentration analysis, portfolio view |
| **Legacy Giving** | Bequests, expectancies, planned gifts | Open estates, new expectancies, average gift |

### Specialized Analytics Dashboards

- **Gift Trends** — Gift type distributions, payment method trends, giving patterns over time
- **Campaign Compare** — Side-by-side campaign performance with effectiveness ratings
- **Appeal Compare** — Appeal-level performance metrics and rankings
- **Fund Health** — Fund-by-fund health scoring with growth trends and risk levels
- **Payment Methods** — Distribution of payment types (check, credit card, ACH, stock, etc.)
- **Anomaly Detection** — Statistical outlier detection flagging unusual gifts for review
- **Geographic Analytics** — Giving patterns by region and location
- **Donor Detail** — Individual donor deep-dive with complete giving history
- **Gift Search** — Full-text search across all imported gifts with filters

### Dashboard Features (Available on Every Dashboard)

- **CSV Export** — Export any table to CSV with one click
- **Date Range Filters** — Filter by fiscal year, custom date range, or snapshot period
- **Department Filters** — Drill into specific departments or compare across all
- **Responsive Design** — Dashboards work on desktop, tablet, and mobile
- **Dark/Light Mode** — Full theme support on every page

---

## Deep Donor Analytics

Fund-Raise includes advanced analytics that typically require a data warehouse and a BI developer. Here, they're pre-built and automatic.

### RFM Donor Scoring & Segmentation

Every donor is automatically scored using the **RFM model** (Recency, Frequency, Monetary):

- **Recency** — How recently did they give?
- **Frequency** — How often do they give?
- **Monetary** — How much do they give?

Donors are classified into actionable segments:

| Segment | Description | Suggested Action |
|---|---|---|
| **Champion** | Recent, frequent, high-value | Steward and recognize |
| **Loyal & Active** | Consistent givers, moderate-to-high value | Upgrade opportunities |
| **New / Promising** | Recent first-time donors | Nurture and retain |
| **Upgrade Candidate** | Consistent but lower amounts | Targeted ask increase |
| **At Risk** | Previously active, now declining | Re-engagement campaign |
| **Lapsed** | No recent activity | Win-back strategy |

### Retention Analytics

- **Overall retention rate** with year-over-year trends
- **Department-level retention** — see which departments retain donors best
- **Giving-level retention** — retention rates by gift size bracket
- **Retention drilldown** — individual donor names with their retention status

### LYBUNT / SYBUNT Tracking

- **LYBUNT** (Last Year But Unfortunately Not This Year) — Donors who gave last year but haven't yet this year
- **SYBUNT** (Some Year But Unfortunately Not This Year) — Donors who gave in a prior year but not this year
- **Revenue at Risk** — Dollar value of lapsed giving
- **Donor lists** — Exportable lists for re-engagement campaigns

### Additional Analytics

- **Donor Lifecycle Analysis** — Classify donors into lifecycle stages: New, Growing, Stable, Declining, At-Risk, Lapsed, Recovered
- **Upgrade/Downgrade Detection** — Year-over-year giving changes at the individual donor level
- **First-Time Donor Conversion** — Track new donor acquisition and first-to-second gift conversion
- **Household Giving** — Consolidated household-level giving analysis
- **Recurring Donor Patterns** — Recurring giving analysis with churn detection
- **Giving Pyramid** — Donor and revenue distribution by giving level
- **Matching Gift Analysis** — Matching gift capture rates and corporate match opportunities
- **Soft Credit Analysis** — Attribution tracking for solicitor/fundraiser credit
- **Fundraiser Leaderboard** — Performance rankings for gift officers and solicitors

---

## Ask Fund-Raise — AI Assistant (In-Depth)

Ask Fund-Raise is the platform's conversational AI assistant — a personal fundraising analyst powered by Claude (Anthropic). It has direct access to all your imported data, 50 specialized analytical tools, and optional live Blackbaud CRM lookups.

### Getting Started with Ask Fund-Raise

Click **"Ask Fund-Raise"** in the sidebar to open the chat interface. You'll see a welcome screen with:

- **Status indicators** — Green dots confirming "AI Ready," "CRM Data Loaded," and (optionally) "Blackbaud Connected"
- **Suggestion cards** — Six quick-start prompts to get you going:
  1. "How are we tracking against our overall goal?"
  2. "Who are our top 10 donors and their trends?"
  3. "Which department is performing best this year?"
  4. "Show me donor retention and lapsed analysis"
  5. "What actions are assigned to me?"
  6. "Full dashboard overview with key metrics"
- **Blackbaud suggestions** (when connected):
  - "Look up a donor's giving history in Blackbaud"
  - "What gifts came in this week?"

### How It Works

Ask Fund-Raise isn't a generic chatbot — it's an embedded analyst that has already reviewed every dashboard, department, and metric in your data. When you ask a question:

1. **It analyzes your question** and determines which of its 50 tools to use
2. **It queries your data** using the appropriate tools (you'll see a thinking animation with tool names)
3. **It synthesizes the results** into a clear, data-grounded response
4. **It provides context** — not just numbers, but interpretation and recommendations

### What You Can Ask

**Performance & Goals:**
- "How are we doing this fiscal year?"
- "Which department needs the most attention?"
- "What's our year-end projection?"
- "How does this year compare to last year?"

**Donor Intelligence:**
- "Who are our top 20 donors?"
- "Show me donors who are at risk of lapsing"
- "What's our donor retention rate by department?"
- "Which donors gave last year but not this year?" (LYBUNT)
- "Show me our giving pyramid"
- "What's our RFM scoring breakdown?"

**Campaign & Fund Analysis:**
- "Which campaign performed best?"
- "Compare the annual fund appeal vs. year-end appeal"
- "Which funds are growing vs. declining?"
- "Show me payment method trends"

**Individual Donor Lookups (Deep Dive mode):**
- "Tell me about [Donor Name]" — pulls their full profile, giving history, relationships
- "What has [Donor Name] given in the last 3 years?"
- "Who is the fundraiser assigned to [Donor Name]?"
- "Show me [Fundraiser Name]'s portfolio and performance"

**Action Management:**
- "What actions are assigned to me?"
- "Create an action for [Team Member] to follow up with [Donor] by Friday"
- "How many overdue actions do we have?"

**Team Awareness:**
- "What's been posted on the team board?"
- "Who received kudos recently?"
- "What milestones have we hit?"
- "Show me the team directory"

**Operational:**
- "When was data last imported?"
- "Is our Blackbaud connection healthy?"
- "Are there any data quality issues?"

**Writing & Communications:**
- "Draft a thank-you letter for [Donor Name] who gave $5,000 to the cardiac fund"
- "Write a board meeting briefing for this quarter"
- "Create an impact story about our surgical equipment campaign"
- "Generate a weekly digest for the team"

### Charts & Visualizations

Ask Fund-Raise can generate inline charts directly in the conversation. Just ask:

- "Show me a chart of department progress to goal"
- "Graph our monthly giving trends"
- "Create a pie chart of donor segments"

Supported chart types: **bar, line, pie, doughnut, polar area**. Charts render directly in the chat using Chart.js and are interactive (hover for values, click legends to toggle).

### Deep Dive Mode

Deep Dive is a power feature that expands Ask Fund-Raise's capabilities beyond your imported data:

**What Deep Dive Adds:**
- **Live Blackbaud RE NXT lookups** — Search constituents, pull real-time profiles, giving histories, relationships, and fundraiser portfolios directly from your CRM
- **Web search** — Research fundraising best practices, industry benchmarks, donor/prospect research, and external context

**How to Activate:**
1. Click the **lightning bolt icon** (⚡ Deep Dive) at the bottom of the chat
2. If Blackbaud is connected, click **"Activate Deep Dive"**
3. The status badge changes from "OFF" to "ON"
4. You can toggle it off at any time

**When to Use Deep Dive:**
- Looking up a specific donor by name (pulls live profile from Blackbaud)
- Researching a prospect or organization
- Asking about fundraising benchmarks ("What's a good retention rate for hospital foundations?")
- Getting real-time gift data ("What gifts came in this week?")

**API Usage Note:** Deep Dive uses your organization's Blackbaud SKY API quota (limited to 1,000 calls/day). Each donor lookup typically uses 2-3 API calls.

### The 50 AI Tools (Under the Hood)

Ask Fund-Raise uses these tools automatically — you don't need to know they exist. But for transparency, here's what powers it:

**CRM Query Tools (2):**
- `query_crm_gifts` — Runs queries against your imported CRM gift database
- `get_crm_summary` — High-level overview of all CRM data

**Analytics Tools (28):**
- `get_donor_scoring` — RFM-based donor segmentation
- `get_donor_retention` — Multi-year retention rates
- `get_retention_drilldown` — Detailed retention with donor names
- `get_lybunt_sybunt` — Lapsed donor lists
- `get_donor_lifecycle` — Lifecycle stage classification
- `get_donor_upgrade_downgrade` — Year-over-year giving changes
- `get_first_time_donor_conversion` — New donor acquisition tracking
- `get_household_giving` — Household-level consolidation
- `get_campaign_comparison` — Side-by-side campaign performance
- `get_appeal_comparison` — Appeal performance rankings
- `get_appeal_detail` — Deep dive into a specific appeal
- `get_fund_health` — Fund health scoring and risk assessment
- `get_year_over_year` — Full year-over-year comparison
- `get_gift_trends` — Gift type and pattern trends
- `get_giving_pyramid` — Donor/revenue distribution by level
- `get_fundraiser_leaderboard` — Fundraiser performance rankings
- `get_recurring_donors` — Recurring giving analysis
- `get_matching_gifts` — Matching gift analysis
- `get_soft_credits` — Soft credit attribution
- `get_payment_methods` — Payment method distribution
- `get_acknowledgment_tracker` — Acknowledgment status tracking
- `get_department_analytics` — Department-level analytics
- `get_department_detail` — Deep dive into a department
- `get_anomaly_detection` — Statistical outlier detection
- `get_ai_recommendations` — Data-driven recommendations
- `get_proactive_insights` — Auto-generated alerts and insights
- `get_data_quality_report` — Data integrity assessment
- `get_geographic_analytics` — Geographic giving distribution

**Action Centre Tools (3):**
- `create_action` — Create follow-up tasks for team members
- `list_actions` — List actions (my inbox, assigned by me, or all)
- `get_action_stats` — Summary counts (open, pending, overdue, due today)

**Team Tools (4):**
- `get_board_posts` — Recent team message board posts
- `get_recent_kudos` — Team kudos and recognition
- `get_milestones` — Campaign milestones and status
- `get_team_directory` — Staff directory with roles

**Operational Tools (3):**
- `get_data_freshness` — When data was last imported
- `get_import_history` — Import history with row counts
- `get_connection_status` — Blackbaud integration health

**Blackbaud Live Tools (10, Deep Dive only):**
- `search_constituents` — Search donors by name, email, or ID
- `get_constituent_profile` — Full donor profile with contact info and relationships
- `get_donor_giving_history` — Complete giving history with lifetime statistics
- `search_gifts` — Search gifts with amount/date filters
- `get_gift_details` — Full details on a specific gift
- `list_campaigns` — All fundraising campaigns
- `list_funds` — All funds with descriptions
- `get_fundraiser_portfolio` — Solicitor performance and assigned donors
- `get_gift_soft_credits` — Soft credit attribution on a gift
- `get_constituent_solicitors` — Assigned fundraiser for a donor

**Web Search (1, Deep Dive only):**
- `web_search` — Search the web for benchmarks, best practices, and external research

### Conversation Features

- **Conversation History** — All conversations are saved automatically. Click the clock icon to browse and reload past conversations.
- **Sharing** — Share a conversation with team members so they can see the analysis
- **Export** — Export a conversation to text or copy to clipboard
- **Image Upload** — Attach screenshots or images (PNG, JPEG, GIF, WebP up to 5MB). Ask Fund-Raise can read and analyze visual content. You can also paste images from your clipboard.
- **Multi-Turn Context** — Ask follow-up questions naturally. "How does that compare to last year?" works because Ask Fund-Raise remembers the conversation.
- **New Chat** — Start a fresh conversation at any time with the + button

### How Ask Fund-Raise Responds

Ask Fund-Raise follows strict principles to ensure quality:

- **Data-first** — Every answer is grounded in your actual data. It never fabricates or estimates numbers.
- **Precise** — Currency is formatted as $X,XXX.XX. Percentages to one decimal place. No unnecessary rounding.
- **Concise, then detailed** — Leads with the direct answer, then provides supporting detail only when it adds value.
- **Proactively insightful** — Doesn't just report numbers — interprets them. "Major Gifts is at 92% of goal — strong position" or "Annual Giving at 34% needs attention."
- **Professionally warm** — Speaks like a trusted analyst colleague, not a search engine.
- **Source-aware** — Always notes where data comes from: "From the snapshot data..." vs. "From the Blackbaud database..." vs. "Based on web research..."

### Thinking Animation

While Ask Fund-Raise works, you'll see an animated thinking card showing what it's doing:

- Tool names appear as friendly labels (e.g., "Searching donor records," "Analyzing CRM data," "Checking connections")
- Rotating phrases add personality: "Crunching the numbers...", "Cross-referencing records...", "Connecting the dots..."
- Multiple tools show as a chain: "Searching donor records · Analyzing CRM data · Loading actions"

---

## AI Writing Tools

Fund-Raise includes six dedicated AI writing tools, each with full access to your donor data for personalized output.

### 1. Writing Assistant

A general-purpose drafting tool for fundraising communications:

- **Appeal letters** — Personalized solicitation letters
- **Grant proposals** — Structured proposals with data support
- **Sympathy/condolence cards** — Empathetic, respectful messaging
- **Donor emails** — Professional outreach with clear calls to action
- **Event invitations** — Engaging invitations with key details
- **Follow-up emails** — Timely, personal follow-ups referencing prior interactions

### 2. Thank-You Letters

Generate personalized donor acknowledgment letters:

- References the donor's name, gift amount, fund/designation, and campaign
- Multiple styles: **Formal, Warm, Brief, Impact-focused, Handwritten card**
- Batch generation available — create letters for multiple donors at once
- Uses Canadian English spelling (honour, centre, colour)

### 3. Impact Stories

Transform your fundraising data into compelling narratives:

- **Annual Report Narrative** — Year-in-review storytelling
- **Social Media Post** — Shareable content for digital channels
- **Donor Newsletter** — Feature stories for donor communications
- **Website Feature** — Web-ready content
- **Board Presentation Slide** — Concise impact summaries

Focus areas: Patient Care, Equipment & Technology, Research, Education & Training, General Operations

### 4. Meeting Prep

Generate board-ready briefings and meeting materials:

- **Board Presentation** — Key metrics, trends, and talking points
- **Donor Meeting** — Donor portfolio summaries and cultivation strategies
- **Department Check-In** — Department performance reviews
- **Campaign Strategy Session** — Campaign analysis with recommendations
- **Year-End Review** — Comprehensive annual performance review
- **New Donor Cultivation** — Prospect briefings and approach strategies

Each briefing includes: Overview, Talking Points, Data Highlights, Discussion Questions, and Action Items.

### 5. Weekly Digest

Auto-generated summaries of the week's fundraising activity:

- **Tones:** Professional, Casual, Celebratory, Strategic
- **Audiences:** Team, Leadership, Board, All Staff
- Includes highlights, trends, notable gifts, and key metrics

### 6. Quick Notes

Capture meeting notes, donor insights, and action items on the fly:

- Free-form note entry with AI-powered organization
- Tag notes to donors, campaigns, or departments
- Notes are saved to your account and searchable

---

## PDF Reports & Exports

### One-Click PDF Reports

Generate publication-ready PDF reports with a single click. Each report is professionally formatted and ready for board meetings, donor presentations, or internal reviews.

**10 Available Reports:**

1. **Executive Summary** — Organization-wide performance overview
2. **Donor Retention Report** — Retention rates, trends, and at-risk donors
3. **RFM Scoring Report** — Complete donor segmentation analysis
4. **Recurring Donors Report** — Recurring giving patterns and trends
5. **LYBUNT/SYBUNT Report** — Lapsed donor analysis with revenue at risk
6. **Gift Trends Report** — Gift type, size, and timing trends
7. **Campaign Performance Report** — Campaign-by-campaign analysis
8. **Fund Health Report** — Fund-level health scoring and risk assessment
9. **Donor Lifecycle Report** — Lifecycle stage distribution and movement
10. **Upgrade/Downgrade Report** — Year-over-year individual donor changes

### CSV Export

Every data table across the platform includes a **CSV export button**. Export donor lists, gift data, analytics results, or any table to CSV for use in Excel, mail merges, or external tools.

---

## Team Collaboration & Productivity

### Team Message Board

A shared communication space for your fundraising team:

- **Post updates** — Share wins, announcements, and insights
- **Comment on posts** — Discuss strategies and celebrate achievements
- **Visible to all team members** within your organization

### Kudos & Recognition

Send and receive peer recognition:

- **Send kudos** to a team member with a message
- **View recent kudos** on the team page
- Fosters a culture of appreciation and teamwork

### Milestones

Track and celebrate campaign milestones:

- Set milestone targets for campaigns or goals
- Visual progress tracking
- Automated celebration when milestones are reached

### Team Directory

A built-in staff directory showing:

- Names, roles, and titles
- Department assignments
- Contact information

### Gamification

- **Leaderboards** — Fundraiser performance rankings
- **Streak tracking** — Consecutive activity recognition
- **Achievement badges** — Visual recognition of accomplishments

---

## Action Centre

A built-in task management system for fundraising follow-ups:

### Creating Actions

- Assign tasks to any team member
- Set due dates and priority levels
- Add descriptions and context
- Create actions from the Action Centre page or directly through Ask Fund-Raise

### Managing Actions

- **My Inbox** — Actions assigned to you
- **Assigned by Me** — Actions you've delegated
- **All Actions** — Organization-wide view (Admin)
- Filter by status: Open, Pending, Resolved, Overdue
- Add comments and updates to any action

### Action Stats

- Total open actions
- Pending actions
- Overdue items needing attention
- Actions due today

### AI Integration

Ask Fund-Raise can manage actions through conversation:
- *"Create an action for Sarah to call John Smith about his annual gift by Friday"*
- *"What actions are overdue?"*
- *"Show me my action inbox"*

---

## Data Import & Integration

### CSV/Excel Import

Fund-Raise's import engine handles your CRM data exports:

1. **Upload** — Drag and drop or browse for your CSV/Excel file
2. **Auto-Mapping** — Fund-Raise automatically maps your columns to its data model (gift amount, date, donor name, fund, campaign, appeal, gift type, solicitor, etc.)
3. **Validation** — Data is validated before import — you'll see any issues flagged for review
4. **Processing** — Gifts are imported with associated fundraiser credits, soft credits, and matching gifts
5. **Dashboard Update** — All dashboards refresh automatically with the new data

**Supported Fields:**
- Gift ID, Amount, Date, Type, Pay Method
- Donor Name (First, Last, Organization)
- Fund, Campaign, Appeal, Package
- Solicitor/Fundraiser assignments
- Soft credits and matching gifts
- Acknowledgment status and date
- Donor address (for geographic analytics)

### Blackbaud RE NXT Integration

Connect directly to your Blackbaud RE NXT environment via the SKY API:

- **OAuth 2.0 authentication** — Secure connection managed by your Admin
- **Real-time constituent search** — Look up any donor by name, email, or lookup ID
- **Full donor profiles** — Contact info, relationships, constituent codes, custom fields
- **Giving history** — Complete gift records with fund, campaign, and appeal detail
- **Fundraiser portfolios** — Solicitor assignments and performance tracking
- **Campaign & fund lookups** — Browse all campaigns and funds in your CRM

**Setup (Admin only):**
1. Navigate to **Settings > Integrations**
2. Click **"Connect Blackbaud"**
3. Authorize Fund-Raise through the Blackbaud OAuth flow
4. Connection status is monitored automatically — you'll see "Blackbaud Connected" in the sidebar and in Ask Fund-Raise

### Data Configuration

Admins can configure how Fund-Raise interprets your data:

- **Fiscal year settings** — Define your fiscal year start month
- **Department mapping** — Map your fund/campaign codes to Fund-Raise's five departments
- **Goal configuration** — Set fundraising goals at the organization and department level
- **Fundraiser goals** — Set individual performance targets for gift officers

---

## Administration & Settings

### User Management (Admin Only)

- **Invite users** by email with role assignment
- **Manage roles** — Promote/demote between Viewer, Uploader, and Admin
- **Deactivate users** — Remove access without deleting history
- **View activity** — See who's logged in and what they've accessed

### Organization Settings

- **Organization name** and branding
- **Fiscal year configuration**
- **Department and goal setup**
- **Data retention policies**

### Integrations

- **Blackbaud RE NXT** — OAuth connection management, connection health monitoring
- **Connection status** — Real-time health checks visible in dashboard and Ask Fund-Raise

### AI Analytics (Admin Only)

A dedicated analytics page for monitoring Ask Fund-Raise usage:

- **KPI Cards** — Total requests, tokens used, estimated cost, cache efficiency, success rate, average response time, tool rounds, active users
- **Charts** — Daily requests, daily token usage, response time trends, daily cost, top tools used, model distribution
- **User Breakdown** — Per-user usage table with request counts and cost estimates
- **Period Filters** — View by 7 days, 30 days, 90 days, or 1 year

### Audit Log

Track all significant actions across the platform:

- Data imports and deletions
- User management changes
- Setting modifications
- Integration connection events

---

## Role-Based Access Guide

### Viewer

**Best for:** Board members, volunteers, read-only stakeholders

| Feature | Access |
|---|---|
| CRM Dashboards | View all dashboards |
| Donor Analytics | View all analytics |
| PDF Reports | Generate and download |
| CSV Export | Export any table |
| Team Board | Read posts and comments |
| Ask Fund-Raise | Chat with AI (read-only data) |
| Data Import | No access |
| User Management | No access |
| Settings | No access |

### Uploader

**Best for:** Fundraising staff, gift officers, data coordinators

| Feature | Access |
|---|---|
| Everything in Viewer | Yes |
| Data Import | Upload CSV/Excel files |
| Ask Fund-Raise | Full access including all tools |
| AI Writing Tools | Full access |
| Action Centre | Create and manage actions |
| Team Board | Create posts and comments |
| Kudos | Send and receive |
| Quick Notes | Create and manage |

### Admin

**Best for:** VP of Development, Foundation Director, IT lead

| Feature | Access |
|---|---|
| Everything in Uploader | Yes |
| User Management | Invite, manage roles, deactivate |
| Organization Settings | All configuration |
| Blackbaud Integration | Connect and manage |
| AI Analytics | Monitor usage and costs |
| Audit Log | View all activity |
| Department/Goal Config | Set goals and mappings |
| Fundraiser Goals | Set individual targets |

---

## Use Case Scenarios

### Scenario 1: Preparing for a Board Meeting

**The situation:** You have a board meeting in 2 hours and need a comprehensive briefing.

**What to do:**
1. Open **Ask Fund-Raise** and ask: *"Prepare me for a board meeting — give me a full overview with year-over-year comparison, department performance, retention trends, and any areas of concern."*
2. Ask Fund-Raise combines data from multiple tools to generate a complete briefing with talking points.
3. Ask follow-up questions: *"Show me a chart of department progress"* or *"What are our top 3 risks?"*
4. Use the **Meeting Prep** writing tool to generate a formal briefing document.
5. Generate the **Executive Summary PDF** report for your board package.

### Scenario 2: Identifying Lapsed Donors for Year-End Campaign

**The situation:** It's October and you need to re-engage donors who gave last year but not this year.

**What to do:**
1. Go to the **LYBUNT/SYBUNT dashboard** to see lapsed donors and revenue at risk.
2. Ask Fund-Raise: *"Show me our LYBUNT donors sorted by last year's giving amount. Who are the top 20 we should prioritize?"*
3. Ask: *"Draft a re-engagement email for lapsed major gift donors referencing their previous support."*
4. Use the **Action Centre** to create follow-up tasks: *"Create an action for each fundraiser to call their top 5 lapsed donors by end of month."*
5. Export the LYBUNT list to CSV for your mail merge.

### Scenario 3: Onboarding a New Gift Officer

**The situation:** A new major gifts officer has joined and needs to understand their portfolio.

**What to do:**
1. Enable **Deep Dive** mode and ask: *"Show me [New Officer]'s fundraiser portfolio — who are their assigned donors and what's the giving history?"*
2. Ask: *"Which of these donors are at risk of lapsing?"* to prioritize outreach.
3. Walk them through the **Donor Scoring** dashboard to understand RFM segments.
4. Show them the **Action Centre** for managing follow-ups.
5. Demonstrate Ask Fund-Raise with: *"Tell me about [Donor Name]"* to show how they can research any donor.

### Scenario 4: Monthly Performance Review

**The situation:** Monthly check-in with the VP of Development.

**What to do:**
1. Ask Fund-Raise: *"Give me a month-over-month comparison. How did we do last month vs. the month before?"*
2. Ask: *"Which department improved the most? Which declined?"*
3. Check the **Anomaly Detection** dashboard for any unusual gifts or patterns.
4. Review the **Fundraiser Leaderboard** for team performance.
5. Generate a **Weekly Digest** summarizing highlights for the broader team.

### Scenario 5: Donor Research Before a Cultivation Meeting

**The situation:** You're meeting with a major donor prospect tomorrow.

**What to do:**
1. Enable **Deep Dive** and ask: *"Tell me everything about [Donor Name]"* — this pulls their full Blackbaud profile, giving history, relationships, and associated entities.
2. Ask: *"Search the web for [Donor Name] and their company — any recent news or philanthropic activity?"*
3. Ask: *"Based on their giving history, what would be an appropriate ask amount and fund?"*
4. Use **Meeting Prep** to generate a donor meeting briefing.
5. After the meeting, use **Quick Notes** to capture outcomes and **Action Centre** to create follow-ups.

---

## What Fund-Raise Replaces

Fund-Raise consolidates 4-6 tools that the typical RE NXT foundation pays for separately:

| Tool You're Replacing | What You Pay Today | What Fund-Raise Gives You |
|---|---|---|
| **Blackbaud Insight Designer** | $2,500/year | 30+ built-in dashboards — Retention, LYBUNT/SYBUNT, giving pyramid, campaign compare, fund health, and more |
| **MissionBI Connect / Zuri Aqueduct** | $3,000–$10,000/year | Direct CSV/Excel import with auto-mapping to PostgreSQL — no middleware, no managed service fees |
| **Power BI Pro + CData Connector** | $1,000–$4,000/year | Native visualizations (charts, trend lines, comparison bars, giving pyramids) rendered in-app |
| **Excel Exports + Manual Analysis** | 8–15 hrs/month staff time | Board report PDFs + AI queries — one-click generation, ask AI instead of building spreadsheets |
| **Crystal Reports (Legacy)** | $500–$1,500/year + staff expertise | No coding required — pre-built analytics without SQL or database admin |
| **Standalone AI Writing Tools** | $240–$6,000/year | 6 built-in writing tools with full donor data context — not generic AI, but fundraising-specific |
| **Typical Annual Cost** | **$7,000–$24,000** | **Fund-Raise: $199/month ($2,388/year)** |

### Pricing

- **Monthly:** $199 CAD/month
- **Annual:** $2,030 CAD/year (save 15% — $358 savings)
- **Unlimited users** — no per-seat fees
- **Everything included** — no add-ons, no hidden costs

---

## Frequently Asked Questions

### General

**Q: What CRM systems does Fund-Raise work with?**
A: Fund-Raise is designed for foundations using Blackbaud RE NXT, but any CRM that can export gift data to CSV or Excel can be used with Fund-Raise's import engine. The Blackbaud direct integration (Deep Dive) requires RE NXT with SKY API access.

**Q: How many users can I have?**
A: Unlimited. There are no per-seat fees. Invite your entire team — from gift officers to board members.

**Q: Is my data secure?**
A: Yes. Each organization's data is completely isolated using PostgreSQL row-level security. Data is encrypted in transit (HTTPS) and at rest. No data is shared between organizations. The AI assistant processes your data in-session and does not use it for training.

**Q: How often should I import data?**
A: Most foundations import weekly or bi-weekly. Fund-Raise shows you "data freshness" so you always know how current your dashboards are. Each import updates all 30+ dashboards automatically.

**Q: Can I export data out of Fund-Raise?**
A: Yes. Every data table includes CSV export. You can also generate 10 different PDF reports with one click.

### Ask Fund-Raise (AI)

**Q: Is Ask Fund-Raise a generic AI chatbot?**
A: No. Ask Fund-Raise is a specialized fundraising analyst with 50 purpose-built tools. It has direct access to your imported data and can query, analyze, chart, and interpret your fundraising metrics. It speaks the language of philanthropy — RFM scores, LYBUNT/SYBUNT, retention rates, donor lifecycle stages — not generic business analytics.

**Q: Does Ask Fund-Raise make up data?**
A: No. Every response is grounded in your actual data. If a metric isn't available, it says so explicitly rather than estimating. Currency is formatted precisely, percentages to one decimal place.

**Q: What is Deep Dive mode?**
A: Deep Dive extends Ask Fund-Raise with live Blackbaud RE NXT lookups and web search. Without Deep Dive, Ask Fund-Raise works with your imported data (which covers all aggregate analytics). With Deep Dive, it can also look up individual donor profiles, real-time gifts, relationships, and search the web for benchmarks and research.

**Q: Does Deep Dive cost extra?**
A: No. Deep Dive is included in your subscription. It uses your organization's Blackbaud SKY API quota (1,000 calls/day), which is shared with any other tools that use your SKY API credentials.

**Q: Can Ask Fund-Raise modify my CRM data?**
A: No. Ask Fund-Raise is read-only. It can query, analyze, and report on your data, but it cannot modify records in Blackbaud or in Fund-Raise's database. The only "write" action it can perform is creating Action Centre tasks.

**Q: Can I share an Ask Fund-Raise conversation with my team?**
A: Yes. Click the share button on any conversation to make it visible to other team members in your organization.

**Q: Can I upload screenshots for Ask Fund-Raise to analyze?**
A: Yes. Click the paperclip icon or paste an image from your clipboard. Ask Fund-Raise can read and analyze screenshots, charts, documents, or any visual content (PNG, JPEG, GIF, WebP up to 5MB).

### Data & Integration

**Q: How do I connect Blackbaud RE NXT?**
A: An Admin goes to Settings > Integrations > Connect Blackbaud. You'll authorize Fund-Raise through Blackbaud's OAuth flow. Once connected, the status appears across the platform and Ask Fund-Raise gains Deep Dive capabilities.

**Q: What if I don't use Blackbaud?**
A: Fund-Raise works with any CRM that can export to CSV or Excel. You won't have the Deep Dive live lookup feature, but all 30+ dashboards, analytics, AI writing tools, and Ask Fund-Raise (with your imported data) work perfectly.

**Q: How long does a data import take?**
A: Most imports complete in under a minute. Large files (50,000+ gifts) may take a few minutes. You'll see a progress indicator and notification when complete.

**Q: Can I import data from multiple years?**
A: Yes. Fund-Raise supports multi-year data for year-over-year comparisons, retention analysis, and lifecycle tracking. The more historical data you import, the richer your analytics.

### Pricing & Support

**Q: Is there a free trial?**
A: Yes. Get started free to explore the platform, import your data, and try every feature.

**Q: Can I cancel anytime?**
A: Yes. Monthly subscriptions can be cancelled at any time. Annual subscriptions are billed once and run for the full year.

**Q: How do I get support?**
A: Email support@fund-raise.com. We also offer onboarding assistance to help you get set up and train your team.

**Q: Is Fund-Raise available in French?**
A: The platform currently operates in English with Canadian English spelling conventions (honour, centre, colour). French language support is on the roadmap.

---

## Summary

Fund-Raise brings together everything a RE NXT foundation needs for fundraising intelligence:

- **See everything** — 30+ dashboards that populate automatically
- **Ask anything** — AI assistant with 50 specialized tools and live CRM access
- **Write anything** — 6 AI writing tools with donor data context
- **Report anything** — 10 one-click PDF reports + CSV export everywhere
- **Collaborate** — Team board, kudos, action centre, and shared conversations
- **Save money** — Replace $7,000–$24,000 in scattered tools with one $199/month platform

**Get started at fund-raise.com** or contact support@fund-raise.com.

---

*Fund-Raise — The fundraising intelligence platform for RE NXT foundations.*
