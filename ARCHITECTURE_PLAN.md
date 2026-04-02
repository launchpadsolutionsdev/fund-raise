# Thunder Bay Regional Health Sciences Foundation — Internal Dashboard

## Architecture Plan & Technical Specification

**Prepared for:** Claude Code Build Session
**Date:** April 2, 2026
**Stack:** Python/Flask + PostgreSQL + Chart.js
**Hosting:** Render (Web Service + PostgreSQL)

---

## 1. Project Overview

Build an internal dashboard for the Thunder Bay Regional Health Sciences Foundation's Philanthropy division. The dashboard ingests daily Excel spreadsheet uploads from 5 departments, stores historical snapshots, and presents the data through interactive Chart.js visualizations. Multiple users can log in via Google OAuth.

### Five Departments

| Department | Spreadsheet File | RAW Data Rows | Key Metrics |
|---|---|---|---|
| Annual Giving | `Annual Giving reporting master sheet.xlsx` | ~9,700 | Total gifts, total amount, goal ($250K), gift type breakdown, source breakdown, fund breakdown |
| Direct Mail | `Direct Mail reporting master sheet.xlsx` | ~1,850 | Total gifts, total amount, goal ($300K), gift type breakdown, source breakdown, campaign/fund breakdown |
| Events | `Events reporting master sheet.xlsx` | ~1,870 | Special Events + Third Party Events (separate goals: $190K / $280K), gift type breakdown, fund breakdown for both categories |
| Major Gifts | `Major reporting master sheet.xlsx` | ~146 | Total gifts, total amount, goal ($2M), gift type breakdown, fund breakdown |
| Legacy Giving | `legacy reporting master sheet.xlsx` | ~26 | Total gifts, total amount, avg gift, goal ($1.2M), gift type, new expectancies, open estates, fund breakdown |

### Combined Fundraising Goal: $4,220,000

---

## 2. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | Python 3.11+ / Flask | Simple, beginner-friendly, great ecosystem |
| Database | PostgreSQL (Render managed) | Free tier on Render, great for structured data |
| ORM | SQLAlchemy + Flask-Migrate (Alembic) | Database models in Python, easy migrations |
| Auth | Google OAuth 2.0 via Flask-Login + Authlib | User already has Google Cloud Console set up |
| Frontend | Jinja2 templates + Bootstrap 5 + Chart.js | Server-rendered HTML, no separate frontend build step |
| File Parsing | openpyxl + pandas | Read Excel uploads, extract REPORT + RAW sheets |
| Deployment | Render Web Service + Render PostgreSQL | Simple Git-push deploy |

---

## 3. Project Structure

```
foundation-dashboard/
├── app/
│   ├── __init__.py              # Flask app factory
│   ├── config.py                # Config (dev/prod, DB URLs, Google OAuth keys)
│   ├── extensions.py            # db, migrate, login_manager, oauth
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py              # User model (Google OAuth)
│   │   ├── tenant.py            # Tenant model (multi-tenant)
│   │   ├── snapshot.py          # DailySnapshot model (one per upload date)
│   │   ├── department_summary.py # Summary metrics per department per snapshot
│   │   ├── gift_type_breakdown.py
│   │   ├── source_breakdown.py
│   │   ├── fund_breakdown.py
│   │   └── raw_gift.py          # Individual gift records from RAW sheets
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── auth.py              # Google OAuth login/logout/callback
│   │   ├── dashboard.py         # Main combined dashboard
│   │   ├── departments.py       # Individual department dashboards
│   │   ├── upload.py            # File upload + processing
│   │   └── api.py               # JSON API endpoints for Chart.js
│   ├── services/
│   │   ├── __init__.py
│   │   ├── excel_parser.py      # Parse each department's Excel file
│   │   └── snapshot_service.py  # Create/retrieve snapshots
│   ├── templates/
│   │   ├── base.html            # Base layout with sidebar nav
│   │   ├── login.html           # Google Sign-In page
│   │   ├── dashboard/
│   │   │   └── main.html        # Combined master dashboard
│   │   ├── departments/
│   │   │   ├── annual_giving.html
│   │   │   ├── direct_mail.html
│   │   │   ├── events.html
│   │   │   ├── major_gifts.html
│   │   │   └── legacy_giving.html
│   │   └── upload/
│   │       └── upload.html      # Upload page with drag-and-drop
│   └── static/
│       ├── css/
│       │   └── style.css        # Custom styles
│       └── js/
│           ├── charts.js        # Chart.js initialization helpers
│           └── upload.js        # Upload form handling
├── migrations/                  # Flask-Migrate / Alembic
├── requirements.txt
├── render.yaml                  # Render deployment blueprint
├── .env.example                 # Environment variable template
├── .gitignore
└── run.py                       # Entry point
```

