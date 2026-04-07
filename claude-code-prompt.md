# Fund-Raise: Priority Remediation Tasks

Complete these 7 tasks in order. After each task, commit with a clear message before moving to the next. Ask me before making any destructive changes (dropping tables, deleting files, etc). Do NOT touch anything else in the codebase — no refactoring, no "while we're here" improvements.

---

## Task 1: Remove `sequelize.sync({ alter: true })`

**Location:** `src/app.js` (around line 193)

- Delete the `sequelize.sync({ alter: true })` call entirely
- Also remove the `dropMaterializedViews()` call that runs before it on startup (around line 189-190) — materialized views should NOT be dropped on every deploy
- Keep the materialized view creation/verification logic, but make it idempotent (CREATE MATERIALIZED VIEW IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so it safely skips if they already exist
- Verify that Sequelize migrations are properly configured and working (`npx sequelize-cli db:migrate` should run cleanly)
- If there is no `migrations/` directory or no existing migration files, create an initial migration that captures the current schema state (all 24 models) so we have a baseline. Do NOT run this migration against the existing database — it's just a reference point for future changes
- Test: The app should start up without running any ALTER TABLE statements

**Commit message:** `fix: remove sequelize.sync({ alter: true }) — use migrations only`

---

## Task 2: Implement PostgreSQL Row-Level Security (RLS)

**Goal:** Make it impossible for application code to accidentally leak data across tenants, even if a WHERE clause is missing.

- Create a new Sequelize migration that:
  1. Enables RLS on every table that has a `tenant_id` column (ALTER TABLE ... ENABLE ROW LEVEL SECURITY)
  2. Creates a policy on each of those tables: `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_setting('app.current_tenant_id')::int)`
  3. Also adds `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so that even table owners (the app's DB user) are subject to the policy
- Add Express middleware (early in the middleware chain, after session/auth but before any routes) that runs `SET LOCAL app.current_tenant_id = <tenant_id>` at the start of each request using the authenticated user's tenantId
- This SET LOCAL must happen inside a transaction for each request, OR use a Sequelize hook/beforeConnect to set it per-connection. Research which approach works with Sequelize 6 and connection pooling — SET LOCAL is transaction-scoped, so if we're not wrapping every request in a transaction, we may need `SET app.current_tenant_id` (session-scoped) instead, with careful pool management. Pick the approach that is safe with connection pooling and document why.
- For unauthenticated routes (login page, health check, OAuth callbacks), the middleware should skip setting tenant context — and RLS will correctly block any tenant-scoped queries on those routes (which shouldn't be happening anyway)
- DO NOT remove existing `WHERE tenant_id = ...` clauses from queries. RLS is a safety net, not a replacement for explicit filtering. Leave all existing filtering in place.
- Test: Confirm the app boots, you can log in, and dashboard data loads correctly for your tenant

**Commit message:** `security: implement PostgreSQL Row-Level Security for tenant isolation`

---

## Task 3: Fix CRM Import to Use UPSERT with Transactions

**Location:** `src/services/crmImportService.js`

- Replace the delete-then-insert pattern with UPSERT (INSERT ... ON CONFLICT ... DO UPDATE)
- The conflict target should be a natural key — likely a combination of `tenant_id` + the Blackbaud system record ID (e.g., `system_record_id` or equivalent field from the CRM). Check the model to find the right unique identifier from Blackbaud
- If no unique constraint exists on that combination, create one in a migration first
- Wrap the entire import operation in a single database transaction — if anything fails, the whole import rolls back and existing data is untouched
- Apply the same UPSERT pattern to CrmGiftFundraiser, CrmGiftSoftCredit, and CrmGiftMatch
- For records that exist in the database but NOT in the new import (i.e., deleted in Blackbaud), add a soft-delete flag or handle cleanup AFTER the upsert succeeds, still within the same transaction
- Keep the existing batch insert size (25 records per INSERT) but convert them to batch upserts
- Test: Import should work without any period where the tenant sees zero data

**Commit message:** `fix: replace delete-then-insert import with transactional UPSERT`

---

## Task 4: Fix Conversation Sharing Validation

**Location:** `src/routes/ai.js` (around line 124-134)

- In the `POST /api/ai/conversations/:id/share` handler, validate that ALL userIds in the request body belong to the same tenant as `req.user.tenantId`
- Query the Users table to verify: `WHERE id IN (userIds) AND tenantId = req.user.tenantId`
- If any userId doesn't belong to the tenant, reject the entire request with a 403
- Also validate that userIds is actually an array of integers, not arbitrary input

**Commit message:** `security: validate tenant membership in conversation sharing`

---

## Task 5: Encrypt Blackbaud Tokens at Rest

**Location:** `src/models/blackbaudToken.js` and `src/services/blackbaudClient.js`

- Add encryption/decryption utility functions using Node.js built-in `crypto` module with AES-256-GCM
- The encryption key should come from a new environment variable: `TOKEN_ENCRYPTION_KEY`
- Generate a random 32-byte key and show me the command to set it in Render's environment variables (e.g., `openssl rand -hex 32`)
- Add a Sequelize hook (beforeSave) on the BlackbaudToken model that encrypts `accessToken` and `refreshToken` before writing to the database
- Add a Sequelize hook (afterFind) or instance method that decrypts tokens when reading
- Store the IV alongside the ciphertext (prepend it or use a separate column)
- Create a one-time migration script (can be a standalone .js file in a `scripts/` directory) that encrypts all existing plaintext tokens in the database. This should be run manually once, not on every deploy
- If `TOKEN_ENCRYPTION_KEY` is not set, the app should refuse to start with a clear error message (not fall back to plaintext)
- Test: Blackbaud sync should still work after encryption

**Commit message:** `security: encrypt Blackbaud OAuth tokens at rest (AES-256-GCM)`

---

## Task 6: Remove Debug User Logging

**Location:** `src/config/passport.js` (around line 36-37)

- Remove or comment out the lines that query all users and log their emails on every login attempt:
  ```javascript
  const allUsers = await User.findAll({ attributes: ['id', 'email', 'role', 'isActive'] });
  console.log('[AUTH] Users in database:', JSON.stringify(allUsers.map(u => u.email)));
  ```
- Replace with a single, non-PII log line if needed: `console.log('[AUTH] Login attempt processed')`
- Check for any other `console.log` statements in auth flows that dump user PII and remove those too

**Commit message:** `security: remove PII from auth debug logging`

---

## Task 7: Update render.yaml and Add Health Check

**Location:** `render.yaml` and `src/app.js` (or a new route file)

**render.yaml updates:**
- Change the database plan from `free` to match whatever paid plan I'm actually using (ask me what plan I'm on if you need to, or just remove the `plan: free` line since Render uses the dashboard setting anyway)
- Add a health check path to the web service config:
  ```yaml
  healthCheckPath: /health
  ```

**Health check endpoint:**
- Add a `GET /health` route that:
  1. Checks database connectivity (run a simple `SELECT 1` query)
  2. Returns `200 { status: "ok", db: "connected" }` if healthy
  3. Returns `503 { status: "unhealthy", db: "disconnected" }` if the DB query fails
- This endpoint should NOT require authentication
- Keep it simple — no heavy checks, no MV verification, just "can we reach the database"

**Commit message:** `infra: update render.yaml and add /health endpoint`

---

## Important Notes

- I am NOT on the Render free tier. I am on a paid plan. Don't make assumptions about resource constraints based on the render.yaml file.
- Do not refactor, rename, or reorganize any files beyond what's needed for these 7 tasks.
- If you encounter something ambiguous (e.g., you're not sure what the Blackbaud natural key field is called), ask me rather than guessing.
- After all 7 tasks are done, give me a summary of what was changed and any manual steps I need to take (like running the token encryption script or setting new environment variables).
