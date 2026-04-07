# Fund-Raise Platform: Comprehensive Codebase Analysis

**Date:** April 7, 2026
**Scope:** Full architecture, security, performance, and multi-tenancy audit
**Perspective:** Pessimistic — identifying every weakness for a platform targeting hundreds/thousands of tenants with 25K–2M+ records each

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [CRITICAL: Multi-Tenancy Failures](#3-critical-multi-tenancy-failures)
4. [CRITICAL: Database & Data Layer](#4-critical-database--data-layer)
5. [CRITICAL: Performance & Scalability Blockers](#5-critical-performance--scalability-blockers)
6. [HIGH: Security Vulnerabilities](#6-high-security-vulnerabilities)
7. [HIGH: Infrastructure & Deployment](#7-high-infrastructure--deployment)
8. [MEDIUM: API & Backend Issues](#8-medium-api--backend-issues)
9. [MEDIUM: Frontend Concerns](#9-medium-frontend-concerns)
10. [LOW: Code Quality & Maintainability](#10-low-code-quality--maintainability)
11. [Prioritized Remediation Roadmap](#11-prioritized-remediation-roadmap)

---

## 1. Executive Summary

Fund-Raise is a **Node.js/Express monolith** with server-rendered EJS templates, PostgreSQL via Sequelize ORM, Google OAuth authentication, Blackbaud CRM integration, and Claude AI chat. It currently works for a single tenant. **It is not ready for multi-tenant SaaS at scale.** The issues below range from "will break at 10 tenants" to "will break at 1000 tenants" to "is a security risk right now."

### Verdict: 23 Critical/High issues, 15 Medium, 8 Low

The platform has solid bones — good use of materialized views, parameterized queries, sensible caching patterns — but fundamental architectural decisions need to change before serving hundreds of tenants with millions of records.

### The Three Existential Threats

| # | Threat | Impact |
|---|--------|--------|
| 1 | **No database-level tenant isolation** | One bug = data breach across ALL tenants |
| 2 | **Single-process monolith on Render Free tier** | Cannot scale horizontally; 256MB RAM cap |
| 3 | **`sequelize.sync({ alter: true })` in production** | Every deploy risks schema corruption across all tenants |

---

## 2. Architecture Overview

### Current Stack

| Layer | Technology | Concern Level |
|-------|-----------|---------------|
| Runtime | Node.js >= 18 | OK |
| Framework | Express 4.x | OK |
| Views | EJS (91 templates) | Limits frontend scalability |
| Database | PostgreSQL (Render managed) | Good choice, bad tier |
| ORM | Sequelize 6.x | Adequate but watch for N+1 |
| Auth | Passport.js + Google OAuth | OK for now |
| Sessions | Sequelize session store (DB) | Bottleneck at scale |
| AI | Anthropic Claude SDK | OK |
| File Parsing | xlsx, csv-parse | Memory concerns |
| Deployment | Render (free tier) | Non-starter for production SaaS |

### Current File Structure
```
src/
├── app.js                    # 244 lines — entry point, middleware, startup
├── config/                   # database.js, passport.js
├── models/                   # 24 Sequelize models
├── routes/                   # 24 Express route files
├── services/                 # 14 service files (crmDashboardService.js is 3,916 lines)
├── middleware/               # auth.js (63 lines)
└── utils/                    # featureFlags.js
views/                        # 91 EJS templates
public/                       # Static assets
```

### What's Good (Credit Where Due)
- Materialized views for heavy analytics (11 MVs with CONCURRENTLY refresh)
- Covering indexes with INCLUDE clauses (PostgreSQL 11+)
- Parameterized SQL everywhere (no SQL injection)
- Session-cached feature flags (5-min TTL)
- MV-first with raw-query fallback pattern (`tryMV()`)
- CSV streaming for large imports (not loading entire file)
- 28-second global request timeout (under Render's 30s proxy limit)
- Batch inserts (25 records per INSERT)
- Proper Helmet security headers
- Login rate limiting (10/15min per IP)


---

## 3. CRITICAL: Multi-Tenancy Failures

### 3.1 No Database-Level Tenant Isolation (SEVERITY: CRITICAL)

**Location:** All models in `src/models/`, all routes in `src/routes/`

**Current approach:** Every table has a `tenant_id` column. Every query manually adds `WHERE tenant_id = req.user.tenantId`. There is **no PostgreSQL Row-Level Security (RLS)**, no schema-per-tenant, no database-per-tenant.

**Why this is existential:**
- A single missed `WHERE tenant_id = ...` clause in ANY query leaks data across ALL tenants
- There are **3,916 lines** in `crmDashboardService.js` alone, each with manually-written tenant filtering
- Raw SQL queries (dozens of them) each independently must remember to filter by tenant
- No automated test verifies tenant isolation across all endpoints
- One junior developer, one copy-paste error, one late-night hotfix = data breach

**At scale impact:** With 1,000 tenants, a tenant isolation bug exposes up to 999 other organizations' donor PII (names, emails, phone numbers, addresses, gift amounts). This is a **regulatory and legal catastrophe**.

**Remediation:**
```sql
-- PostgreSQL Row-Level Security (the correct approach)
ALTER TABLE crm_gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_gifts
  USING (tenant_id = current_setting('app.current_tenant_id')::int);
```
Then set `app.current_tenant_id` in middleware before any query runs. This makes it **impossible** to leak data even if application code forgets the WHERE clause.

### 3.2 Tenant Context Not Validated on Mutations (SEVERITY: CRITICAL)

**Location:** `src/routes/ai.js:124-134`

The conversation sharing endpoint accepts arbitrary `userIds` without verifying they belong to the same tenant:

```javascript
router.post('/api/ai/conversations/:id/share', ensureAuth, async (req, res) => {
  const { userIds } = req.body;
  // NO VALIDATION that userIds belong to req.user.tenantId
  conv.sharedWith = userIds.filter(id => id !== req.user.id);
  await conv.save();
});
```

An attacker can share conversations (containing sensitive fundraising data) with users in other tenants by guessing user IDs (sequential integers starting from 1).

### 3.3 In-Memory Caches Are Not Tenant-Partitioned Safely (SEVERITY: HIGH)

**Location:** `src/services/crmDashboardService.js:21-30`

```javascript
const cache = new Map();
function cached(key, fn) {
  return async (...args) => {
    const cacheKey = `${key}:${JSON.stringify(args)}`;
    // ...
  };
}
```

Cache keys are built from function name + serialized args. If two tenants call the same function with the same arguments (e.g., same fiscal year), they could get each other's cached data. The `clearCrmCache()` function uses `key.includes(tenantId)` which is a substring match — tenant ID "1" would match tenant IDs "10", "100", "1000", etc.

### 3.4 No Tenant Quota or Resource Limits (SEVERITY: HIGH)

There are no limits on:
- Records per tenant (one tenant with 10M records slows down everyone)
- API requests per tenant per minute
- File upload size per tenant (300MB CRM uploads)
- AI chat requests per tenant (each costs real money)
- Number of users per tenant
- Storage consumed per tenant

At 1,000 tenants, one aggressive tenant can monopolize the entire database, exhaust the connection pool, or rack up massive Anthropic API bills.

---

## 4. CRITICAL: Database & Data Layer

### 4.1 `sequelize.sync({ alter: true })` in Production (SEVERITY: CRITICAL)

**Location:** `src/app.js:193`

```javascript
await sequelize.sync({ alter: true });
```

This runs **on every deploy** and attempts to ALTER every table to match the model definitions. With 24 models and hundreds of tenants' data:

- Can **lock tables** for minutes during column type changes
- Can **drop columns** if a model field is accidentally removed
- Can **corrupt data** if type conversions fail
- Runs **before the app starts serving** — deploy = downtime
- No rollback mechanism if it fails partway through
- Completely bypasses the migration system that already exists

**This is the single most dangerous line in the codebase.** One model change + one deploy = potential data loss across all tenants.

**Remediation:** Remove `sync({ alter: true })`. Use Sequelize migrations exclusively. Run migrations in a separate CI/CD step with rollback capability.

### 4.2 No Database Connection Pooling Strategy for Multi-Tenancy (SEVERITY: CRITICAL)

**Location:** `src/models/index.js:15`

```javascript
pool: { max: 10, min: 1, acquire: 30000, idle: 10000 }
```

**10 connections for the entire application.** With 100 concurrent users across 50 tenants:
- Each page load requires 1-3 DB queries (session lookup, feature flags, page data)
- CRM dashboard fires 8-12 parallel queries per load
- Materialized view refresh holds connections for 30-60 seconds
- Session store uses the same pool for every request

At 100 concurrent users, the pool exhausts instantly. Requests queue for 30 seconds, then timeout. The app becomes unusable.

**Remediation:** Increase to 50-100 connections (requires a real PostgreSQL instance, not Render free tier). Add PgBouncer for connection multiplexing. Separate session store from application pool.

### 4.3 CrmGift Model Has 60+ Columns — Denormalized (SEVERITY: HIGH)

**Location:** `src/models/crmGift.js`

The `crm_gifts` table stores gift data, constituent PII, fund info, campaign info, appeal info, and package info all in one table. With 2M records per tenant and 60+ columns:

- Every query reads wide rows even when you only need 3 fields
- Constituent contact info (name, email, phone, address) is **duplicated across every gift** — one donor with 50 gifts = 50 copies of their address
- No constituent table means updating a donor's info requires updating every gift row
- Index bloat: 8 indexes on this table, each covering the full row width
- VACUUM and ANALYZE become expensive on wide tables with millions of rows

### 4.4 No Foreign Key Constraints on CRM Tables (SEVERITY: HIGH)

**Location:** `src/models/index.js:130-137`

```javascript
CrmGift.hasMany(CrmGiftFundraiser, { ..., constraints: false });
CrmGift.hasMany(CrmGiftSoftCredit, { ..., constraints: false });
CrmGift.hasMany(CrmGiftMatch, { ..., constraints: false });
```

`constraints: false` means PostgreSQL does NOT enforce referential integrity. Orphaned fundraiser/soft-credit/match records can exist pointing to non-existent gifts. At scale, data quality degrades silently.

### 4.5 Delete-Then-Insert Import Strategy (SEVERITY: HIGH)

**Location:** `src/services/crmImportService.js:104-121`

```javascript
await CrmGiftMatch.destroy({ where: { tenantId } });
await CrmGiftSoftCredit.destroy({ where: { tenantId } });
await CrmGiftFundraiser.destroy({ where: { tenantId } });
await CrmGift.destroy({ where: { tenantId } });
// Then insert all new data...
```

Every import **deletes ALL existing data** for the tenant, then re-inserts everything. With 2M records:
- DELETE 2M rows = minutes of table-level locks
- INSERT 2M rows = minutes more
- During this window, the tenant's dashboard shows **zero data**
- If the import fails halfway, the tenant loses ALL their data
- No transaction wrapping the delete+insert (partial failure = data loss)
- Materialized views become stale during the window

**Remediation:** Use UPSERT (INSERT ... ON CONFLICT UPDATE) or staging tables with atomic swap.

### 4.6 Materialized Views Drop on Every Deploy (SEVERITY: HIGH)

**Location:** `src/app.js:189-190`, `src/services/crmMaterializedViews.js:20-36`

```javascript
await dropMaterializedViews(); // Drops ALL 11 MVs
await sequelize.sync({ alter: true });
// ... later ...
await createMaterializedViews(); // Recreates them
```

Every deploy:
1. Drops all materialized views (dashboard data disappears)
2. Runs schema sync (tables locked)
3. Recreates MVs (expensive full table scans)

With 1,000 tenants and 500M total records, recreating MVs could take **30+ minutes**. During this time, every dashboard request falls back to raw queries on the base tables, which timeout at 20 seconds.

### 4.7 No Audit Trail (SEVERITY: MEDIUM)

No audit logging for:
- Who accessed which donor's data
- Who exported data (PDF reports, CSV)
- Who modified organization settings
- Who shared AI conversations
- Data deletion events

For a platform handling donor PII across hundreds of organizations, this is a compliance gap (PIPEDA, GDPR, state privacy laws).


---

## 5. CRITICAL: Performance & Scalability Blockers

### 5.1 Single-Process Monolith (SEVERITY: CRITICAL)

**Location:** `src/app.js:234`

```javascript
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
```

One Node.js process handles everything:
- HTTP requests from all tenants
- Session management
- CRM data imports (CPU-intensive parsing)
- AI chat (long-running streaming responses)
- PDF generation (CPU-intensive)
- Materialized view refresh
- Department classification (iterates all records)

Node.js is single-threaded. A 300MB Excel parse blocks ALL other requests for ALL tenants. An AI chat stream that takes 30 seconds holds a connection for the full duration. There is no worker process, no job queue, no cluster mode.

**At 100 concurrent users:** Response times will spike to 10-30 seconds during any import or heavy operation.

**Remediation:** 
- Add Node.js cluster mode (use all CPU cores)
- Extract imports, AI chat, PDF generation into a background job queue (BullMQ + Redis)
- Separate the web server from background workers

### 5.2 No Background Job Queue (SEVERITY: CRITICAL)

**Location:** `src/services/crmImportService.js:207-209`

```javascript
// "Runs in background" — but it's the same process!
refreshMaterializedViews().catch(err => { ... });
```

Long-running operations that should be background jobs but run in the main request handler:
- CRM data import (can take minutes for large files)
- Materialized view refresh (30-60 seconds)
- Department inference via AI (network calls to Anthropic)
- Cache warming (8+ parallel heavy queries)
- Department backfill classification (iterates all records)

These operations consume the connection pool, block the event loop, and degrade performance for every other tenant.

### 5.3 N+1 Query in Trends Endpoint (SEVERITY: HIGH)

**Location:** `src/routes/api.js:162-181`

```javascript
router.get('/trends', ensureAuth, async (req, res) => {
  const snapshots = await Snapshot.findAll({ ... });
  for (const snap of snapshots) {
    // ONE QUERY PER SNAPSHOT — N+1!
    const summaries = await DepartmentSummary.findAll({ where: { snapshotId: snap.id } });
  }
});
```

With 50 snapshots, this fires 51 queries. Each query acquires a connection from the pool of 10. This single endpoint from a single user can lock half the connection pool.

### 5.4 In-Memory Caches Don't Scale Horizontally (SEVERITY: HIGH)

**Locations:**
- `src/services/crmDashboardService.js:18` — Dashboard cache (Map)
- `src/services/aiService.js:57` — AI context cache (Map)
- `src/services/blackbaudClient.js:23` — API response cache (Map)
- `src/services/blackbaudClient.js:46` — Daily API counter (variable)

All caches are in-process memory. If you run 2 instances:
- Each instance has its own cache (double memory, double DB queries)
- Blackbaud daily API counter tracks per-instance (2 instances = 2,000 calls/day, not 1,000)
- Cache invalidation only clears one instance
- No cache size limits — unbounded memory growth with many tenants

### 5.5 Session Store in the Database (SEVERITY: HIGH)

**Location:** `src/app.js:56-60`

Every HTTP request triggers a database query to load the session. With 100 concurrent users making 5 requests each per page load, that's 500 session queries competing with application queries in the same connection pool of 10.

**Remediation:** Move sessions to Redis. Redis handles 100K+ ops/second vs PostgreSQL's ~1K concurrent queries.

### 5.6 Synchronous File I/O (SEVERITY: MEDIUM)

**Location:** `src/services/aiService.js:40-41`

```javascript
const stat = fs.statSync(PROMPT_FILE);
staticPromptCache = fs.readFileSync(PROMPT_FILE, 'utf-8');
```

Synchronous file reads block the entire event loop. Every AI chat request hits this code path. Under load, this creates a bottleneck where all requests queue behind file I/O.

### 5.7 Excel Import Loads Entire File into Memory (SEVERITY: MEDIUM)

**Location:** `src/services/crmExcelParser.js:448`

```javascript
const wb = XLSX.readFile(filePath, { cellDates: true });
```

A 300MB Excel file (the upload limit) will consume 300MB+ of RAM parsing. Render's free tier has 256MB RAM. Even on a paid tier, one large upload can trigger an OOM kill, crashing the server for ALL tenants.

### 5.8 Unbounded Fundraiser Leaderboard Query (SEVERITY: MEDIUM)

**Location:** `src/services/crmDashboardService.js:262-274`

The fundraiser leaderboard query has no LIMIT clause. A tenant with 500 fundraisers returns all 500 rows with full aggregations. The MV fallback path also has no LIMIT.

### 5.9 Startup Blocks on Heavy Operations (SEVERITY: MEDIUM)

**Location:** `src/app.js:182-234`

On startup (every deploy), the app sequentially:
1. Drops all materialized views
2. Runs `sync({ alter: true })` on 24 tables
3. Creates/verifies 11 indexes
4. Backfills department classifications (iterates ALL records)
5. Recreates 11 materialized views
6. Syncs the session table

With 500M total records across all tenants, this startup sequence could take **10-30 minutes**. During this time, the app is completely down. Render will kill the process after 5 minutes if it doesn't bind to a port.


---

## 6. HIGH: Security Vulnerabilities

### 6.1 No CSRF Protection (SEVERITY: HIGH)

**Location:** Application-wide — no `csurf` middleware, no CSRF tokens

The app relies solely on `sameSite: 'lax'` cookies for CSRF protection. This does NOT protect against:
- Top-level navigation attacks (GET requests)
- Subdomain attacks
- Older browser versions that don't support SameSite

State-changing POST/PUT/DELETE endpoints (create posts, share conversations, delete milestones, upload data) are all vulnerable.

### 6.2 No Rate Limiting on API Endpoints (SEVERITY: HIGH)

**Location:** Only `src/routes/auth.js:6` has rate limiting

Rate limiting exists **only** on the login endpoint (10/15min). All other endpoints have zero rate limiting:
- `/api/ai/chat/stream` — each request costs money (Anthropic API calls)
- `/crm-dashboard/data` — fires 8-12 heavy DB queries
- `/api/posts` — spam content creation
- `/upload/process` — 50MB file processing
- `/crm-upload/process` — 300MB file processing

An attacker (or a buggy client-side script) can hammer these endpoints and:
- Run up massive Anthropic API bills
- Exhaust the DB connection pool
- Fill disk with uploaded files
- Denial-of-service the entire platform

### 6.3 Blackbaud OAuth Tokens Stored in Plaintext (SEVERITY: HIGH)

**Location:** `src/models/blackbaudToken.js`

```javascript
accessToken: { type: DataTypes.TEXT },
refreshToken: { type: DataTypes.TEXT },
```

OAuth access and refresh tokens are stored as plaintext in the database. If the database is compromised (SQL injection elsewhere, backup leak, Render breach), attackers get direct API access to tenants' Blackbaud CRM systems — their entire donor database.

**Remediation:** Encrypt tokens at rest using AES-256-GCM with a key stored in environment variables.

### 6.4 Content Security Policy Disabled (SEVERITY: MEDIUM)

**Location:** `src/app.js:21`

```javascript
app.use(helmet({ contentSecurityPolicy: false }));
```

CSP is completely disabled because EJS templates use inline scripts/styles. This means there is zero browser-level protection against XSS. While no XSS vulnerabilities were found in current code, disabling CSP removes the defense-in-depth layer.

### 6.5 innerHTML Usage in Frontend (SEVERITY: MEDIUM)

**Location:** Multiple EJS templates (writing assistant, dashboard trends, etc.)

```javascript
outputEl.innerHTML = renderMarkdown(generatedText);
// Also:
histTbody.innerHTML = ops.uploadHistory.map(function(h) { ... });
```

AI-generated content and user data is injected via `innerHTML` in several templates. If the markdown renderer or data contains malicious HTML, it executes in the user's browser.

### 6.6 Debug Logging in Production Auth (SEVERITY: MEDIUM)

**Location:** `src/config/passport.js:36-37`

```javascript
const allUsers = await User.findAll({ attributes: ['id', 'email', 'role', 'isActive'] });
console.log('[AUTH] Users in database:', JSON.stringify(allUsers.map(u => u.email)));
```

Every login attempt logs ALL user emails to stdout. In production with 1,000 tenants, this dumps thousands of email addresses into Render's log viewer on every single login. This is a PII leak in logs.

### 6.7 Session Secret Fallback (SEVERITY: MEDIUM)

**Location:** `src/app.js:63`

```javascript
secret: process.env.SESSION_SECRET || 'dev-secret',
```

If `SESSION_SECRET` is not set, sessions are signed with the hardcoded string `'dev-secret'`. An attacker who knows this can forge session cookies and impersonate any user. While Render auto-generates this, a misconfigured deployment could expose this.

### 6.8 No Graceful Shutdown (SEVERITY: MEDIUM)

**Location:** `src/app.js` — no SIGTERM/SIGINT handlers

When Render deploys a new version, it sends SIGTERM to the old process. Without a graceful shutdown handler:
- In-progress CRM imports are silently killed (data partially deleted, not re-inserted)
- Active AI chat streams are cut mid-response
- Database connections are not properly closed (connection leaks)
- Sessions being written are corrupted

---

## 7. HIGH: Infrastructure & Deployment

### 7.1 Render Free Tier (SEVERITY: CRITICAL for production)

**Location:** `render.yaml`

```yaml
databases:
  - name: foundation-db
    plan: free
```

The Render free tier database has:
- 256MB RAM
- 0.1 CPU
- 1GB storage
- Deleted after 90 days of inactivity
- No backups
- Shared infrastructure

A single tenant with 700K records will consume ~500MB of storage (data + indexes + MVs). The 1GB limit is hit with **2 tenants**. The 256MB RAM means complex queries will spill to disk (100x slower).

### 7.2 No Database Backups (SEVERITY: CRITICAL)

Render free tier has no automated backups. There is no backup script, no pg_dump cron job, no point-in-time recovery. A botched `sync({ alter: true })` or a bad import can permanently destroy all tenant data.

### 7.3 No CI/CD Pipeline (SEVERITY: HIGH)

No GitHub Actions, no test gates, no staging environment. Code goes directly from `git push` to production. The test suite exists but nothing enforces it runs before deploy.

### 7.4 No Health Check Endpoint (SEVERITY: MEDIUM)

No `/health` or `/ready` endpoint for load balancer health checks. Render can't distinguish between "app is starting" (10-minute MV rebuild) and "app is crashed."

### 7.5 No Monitoring or Alerting (SEVERITY: HIGH)

No APM (Datadog, New Relic), no error tracking (Sentry), no uptime monitoring. When the app crashes at 2 AM, nobody knows until a user complains. No visibility into:
- Response times by endpoint
- Error rates by tenant
- Database query performance
- Memory/CPU usage trends
- Connection pool exhaustion events

---

## 8. MEDIUM: API & Backend Issues

### 8.1 No Input Validation Library (SEVERITY: MEDIUM)

Input validation is ad-hoc across routes. No Joi, Zod, or express-validator. Each route independently validates (or forgets to validate) input. Examples of inconsistency:

- `POST /api/kudos` validates `toUserId` exists ✓
- `POST /api/ai/conversations/:id/share` does NOT validate `userIds` exist ✗
- `POST /api/posts` trims `title` ✓
- `POST /api/notes` trims `content` ✓
- CRM upload has no file type validation beyond extension ✗

### 8.2 No API Versioning (SEVERITY: MEDIUM)

All endpoints are under `/api/` with no version prefix. Adding breaking changes requires updating all clients simultaneously. For a multi-tenant SaaS, this means you can never deprecate an endpoint without breaking all tenants at once.

### 8.3 Offset-Based Pagination Only (SEVERITY: MEDIUM)

All list endpoints use `OFFSET/LIMIT` pagination:

```javascript
const offset = (page - 1) * perPage;
```

With 2M records, `OFFSET 1999950 LIMIT 50` requires PostgreSQL to scan and discard 1,999,950 rows before returning 50. Deep pagination becomes exponentially slower. Cursor-based pagination (keyset pagination) is O(1) regardless of page depth.

### 8.4 3,916-Line God Service (SEVERITY: MEDIUM)

**Location:** `src/services/crmDashboardService.js` — 3,916 lines

This single file contains 40+ query functions, caching logic, date helpers, and business logic. It's unmaintainable and untestable. Functions are tightly coupled to raw SQL strings.

### 8.5 No API Documentation (SEVERITY: LOW)

No Swagger/OpenAPI spec, no Postman collection, no endpoint documentation. With 100+ endpoints across 24 route files, onboarding new developers requires reading every route file.

---

## 9. MEDIUM: Frontend Concerns

### 9.1 Server-Rendered EJS Limits Interactivity (SEVERITY: MEDIUM)

91 EJS templates with inline JavaScript. No component model, no reactivity, no state management. Each page re-implements its own fetch/render/error handling in `<script>` tags. Adding real-time features, optimistic updates, or offline support is extremely difficult with this architecture.

### 9.2 No Client-Side Data Caching (SEVERITY: MEDIUM)

No React Query, SWR, or service worker caching. Every page navigation re-fetches all data from the server. Tab switching, back-button navigation, and page refreshes all trigger full re-fetches. With heavy dashboard queries (8-12 DB queries per load), this multiplies server load unnecessarily.

### 9.3 Large Inline Scripts in Templates (SEVERITY: LOW)

Dashboard templates embed hundreds of lines of JavaScript in `<script>` tags. These aren't cached by browsers (unlike external .js files), can't be minified, and are re-downloaded on every page load.

### 9.4 No Build Pipeline for Frontend Assets (SEVERITY: LOW)

No Webpack, Vite, esbuild, or even a CSS minifier. CSS and JS files are served as-is. No tree-shaking, no code splitting, no bundle optimization. Chart.js is likely loaded on every page even when not needed.

---

## 10. LOW: Code Quality & Maintainability

### 10.1 No TypeScript (SEVERITY: LOW)

Plain JavaScript with no type checking. With 24 models, 24 route files, and 14 services, refactoring is error-prone. Model field names are strings that can silently break without type errors.

### 10.2 No Linting or Formatting (SEVERITY: LOW)

No ESLint, no Prettier. No consistent code style enforcement. PRs can introduce style inconsistencies that accumulate over time.

### 10.3 Inconsistent Timestamp Patterns (SEVERITY: LOW)

Some models have `createdAt + updatedAt`, some have only `createdAt`, some have neither, some use underscored field names, some use camelCase. This makes querying "when was this last modified?" unreliable.

### 10.4 Architecture Documentation is Stale (SEVERITY: LOW)

`ARCHITECTURE_PLAN.md` references Python/Flask but the app is Node.js/Express. `.env.example` includes `FLASK_ENV`. This confuses new developers.

### 10.5 Tests Exist but Don't Run in CI (SEVERITY: MEDIUM)

Jest tests exist in `/tests/` covering services, middleware, and routes. But no CI/CD pipeline runs them. Tests may be passing or failing — nobody would know until they manually run `npm test`.


---

## 11. Prioritized Remediation Roadmap

### Phase 0: Stop the Bleeding (Week 1-2)

These must be done before onboarding a second tenant:

| # | Action | Effort | Risk Eliminated |
|---|--------|--------|-----------------|
| 1 | **Remove `sequelize.sync({ alter: true })`** — use migrations only | 1 day | Data loss on deploy |
| 2 | **Implement PostgreSQL RLS** on all tenant-scoped tables | 3 days | Cross-tenant data breach |
| 3 | **Add CSRF tokens** (csurf middleware + token in forms) | 1 day | Cross-site request forgery |
| 4 | **Encrypt Blackbaud tokens at rest** | 0.5 day | Token theft from DB compromise |
| 5 | **Remove debug user-list logging** from passport.js | 10 min | PII leak in logs |
| 6 | **Add graceful shutdown** (SIGTERM handler) | 0.5 day | Data corruption on deploy |
| 7 | **Validate userIds in conversation sharing** | 30 min | Cross-tenant conversation leak |

### Phase 1: Scale the Database (Week 3-6)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 8 | **Upgrade to paid PostgreSQL** (8GB RAM, dedicated CPU, automated backups) | 1 day | Performance, reliability |
| 9 | **Increase connection pool to 50** + add PgBouncer | 1 day | Concurrent user capacity |
| 10 | **Wrap CRM imports in transactions** with UPSERT instead of delete-then-insert | 3 days | Import reliability, zero-downtime imports |
| 11 | **Fix N+1 query** in `/api/trends` endpoint | 1 hour | Dashboard performance |
| 12 | **Add LIMIT to fundraiser leaderboard** query | 30 min | Query performance |
| 13 | **Normalize CrmGift** — extract constituent/fund/campaign/appeal into separate tables | 2 weeks | Storage, query performance, data quality |
| 14 | **Move MV creation out of startup** — run as a migration step or background job | 1 day | Deploy speed |

### Phase 2: Scale the Application (Week 7-12)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 15 | **Add Redis** for sessions + caching | 2 days | Horizontal scaling readiness |
| 16 | **Add BullMQ job queue** for imports, MV refresh, AI inference, PDF generation | 1 week | Non-blocking operations |
| 17 | **Add Node.js cluster mode** or PM2 | 1 day | Use all CPU cores |
| 18 | **Add rate limiting** on all API endpoints (per-tenant + per-user) | 1 day | Abuse prevention |
| 19 | **Add tenant resource quotas** (record limits, API limits, storage limits) | 3 days | Fair resource sharing |
| 20 | **Add health check endpoint** (`/health` with DB connectivity check) | 1 hour | Load balancer integration |
| 21 | **Replace synchronous file reads** with async versions | 1 hour | Event loop performance |
| 22 | **Stream Excel parsing** or cap file size at 50MB for Excel (CSV only for large files) | 1 day | Memory safety |

### Phase 3: Production Readiness (Week 13-20)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 23 | **Add Sentry** for error tracking | 0.5 day | Error visibility |
| 24 | **Add structured logging** (pino or winston) with tenant context | 2 days | Debugging, compliance |
| 25 | **Add CI/CD pipeline** (GitHub Actions: lint, test, build, deploy) | 2 days | Quality gates |
| 26 | **Add audit logging** for data access and mutations | 1 week | Compliance, forensics |
| 27 | **Add API versioning** (`/api/v1/`) | 1 day | Future-proofing |
| 28 | **Add input validation library** (Zod or Joi) | 3 days | Input safety |
| 29 | **Implement cursor-based pagination** for large list endpoints | 2 days | Deep pagination performance |
| 30 | **Add CSP policy** (refactor inline scripts to external files) | 1 week | XSS defense-in-depth |
| 31 | **Break up crmDashboardService.js** into focused modules | 2 days | Maintainability |

### Phase 4: Scale to 1,000 Tenants (Week 21+)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 32 | **Consider read replicas** for analytics queries | 1 week | Read scalability |
| 33 | **Consider schema-per-tenant** or partitioned tables | 2 weeks | True tenant isolation at DB level |
| 34 | **Add CDN** for static assets | 1 day | Global performance |
| 35 | **Consider migrating to Next.js/React** for frontend | 2-3 months | Modern frontend architecture |
| 36 | **Add staging environment** with production-like data | 1 week | Safe testing |
| 37 | **Add automated security scanning** (npm audit, Snyk) | 1 day | Dependency vulnerabilities |
| 38 | **Add database migration testing** (run against copy of prod) | 1 week | Safe schema evolution |

---

## Appendix A: Complete Issue Inventory

| Severity | Count | Category |
|----------|-------|----------|
| CRITICAL | 8 | Multi-tenancy (3), Database (3), Performance (1), Infrastructure (1) |
| HIGH | 15 | Database (3), Performance (4), Security (3), Infrastructure (3), Multi-tenancy (2) |
| MEDIUM | 15 | Security (4), API (4), Frontend (2), Performance (3), Code Quality (2) |
| LOW | 8 | Frontend (2), Code Quality (4), API (1), Infrastructure (1) |
| **Total** | **46** | |

## Appendix B: Files Requiring Immediate Attention

| File | Lines | Issues |
|------|-------|--------|
| `src/app.js` | 244 | sync({ alter: true }), session secret fallback, no graceful shutdown, MV drop on startup |
| `src/models/index.js` | 165 | Pool size 10, no RLS, constraints: false |
| `src/services/crmImportService.js` | 310 | Delete-then-insert, no transaction, no background processing |
| `src/services/crmDashboardService.js` | 3,916 | God service, unbounded queries, cache key collision risk |
| `src/config/passport.js` | 67 | Debug logging of all user emails |
| `src/routes/ai.js` | ~300 | Unvalidated conversation sharing |
| `src/routes/api.js` | 259 | N+1 query in trends endpoint |
| `src/services/blackbaudClient.js` | ~340 | Plaintext token storage, per-instance rate counter |
| `render.yaml` | 25 | Free tier database, no health check |

---

*This analysis was performed by reviewing every source file in the repository. All line numbers and code samples reference the codebase as of April 7, 2026.*