---

## 4. Database Schema

### Core Tables

#### `tenants`
```
id              SERIAL PRIMARY KEY
name            VARCHAR(255) NOT NULL        -- "Thunder Bay Regional HSF"
slug            VARCHAR(100) UNIQUE NOT NULL  -- "tbrhsf"
created_at      TIMESTAMP DEFAULT NOW()
```

#### `users`
```
id              SERIAL PRIMARY KEY
tenant_id       INTEGER REFERENCES tenants(id)
email           VARCHAR(255) UNIQUE NOT NULL
name            VARCHAR(255)
google_id       VARCHAR(255) UNIQUE
avatar_url      TEXT
role            VARCHAR(50) DEFAULT 'viewer'  -- 'admin', 'uploader', 'viewer'
is_active       BOOLEAN DEFAULT TRUE
created_at      TIMESTAMP DEFAULT NOW()
last_login      TIMESTAMP
```

#### `snapshots`
```
id              SERIAL PRIMARY KEY
tenant_id       INTEGER REFERENCES tenants(id)
snapshot_date   DATE NOT NULL                 -- The date this data represents
uploaded_by     INTEGER REFERENCES users(id)
uploaded_at     TIMESTAMP DEFAULT NOW()
notes           TEXT                          -- Optional notes about this upload
UNIQUE(tenant_id, snapshot_date)              -- One snapshot per tenant per day
```

#### `department_summaries`
```
id              SERIAL PRIMARY KEY
snapshot_id     INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
department      VARCHAR(50) NOT NULL          -- 'annual_giving', 'direct_mail', 'events', 'major_gifts', 'legacy_giving'
total_gifts     INTEGER
total_amount    DECIMAL(12,2)
goal            DECIMAL(12,2)
pct_to_goal     DECIMAL(8,6)
-- Legacy-specific fields (NULL for other departments)
avg_gift        DECIMAL(12,2)
new_expectancies INTEGER
open_estates    INTEGER
recorded_expectancies INTEGER
-- Events-specific fields (NULL for other departments)
third_party_total_gifts   INTEGER
third_party_total_amount  DECIMAL(12,2)
third_party_goal          DECIMAL(12,2)
third_party_pct_to_goal   DECIMAL(8,6)
```

#### `gift_type_breakdowns`
```
id              SERIAL PRIMARY KEY
snapshot_id     INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
department      VARCHAR(50) NOT NULL
gift_type       VARCHAR(100) NOT NULL         -- 'Cash', 'Pledge Payments', 'Gift-in-Kind', 'Recurring Gifts'
amount          INTEGER
pct_of_gifts    DECIMAL(8,6)
```

#### `source_breakdowns`
```
id              SERIAL PRIMARY KEY
snapshot_id     INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
department      VARCHAR(50) NOT NULL          -- Only Annual Giving and Direct Mail have this
source          VARCHAR(100) NOT NULL         -- 'Online', 'Mailed in'
amount          INTEGER
pct_of_gifts    DECIMAL(8,6)
```

#### `fund_breakdowns`
```
id              SERIAL PRIMARY KEY
snapshot_id     INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
department      VARCHAR(50) NOT NULL
category        VARCHAR(50) DEFAULT 'primary' -- 'primary' or 'third_party' (for Events)
fund_name       VARCHAR(255) NOT NULL
amount          DECIMAL(12,2)
pct_of_total    DECIMAL(8,6)
-- Annual Giving & Direct Mail extra columns
onetime_count   INTEGER
recurring_count INTEGER
online_count    INTEGER
mailed_in_count INTEGER
total_count     INTEGER
```

#### `raw_gifts`
```
id              SERIAL PRIMARY KEY
snapshot_id     INTEGER REFERENCES snapshots(id) ON DELETE CASCADE
department      VARCHAR(50) NOT NULL
primary_addressee VARCHAR(255)
appeal_id       VARCHAR(255)
split_amount    DECIMAL(12,2)
fund_description VARCHAR(255)
gift_id         INTEGER
gift_type       VARCHAR(100)
gift_reference  VARCHAR(255)
gift_date       DATE
extra_field     VARCHAR(255)                  -- Gift Batch Number OR Appeal Category/Description
```

