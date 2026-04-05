# Fund-Raise Platform — Complete Feature Guide & User Manual

> **Last Updated:** April 5, 2026
> **Version:** Current production build
> **Platform:** Web application (Node.js / Express / PostgreSQL / EJS)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [CRM Dashboard & Overview](#crm-dashboard--overview)
3. [Donor Analytics](#donor-analytics)
4. [Gift & Fund Analytics](#gift--fund-analytics)
5. [Comparisons & Benchmarking](#comparisons--benchmarking)
6. [Fundraiser & Goal Tracking](#fundraiser--goal-tracking)
7. [AI & Intelligence](#ai--intelligence)
8. [Writing & Communication Tools](#writing--communication-tools)
9. [Team Collaboration](#team-collaboration)
10. [Planning & Forecasting](#planning--forecasting)
11. [Data Management & Imports](#data-management--imports)
12. [Integrations](#integrations)
13. [Legacy Dashboards](#legacy-dashboards)
14. [Administration](#administration)

---

## Getting Started

### Authentication
- **Google OAuth 2.0** — Sign in with your Google account
- **Role-based access** — Admin, Uploader, and Regular user roles
- **Session persistence** — Stay logged in across browser sessions

### First Login
- New users land on the **CRM Dashboard** (`/crm-dashboard`)
- If no CRM data has been imported, a **Welcome to Fund-Raise** onboarding screen appears with:
  - 3-step guide: Export from CRM → Upload → Explore
  - Direct link to the CRM Import page
  - Feature grid previewing available dashboards

### User Profile (`/profile`)
- Edit display name, job title, and bio
- Upload a custom avatar (JPG, PNG, GIF, WebP)
- View and manage your profile settings

---

## CRM Dashboard & Overview

### CRM Dashboard (`/crm-dashboard`)
The central hub for all CRM analytics. Loaded via AJAX in batches to prevent timeouts.

**KPI Cards (Row 1):**
- Total Raised — with gift count and YoY comparison
- Unique Donors — with YoY comparison
- Average Gift — with YoY comparison
- Largest Gift

**KPI Cards (Row 2):**
- Unique Funds
- Campaigns
- Appeals
- Date Range

**Proactive Insight Cards** (auto-generated on login):
- Donors at risk of lapsing (count + revenue at risk)
- YoY giving comparison (up/down %)
- First-time donor retention rate vs 19% national benchmark
- Upgrade/downgrade summary
- Recent large gifts ($1K+ in last 30 days)
- High-severity anomalies detected (links to Anomaly Detection)

**Additional Sections:**
- Giving Over Time chart (monthly/quarterly/fiscal year toggles, bar + cumulative line)
- Donor Retention summary (retained, lapsed, new, recovered)
- Top Donors, Funds, Campaigns, Appeals tables
- Gift Types breakdown
- Giving Pyramid (donor distribution by gift-size bands)
- Fiscal Year picker (April 1 – March 31)
- Export Dashboard button (full CSV export)

### Department Analytics (`/crm/department-analytics`)
Pre-computed department classification (Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving) using regex-based signal matching at import time.

**Features:**
- Revenue by department with gift counts and donor counts
- Department trend over time
- Average gift by department
- Cross-department giving analysis (lazy-loaded)
- Multi-department donors
- Signal sample showing how gifts were classified

### Department Goals (`/crm/department-goals`)
- Set dollar goals per department per fiscal year
- Org-wide progress bar
- KPI cards: Org Goal, Total Raised, On Track, At Risk
- Per-department cards with color-coded progress bars
- Save/delete goal functionality

### Data Quality Dashboard (`/crm/data-quality`)
- Weighted health score (0-100, critical fields count double)
- Field completeness bars for 10 data columns
- Anomaly detection: negative amounts, future dates, very old dates
- Potential duplicate gifts (same donor + amount + date)
- Potential duplicate constituents (same last name + first initial)
- Records needing attention table with issue counts
- Smart recommendations for data improvement

### Anomaly Detection (`/crm/anomalies`)
Statistical analysis that auto-flags unusual patterns:

- **Monthly giving spikes/drops** — months >1.5 standard deviations from mean
- **Outlier gifts** — individual gifts >3 standard deviations above average
- **Fund anomalies** — funds with >50% change in last 90 days vs historical rate
- **Donor behavior changes** — individual donors with >200% giving change YoY
- **Seasonal trends** — current quarter vs same quarter last year (>20% deviation)

Each anomaly has severity badges (High/Medium), category filters, and color-coded cards.

### AI Recommendations (`/crm/recommendations`)
Data-driven actionable suggestions, each with priority, reasoning, and direct links:

- **Thank-you notes** — recent first-time donors needing acknowledgment
- **Lapsed major donor re-engagement** — $1K+ donors who haven't renewed
- **Upgrade candidates** — donors with 25%+ growth in $250-$5K range
- **Recurring giving conversion** — frequent donors not yet on recurring
- **Year-end appeal targeting** — historical Nov/Dec donors (seasonal)
- **Data quality** — donors missing emails who give $100+

### Board Report PDF (`/crm/board-report`)
Server-side PDF generation using PDFKit:

- Select fiscal year and download instantly
- Multi-page professional PDF includes:
  - Executive Summary (8 KPIs)
  - Year-over-Year comparison with % changes
  - Donor retention metrics
  - Top 10 Donors table
  - Top 10 Funds table
  - Top 10 Campaigns table
  - Giving Pyramid breakdown
  - Confidential board footer with generation date

### Gift Search (`/crm/gifts`)
- Full-text search across all gift records
- Filter by fund, campaign, appeal, gift type, date range
- Sortable columns
- Donor detail links

---

## Donor Analytics

### Donor Scoring (`/crm/donor-scoring`)
RFM-based donor segmentation:
- **Recency** — days since last gift
- **Frequency** — total gift count
- **Monetary** — total giving amount
- Combined RFM score with segment labels
- Top scored donors table

### Retention Analytics (`/crm/retention`)
Enhanced drill-down retention dashboard:

- **Overall KPIs** — retention rate, prior donors, retained, lapsed
- **Multi-year retention trend** — bar chart for last 5 fiscal years
- **By Department** — color-coded retention bars per department
- **By Giving Level** — 6 bands from $1-$99 to $10,000+
- **By Fund** — top 15 funds with retention rates and visual bars
- **By Campaign** — top 15 campaigns with retention rates

### Recurring Donors (`/crm/recurring-donors`)
- Recurring vs one-time donor comparison
- Recurring donor revenue and trends
- Recurring donor list with gift frequency

### Donor Lifecycle (`/crm/donor-lifecycle`)
- Lifecycle stage classification: New, Growing, Recovered, Declining, At Risk, Lapsed
- Visual lifecycle flow with counts and percentages
- At-risk donor list with lifetime totals and risk type
- CSV export for outreach

### Donor Insights (`/crm/donor-insights`)
- AI-generated insights about donor behavior patterns
- Giving pattern analysis
- Donor segmentation recommendations

### LYBUNT / SYBUNT (`/crm/lybunt-sybunt`)
"Last Year But Unfortunately Not This Year" / "Some Years But Unfortunately Not This Year"

- **LYBUNT** — donors who gave in prior FY but not current FY
- **SYBUNT** — donors who gave 2+ years ago but not last year or this year
- KPI cards: LYBUNT donors, SYBUNT donors, Total At Risk, Revenue at Risk
- Side-by-side giving band bar charts (red LYBUNT / amber SYBUNT)
- Filterable donor table with All/LYBUNT/SYBUNT tabs
- CSV export

### Upgrade / Downgrade Tracking (`/crm/donor-upgrade-downgrade`)
Year-over-year donor giving change:

- **Classifications:** Upgraded (>10% up), Maintained (±10%), Downgraded (>10% down), Lapsed, New
- Revenue KPIs: current FY revenue, prior FY revenue, net change with YoY %
- 5 category cards with donor count, % share, and revenue impact
- Revenue waterfall chart (visual bar heights by dollar impact)
- Giving change distribution (7 bands: "Down 50%+" through "Up 50%+")
- Top 100 movers table with category tabs + CSV export

### First-Time Donor Conversion (`/crm/first-time-donors`)
Tracks the first gift → second gift pipeline:

- Visual conversion funnel (first-time → repeat → still waiting)
- Conversion rate benchmarked against **19% national average** (FEP)
- Time-to-second-gift distribution (5 time bands)
- Conversion rate by first gift size (6 giving bands)
- Auto-generated insights comparing your org to benchmarks
- Outreach list of unconverted one-time donors with urgency badges (Hot/Warm/Cold)
- CSV export

### Household Giving (`/crm/household-giving`)
Deduplicated household-level giving using soft credit data:

- Groups donors into households by linking hard-credit donors with soft-credit recipients
- KPIs: Individual donors, Linked households, Effective households, Deduplication rate
- Visual individual vs household comparison
- Top 100 households ranked by combined giving
- Expandable member breakdown showing individual contributions
- CSV export

### Donor Detail (`/crm/donor/:constituentId`)
- Individual donor profile with giving history
- Gift timeline
- Fund/campaign/appeal breakdown
- Lifetime metrics

---

## Gift & Fund Analytics

### Acknowledgments (`/crm/acknowledgments`)
- Track gift acknowledgment status
- Unacknowledged gifts list
- Acknowledgment rate metrics

### Matching Gifts (`/crm/matching-gifts`)
- Matching gift analysis
- Revenue from matching gifts
- Top matching gift companies

### Soft Credits (`/crm/soft-credits`)
- Soft credit analysis
- Top recipients by soft credit amount
- Soft credits by fund

### Payment Methods (`/crm/payment-methods`)
- Gift distribution by payment method
- Average gift by payment type
- Unique donors per payment method

### Gift Trends (`/crm/gift-trends`)
- Gift trend analysis over time
- Gift type distribution changes
- Average gift trajectory

---

## Comparisons & Benchmarking

### Campaign Compare (`/crm/campaign-compare`)
- Side-by-side campaign performance comparison
- Revenue, donor count, average gift per campaign
- Visual comparison bars

### Appeal Compare (`/crm/appeal-compare`)
- Appeal performance comparison
- Revenue and donor metrics by appeal
- Appeal detail drill-down (`/crm/appeal/:appealId`)

### Fund Health (`/crm/fund-health`)
- Fund health scoring and analysis
- Revenue trends per fund
- Risk indicators for declining funds

### Year-over-Year (`/crm/yoy-compare`)
- Full YoY comparison across all metrics
- Monthly and quarterly breakdowns
- Growth/decline indicators

---

## Fundraiser & Goal Tracking

### Fundraiser Performance (`/fundraiser-performance`)
- Fundraiser leaderboard with credited amounts
- Individual fundraiser drill-down
- Gift attribution and portfolio analysis
- Fundraiser-specific metrics

### Fundraiser Goals (`/fundraiser-goals`)
- Set goals per fundraiser per fiscal year
- Progress tracking with visual bars
- Leaderboard merged with goal data
- Save/delete goal management

---

## AI & Intelligence

### Ask Fund-Raise (`/ask`)
AI-powered conversational analytics assistant:

- **Chat interface** with streaming responses
- **Conversation management** — save, load, rename, delete conversations
- **Team sharing** — share conversations with colleagues
- **Image upload** — attach screenshots for AI analysis
- **Deep dive mode** — extended analysis of complex questions
- **CRM mode** — donor-focused queries with data context
- **RE NXT knowledge base** — Blackbaud-specific guidance
- **Push panel behavior** — slides content over instead of overlaying

### Ask Fund-Raise Panel
- Available on every page via sidebar
- 540px push panel that shifts main content
- Quick access to AI without leaving current dashboard

---

## Writing & Communication Tools

### Writing Assistant (`/writing-assistant`)
AI-powered writing tool for donor communications:

- **Modes:** Draft from scratch, Polish/edit existing draft, Reply to message
- **Content Types:** Thank you letter, Sympathy/condolence card, Donor email, Event invitation, Follow-up email, General correspondence
- **Tones:** Warm & personal, Professional & formal, Celebratory, Empathetic
- Streaming output via SSE

### Thank-You Letters (`/thank-you-letters`)
- **Styles:** Formal, Warm, Brief, Impact-focused, Handwritten card
- Personalization: Donor name, gift amount, gift type, designation, personal notes
- AI-generated with streaming output

### Impact Stories (`/impact-stories`)
- **Formats:** Annual Report Narrative, Social Media Post, Donor Newsletter, Website Feature, Board Presentation Slide
- **Focus Areas:** Patient Care, Equipment & Technology, Research, Education & Training, General Operations
- Parameters: Gift amount, donor type, additional context

### Meeting Prep (`/meeting-prep`)
- **Meeting Types:** Board Presentation, Donor Meeting, Department Check-In, Campaign Strategy Session, Year-End Review, New Donor Cultivation
- Generates: Meeting Overview, Key Talking Points, Data Highlights, Discussion Questions, Action Items Template
- Pulls live fundraising data for context

### Weekly Digest (`/weekly-digest`)
- **Tones:** Professional, Casual, Celebratory, Strategic
- **Audiences:** Team, Leadership, Board, All Staff
- Generates: Numbers at a Glance, Wins This Week, Looking Ahead
- Uses latest snapshot data

### Quick Notes (`/notes`)
- Sticky note interface for quick note-taking
- Color-coded notes
- User-specific, sortable

---

## Team Collaboration

### Staff Directory (`/directory`)
- Full team member listing
- Individual profile views (`/directory/:userId`)
- Job titles, avatars, bios

### Message Board (`/board`)
- Discussion forum for team communication
- **Categories:** Announcement, Question, Idea, General, Shout-Out
- Post creation, editing, and deletion
- Comments and replies
- Pin/unpin posts (admin)
- Pagination

### Milestones (`/milestones`)
- Campaign milestone tracking and celebrations
- Create milestones with target values
- Mark milestones as reached with celebration animations
- Celebration emoji support

### Kudos Wall (`/kudos`)
- Team recognition and appreciation
- **Categories:** General, Teamwork, Innovation, Above-and-beyond, Milestone, Mentorship
- Emoji reactions
- Leaderboard with top kudos receivers

### Fundraising Bingo (`/bingo`)
- 5x5 bingo board with 25 fundraising challenges
- Example challenges: "Get a new recurring donor", "Send 5 thank-you letters", "Secure a gift over $1,000"
- Track square completions
- Automatic bingo detection (rows, columns, diagonals)
- Leaderboard with team rankings
- Admin reset

---

## Planning & Forecasting

### Campaign Thermometer (`/thermometer`)
- Visual fundraising progress visualization
- Department-level raised vs goal breakdown
- Color-coded by department
- Supports up to 150% overfunding display
- Overall campaign progress

### Scenario Planner (`/scenario-planner`)
- What-if analysis tool
- Adjust department metrics: raised, goal, gifts, average gift
- See projected outcomes based on changes

---

## Data Management & Imports

### CRM Import (`/crm-upload`)
Primary data import for CRM gift data:

- **Supported formats:** CSV, Excel (.xlsx)
- **File size limit:** 300MB
- **Auto-column mapping** — intelligently maps your columns to Fund-Raise fields
- **Preview before import** — review mapped data before committing
- **Background processing** — import runs in background with progress polling
- **Import history** — track past imports with statistics
- **Data processed:** Gifts, Fundraisers, Soft Credits, Matching Gifts
- **Post-import features:**
  - Department auto-classification on every gift
  - Cache warming (pre-fires 9 key queries for instant dashboard loads)
  - Covering index creation for sub-second queries

### Regular Data Upload (`/upload`)
Legacy upload for department snapshot data:

- Excel file uploads by department
- Snapshot date selection
- Overwrite protection for existing snapshots
- Supports: Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving

---

## Integrations

### Blackbaud RE NXT (`/settings/blackbaud`)
- OAuth 2.0 connection management
- Token storage and auto-refresh
- Connection status display
- Connect/disconnect functionality
- Live Dashboard placeholder (coming soon)

### Google OAuth
- Sign in with Google
- Automatic account provisioning
- Session management with Passport.js

---

## Legacy Dashboards

> These dashboards use the older snapshot-based data model (pre-CRM). They appear at the bottom of the sidebar under "Legacy Dashboards" with a "Snapshot" badge.

### Master Dashboard (`/dashboard`)
- Overall fundraising overview from snapshot data
- Deprecation banner linking to CRM Dashboard

### Analytics (`/analytics`)
- Cross-department analytics from snapshot data

### Trends (`/trends`)
- Trend analysis and forecasting from snapshot data

### Department Pages
- Annual Giving (`/departments/annual_giving`)
- Direct Mail (`/departments/direct_mail`)
- Events (`/departments/events`)
- Major Gifts (`/departments/major_gifts`)
- Legacy Giving (`/departments/legacy_giving`)

---

## Administration

### Admin Panel (Admin users only)
- **Upload Data** (`/upload`) — Department snapshot uploads
- **CRM Import** (`/crm-upload`) — CRM gift data import
- **Blackbaud Settings** (`/settings/blackbaud`) — Integration management

### Role Capabilities
| Capability | Admin | Uploader | Regular |
|-----------|-------|----------|---------|
| View all dashboards | Yes | Yes | Yes |
| Upload department data | Yes | Yes | No |
| Import CRM data | Yes | Yes | No |
| Manage Blackbaud | Yes | No | No |
| Pin board posts | Yes | No | No |
| Reset bingo boards | Yes | No | No |
| Delete milestones | Yes | No | No |

---

## Data Export Capabilities

| Feature | Export Type | Contents |
|---------|-----------|----------|
| CRM Dashboard | CSV | Full dashboard data |
| Board Report | PDF (PDFKit) | Executive summary, top 10s, pyramid |
| Donor Lifecycle | CSV | At-risk donor list |
| LYBUNT/SYBUNT | CSV | Lapsed donor list (filterable) |
| Upgrade/Downgrade | CSV | Top movers (filterable by category) |
| First-Time Donors | CSV | Unconverted donor outreach list |
| Household Giving | CSV | Top households ranked by giving |

---

## Technical Highlights

- **Pre-computed department classification** at import time (not query time) — sub-second queries
- **In-memory cache** with 10-minute TTL for all analytics functions
- **Cache warming** after CRM import — pre-fires 9 key queries in background
- **Covering indexes** (PostgreSQL INCLUDE) for index-only scans
- **Lazy-loading** for expensive analytics sections
- **Server-side timeout guards** (25s) to prevent 504 errors
- **Batch query execution** to avoid database overload
- **45+ analytics functions** across 30+ dashboards
- **SSE streaming** for AI chat and writing tools
- **Responsive design** — works on desktop and mobile

---

## Platform Statistics

- **30+ CRM analytics dashboards**
- **45+ analytics service functions**
- **6 AI-powered writing tools**
- **5 team collaboration features**
- **2 planning tools**
- **7 CSV export capabilities**
- **1 PDF report generator**
- **5 department views (legacy)**
- **3 public pages** (landing, privacy, terms)

---

*Generated from the Fund-Raise codebase — April 5, 2026*