---

## 5. Excel Parsing Logic

Each spreadsheet has the same 3-sheet structure: REPORT, RAW, INSTRUCTIONS.

### REPORT Sheet Parsing Rules

All five REPORT sheets follow a similar pattern. Parse by scanning column A for known label strings:

| Row Label (Column A) | Column B Value | Field |
|---|---|---|
| `Total Gifts *` | integer | total_gifts |
| `Total amount *` or `total bequest` | decimal | total_amount |
| `* Goal` | decimal | goal |
| `% to Goal` | decimal | pct_to_goal |
| `average legacy gift` | decimal | avg_gift (Legacy only) |
| `# of New Confirmed Expectancies` | integer | new_expectancies (Legacy only) |
| `# of Open Estates` | integer | open_estates (Legacy only) |

**Gift Type Breakdown:** Starts after "Gift Type" header row, ends at blank row.
**Source Breakdown:** Starts after "Source" header row (Annual Giving & Direct Mail only).
**Fund Breakdown:** Starts after "Gift By Fund" header row, ends at blank row.
**Events special case:** Columns D-F contain Third Party Events data in parallel.

### RAW Sheet Parsing

All RAW sheets have a header row followed by transaction data. Common columns across all:
- Primary Addressee, Appeal ID, Appeal Split Amount, Fund Description, Gift ID, Gift Type, Gift Reference, Gift Date

The 9th column varies:
- Annual Giving & Direct Mail: `Gift Batch Number`
- Events: `Appeal Category`
- Major Gifts: `Appeal Description`
- Legacy: No 9th column

---

## 6. Key Features

### 6A. Sidebar Navigation

```
┌─────────────────────────────────────────────────┐
│ [LOGO] TBRHSF Dashboard                        │
│                                                 │
│ 📊 Master Dashboard          ┌──────────────── │
│                               │                 │
│ DEPARTMENTS                   │  [Dashboard     │
│ ├─ Annual Giving              │   Content       │
│ ├─ Direct Mail                │   Area]         │
│ ├─ Events                     │                 │
│ ├─ Major Gifts                │                 │
│ └─ Legacy Giving              │                 │
│                               │                 │
│ ⬆️  Upload Data               │                 │
│                               │                 │
│ 📅 Date: [Apr 2, 2026 ▾]     │                 │
│                               │                 │
│ [User Avatar]                 │                 │
│ user@email.com                │                 │
│ [Logout]                      │                 │
└─────────────────────────────────────────────────┘
```

The sidebar includes a **date picker** that lets users browse historical snapshots.

### 6B. Master Dashboard (Main View)

Shows combined data from all 5 departments at a glance:

**Row 1 — KPI Cards:**
- Total Raised (all departments combined): `$4,451,633`
- Combined Goal: `$4,220,000`
- Overall % to Goal: `105.5%`
- Total Gifts Count: `12,452`

**Row 2 — Department Progress Bars:**
Five horizontal progress bars showing each department's % to goal, color-coded:
- Annual Giving: 246.6% ████████████ $616K / $250K
- Direct Mail: 84.0% ████████░░ $252K / $300K
- Events (Combined): 146.8% ██████████ $691K / $470K
- Major Gifts: 125.0% ██████████ $2.5M / $2M
- Legacy Giving: 59.6% ██████░░░ $716K / $1.2M

**Row 3 — Charts:**
- Pie chart: Revenue distribution by department
- Bar chart: Goal vs Actual by department
- Line chart: Trend over time (once multiple snapshots exist)

### 6C. Individual Department Dashboards

Each department page shows:
1. **KPI Cards** — Total gifts, total amount, goal, % to goal
2. **Gift Type Breakdown** — Doughnut chart (Cash, Pledge, GiK, Recurring)
3. **Source Breakdown** — Pie chart (Online vs Mailed In) — where applicable
4. **Fund Breakdown** — Horizontal bar chart showing all funds ranked by amount
5. **Trend Charts** — Line charts showing metrics over time (across snapshots)
6. **Raw Data Table** — Searchable, sortable table of individual gifts (paginated)

### 6D. Upload System

- **Upload page** with drag-and-drop zones for each of the 5 spreadsheets
- User selects a **date** for the snapshot (defaults to today)
- Backend parses each file, validates structure, extracts all data
- If a snapshot already exists for that date, user is warned and can choose to overwrite
- Upload progress indicators for each file
- Validation errors shown inline (e.g., "Missing REPORT sheet", "Unexpected column names")

### 6E. Historical Date Browsing

- Date picker in sidebar shows only dates that have snapshots (highlighted on calendar)
- Selecting a date loads that day's snapshot across all dashboards
- The master dashboard trend charts pull from ALL snapshots to show progress over time

### 6F. User Roles

| Role | View Dashboards | Upload Data | Manage Users |
|---|---|---|---|
| viewer | ✅ | ❌ | ❌ |
| uploader | ✅ | ✅ | ❌ |
| admin | ✅ | ✅ | ✅ |

---

## 7. Google OAuth Setup

### Prerequisites (Google Cloud Console)
1. Create a project (or use existing)
2. Enable the "Google Identity" API
3. Configure OAuth consent screen (Internal if using Google Workspace, External otherwise)
4. Create OAuth 2.0 Client ID credentials:
   - Authorized redirect URI: `https://your-app.onrender.com/auth/callback`
   - For local dev: `http://localhost:5000/auth/callback`
5. Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as environment variables

### Flask Auth Flow
1. User clicks "Sign in with Google" → redirect to Google
2. Google authenticates → redirects to `/auth/callback` with auth code
3. Flask exchanges code for tokens, gets user profile (email, name, avatar)
4. If email is in `users` table → log in; if not → deny access (admin must add users first)
5. Session managed via Flask-Login with secure cookies

---

## 8. Render Deployment

### `render.yaml` (Infrastructure as Code)

```yaml
services:
  - type: web
    name: foundation-dashboard
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn run:app
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: foundation-db
          property: connectionURI
      - key: SECRET_KEY
        generateValue: true
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
      - key: FLASK_ENV
        value: production

databases:
  - name: foundation-db
    plan: free
    databaseName: foundation_dashboard
```

### Deployment Steps
1. Push code to GitHub
2. Connect GitHub repo to Render
3. Render auto-detects `render.yaml` and creates web service + database
4. Add Google OAuth environment variables in Render dashboard
5. Run database migrations: `flask db upgrade`
6. Create initial tenant and admin user via Flask CLI command

---

## 9. Requirements.txt

```
Flask==3.1.0
Flask-SQLAlchemy==3.1.1
Flask-Migrate==4.1.0
Flask-Login==0.6.3
Authlib==1.4.1
gunicorn==23.0.0
psycopg2-binary==2.9.10
openpyxl==3.1.5
pandas==2.2.3
python-dotenv==1.0.1
```

---

## 10. Claude Code Build Instructions

When you open Claude Code, paste this prompt:

> **"I have an architecture plan for a Foundation Dashboard web app. The plan is in `ARCHITECTURE_PLAN.md` in my project folder. Please read it and build the entire application following the spec exactly. Start with the project structure, then models, then routes, then templates. Use Flask with PostgreSQL, Google OAuth, Chart.js, and Bootstrap 5. Make it deployable to Render."**

### Suggested Build Order
1. Project scaffolding (folder structure, `requirements.txt`, `config.py`, `.env.example`)
2. Database models and migrations
3. Google OAuth authentication flow
4. Excel parser service (test with the 5 real spreadsheets)
5. Upload route and processing
6. API routes (JSON endpoints for charts)
7. Base template with sidebar navigation
8. Master dashboard page
9. Five department dashboard pages
10. Historical date browsing
11. Render deployment config
12. Seed script (create initial tenant + admin user)

---

## 11. Data Snapshot Summary (Current Spreadsheet Values)

For reference, here is what the current data looks like as of April 2, 2026:

| Department | Total Gifts | Total Amount | Goal | % to Goal |
|---|---|---|---|---|
| Annual Giving | 9,191 | $616,570.74 | $250,000 | 246.6% |
| Direct Mail | 1,824 | $252,127.54 | $300,000 | 84.0% |
| Events (Special) | 1,277 | $367,015.58 | $190,000 | 193.2% |
| Events (Third Party) | 593 | $323,818.23 | $280,000 | 115.6% |
| Major Gifts | 134 | $2,500,215.41 | $2,000,000 | 125.0% |
| Legacy Giving | 26 | $715,703.92 | $1,200,000 | 59.6% |
| **COMBINED** | **13,045** | **$4,775,451.42** | **$4,220,000** | **113.2%** |
