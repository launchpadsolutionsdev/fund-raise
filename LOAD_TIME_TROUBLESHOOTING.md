# Load-Time Troubleshooting — CRM Dashboards

> Playbook for diagnosing and fixing `Query took too long` timeouts on the Fund-Raise CRM dashboards.
>
> Built from a 24-hour series of production incidents where dashboards timed out against a small Postgres instance (0.1 CPU / 256MB RAM) on a tenant with 20+ years of gift history. Ten-plus dashboards were fixed using the same playbook.

---

## TL;DR — the 30-second diagnosis

When a dashboard times out:

1. **Check the Render log for per-query timing lines** like `[v2.summary+bands] 17431ms`. The slow query self-identifies. If you don't see them, the function hasn't been instrumented yet — add `console.log('[fnName.step] ${Date.now() - t0}ms')` around each `sequelize.query()` call, deploy, try again.
2. **If you see `[CRM MV] 0/11 materialized views found — using raw SQL fallback`**, materialised views aren't available on that tenant and every query is hitting raw `crm_gifts`. That's the normal state on most tenants; the fix is to bound the raw SQL queries, not to rebuild the MVs.
3. **Look for the specific anti-pattern** (below). 9 times out of 10 it's #1 or #2.

---

## The four anti-patterns

### 1. Unbounded scan (the most common)

A query with `WHERE tenant_id = :tenantId` but **no** `gift_date >= ...` predicate, usually combined with `GROUP BY constituent_id` (or fund_id / campaign_id / appeal_id). On a 20-year gift table this means Postgres reads every row, then sorts or hashes to aggregate — typically 10–20s.

**Signature in the log:**
```
[fnName.step] 15858ms (n=13)
```
Especially suspicious if `n` is small (dozens of rows) but the query took 15s — that's classic "scan a lot, aggregate a little."

**Fix:** Add a 10-year fallback when no `dateRange` is provided. Use the shared helper:

```javascript
const { fallbackLookback } = require('./crmDashboardService'); // same file, usually
const fb = fallbackLookback(dateRange);            // { sql: ' AND gift_date >= :_fallbackStart', repl: {...} }
const repl = { tenantId, ...dateReplacements(dateRange), ...fb.repl };

sequelize.query(`
  SELECT ...
  FROM crm_gifts
  WHERE tenant_id = :tenantId${dateWhere(dateRange)}${fb.sql} ${EXCL}
  GROUP BY ...
`, { replacements: repl, ...QUERY_OPTS });
```

Signature pattern: if `dateRange` is null, `fb.sql` splices in `AND gift_date >= :_fallbackStart` and `fb.repl` carries the date.

**Where it's already applied:** `getPledgePipeline`, `getHouseholdGiving`, `getYearOverYearComparison`, `getGiftTrendAnalysis`, `getDonorInsights`, `getDonorLifecycleAnalysis`, `getDepartmentExtras`, `getDepartmentAnalytics` (fallback path), `getGeographicAnalytics`, `crmLybuntSybuntV2Service.js`, `getGivingByMonth`, `getTopDonors`, `getTopFunds`, `getTopCampaigns`, `getTopAppeals`, `getGiftsByType`, `getFundraiserLeaderboard`, `getEntityDetail`, `getGivingPyramid`, `getDonorScoring`, `getRecurringDonorAnalysis`, `getAcknowledgmentTracker`, `getMatchingGiftAnalysis`, `getSoftCreditAnalysis`, `getPaymentMethodAnalysis`, `getCampaignComparison`, `getFundHealthReport` (incl. always-bounded `fundGrowth`), `getAppealComparison`, `getAppealDetail`, `getFirstTimeDonorConversion`, `getAnomalyDetection`, `getDepartmentDetail` (incl. always-bounded `yoy`).

### 2. LEFT JOIN `crm_gifts` for a name lookup (the 24-minute disease)

Pattern: a cohort/commitment CTE is built, then the query does:
```sql
LEFT JOIN crm_gifts g ON g.constituent_id = c.constituent_id
```
just to `MAX(first_name), MAX(last_name)`. Postgres fans out every cohort row to every gift that donor ever made — a tenant with 5,000 cohort donors × 50 gifts each = 250,000-row intermediate before the `LIMIT 50`. Production clocked this at **24.5 minutes** for a single page of LYBUNT donors.

**Signature in the log:**
```
[v2.topDonors] 1474005ms (n=50)   ← 24 minutes for 50 rows
```
Or any query where time-per-row is absurdly high.

**Fix:** Two-step. Get the cohort IDs with `LIMIT` inside the CTE first, then a separate by-ID name lookup against the composite index `(tenant_id, constituent_id, gift_date)`:

```javascript
// Step 1: cohort query with LIMIT inline
const cohort = await sequelize.query(`
  WITH ... cohort CTE ...
  SELECT constituent_id, ...metrics...
  FROM cohort
  ORDER BY ... LIMIT 50
`, ...);

// Step 2: scoped name lookup, tiny indexed scan
const ids = cohort.map(r => r.constituent_id);
const names = await sequelize.query(`
  SELECT constituent_id,
         MAX(first_name) as first_name,
         MAX(last_name) as last_name,
         MAX(constituent_email) as constituent_email
  FROM crm_gifts
  WHERE tenant_id = :tenantId
    AND constituent_id IN (:ids)
  GROUP BY constituent_id
`, { replacements: { tenantId, ids }, ...QUERY_OPTS });

// Step 3: merge in JS
const byId = Object.fromEntries(names.map(n => [n.constituent_id, n]));
const enriched = cohort.map(r => ({ ...r, ...(byId[r.constituent_id] || {}) }));
```

**Expected timing:** step 2 is typically **<200ms** because the composite index (`idx_crm_gifts_tenant_donor_date`, migration `20260415000003`) turns it into an index-only scan.

**Where it's applied:** `crmLybuntSybuntV2Service.js` (donor table), `getPledgePipeline` (`atRisk`), `getHouseholdGiving` (member names).

### 3. Same expensive CTE materialized multiple times

A single dashboard function runs 2+ queries that each contain the same heavy CTE (recursive CTE for household graph, slim cohort CTE for LYBUNT). Each query re-materializes the CTE from scratch. Production saw `[v2.summary+bands] 17431ms` + `[v2.topDonor-ids] 13156ms` — both scanning the same cohort, 30s wasted.

**Fix:** Consolidate via `UNION ALL` with a `row_type` discriminator, then demux in JS:

```javascript
const rows = await sequelize.query(`
  WITH ${sharedCte.replace('lapsed AS (', 'lapsed AS MATERIALIZED (')}
  SELECT 'sum'::text AS row_type, NULL::text AS band, ... aggregates ...
  FROM lapsed ${filterWhere}

  UNION ALL

  SELECT 'band'::text AS row_type, band_sql AS band, ... aggregates ...
  FROM lapsed ${filterWhere}
  GROUP BY band

  UNION ALL

  SELECT 'donor'::text AS row_type, ... donor columns ...
  FROM (SELECT * FROM lapsed ${filterWhere} ORDER BY ... LIMIT :limit) ranked
`, { replacements, ...QUERY_OPTS });

const sumRow = rows.find(r => r.row_type === 'sum');
const bandRows = rows.filter(r => r.row_type === 'band');
const donorRows = rows.filter(r => r.row_type === 'donor');
```

The `AS MATERIALIZED` hint (PG12+) forces Postgres to cache the CTE result rather than inlining it, so the `UNION ALL` arms see the same materialized output. Useful when the CTE itself is the expensive part and each arm aggregates differently.

**Where it's applied:** `crmLybuntSybuntV2Service.js` (summary + bands + top-50 in one query). `getHouseholdGiving` uses a different variant (compute graph once in SQL, fold aggregates in JS) — preferred when the graph is the expensive part.

### 4. Browser-retry amplification (connection-pool starvation)

Symptom: you see **two** `[Dashboard] Request received:` log lines back-to-back for the same URL. The browser retried during a slow first load, both hit Postgres at the same time, pool is exhausted, other dashboards time out because they can't even get a connection. (`pool.max: 20` in `src/models/index.js`.)

**Fix:** In-flight promise dedup inside the cache wrapper. If a query for the same cache key is already running, await the in-flight promise instead of starting a duplicate:

```javascript
const _cache = new Map();
const _inflight = new Map();

function cached(prefix, fn) {
  return async (...args) => {
    const key = prefix + ':' + JSON.stringify(args);
    const hit = _cache.get(key);
    if (hit && Date.now() < hit.expiry) return hit.data;

    const running = _inflight.get(key);
    if (running) return running;

    const promise = Promise.resolve(fn(...args))
      .then(data => { _cache.set(key, { data, expiry: Date.now() + CACHE_TTL }); return data; })
      .finally(() => { _inflight.delete(key); });
    _inflight.set(key, promise);
    return promise;
  };
}
```

**Where it's applied:** shared `cached()` in `src/services/crmDashboardService.js` (benefits every dashboard that wraps its entrypoint in `cached(...)`), and in `crmLybuntSybuntV2Service.js`.

---

## Database-level fixes

### The composite index that unlocks everything

Migration `20260415000003-add-crm-gifts-donor-fy-index-v2.js` created:

```sql
CREATE INDEX idx_crm_gifts_tenant_donor_date
  ON crm_gifts (tenant_id, constituent_id, gift_date)
  WHERE constituent_id IS NOT NULL AND gift_date IS NOT NULL;
```

This covers both the predicate **and** the common `GROUP BY constituent_id` + `ORDER BY gift_date` pattern. Turned most donor-grouped aggregations from full sequential scans into index-only scans.

**If you add a new query that groups by `constituent_id`**, this index should already make it fast. If it doesn't, `EXPLAIN ANALYZE` the query and see if Postgres is using the index.

**Important historical note:** a previous attempt used `CREATE INDEX CONCURRENTLY` and hung for 18 minutes inside sequelize-cli's migration transaction (CONCURRENTLY can't run in a transaction — sequelize-cli v6 silently ignores the `useTransaction: false` opt-out). If you need to add another index to `crm_gifts`, use plain `CREATE INDEX` (brief table lock, reliable) **not** CONCURRENTLY. See the migration file for the full story.

### Materialized views

The MV layer in `src/services/crmMaterializedViews.js` is designed to pre-compute common aggregates, but on many tenants `[CRM MV] 0/11 materialized views found` — the MVs are never built. The code falls back to raw SQL, which is what this playbook keeps safe.

If you want to permanently fix a tenant's dashboard performance rather than bounding scans, create the MVs with `refreshAllMaterializedViews(tenantId)`. That's a longer-running fix and beyond the scope of this playbook.

---

## Write-ahead: the `fallbackLookback` helper

Lives in `src/services/crmDashboardService.js`:

```javascript
function fallbackLookback(dateRange, alias, years = 10) {
  if (dateRange) return { sql: '', repl: {} };
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  const col = alias ? `${alias}.gift_date` : 'gift_date';
  return {
    sql: ` AND ${col} >= :_fallbackStart`,
    repl: { _fallbackStart: d.toISOString().slice(0, 10) },
  };
}
```

When you add a new dashboard function, call it at the top and splice `fb.sql` + `fb.repl` into every `crm_gifts` query that would otherwise be unbounded.

---

## Per-query timing — add it to every new function

```javascript
async function getMyNewDashboard(tenantId, dateRange) {
  const fb = fallbackLookback(dateRange);
  const repl = { tenantId, ...dateReplacements(dateRange), ...fb.repl };

  const t1 = Date.now();
  const rowsA = await sequelize.query(`...`, { replacements: repl, ...QUERY_OPTS });
  console.log(`[myNewDashboard.rowsA] ${Date.now() - t1}ms (n=${rowsA.length})`);

  const t2 = Date.now();
  const rowsB = await sequelize.query(`...`, { replacements: repl, ...QUERY_OPTS });
  console.log(`[myNewDashboard.rowsB] ${Date.now() - t2}ms (n=${rowsB.length})`);

  return { rowsA, rowsB };
}
```

When it times out in production, the log tells you immediately which query to attack.

---

## Lookback window, in case users notice

Default is **10 years**. Chosen because:

- Donors lapsed beyond 10 years have a ~2% published recapture probability — operationally dead weight
- Pledge commitments beyond 10 years are either fulfilled, written off, or historically closed
- Most foundation / nonprofit analysis is FY-based and only looks ~5 years back anyway
- Users with deeper-history needs can pick a specific FY (the `dateWhere` path), which bypasses the fallback

The LYBUNT - NEW dashboard exposes this directly as a UI dropdown (`Advanced filters → Look back (years)`, options 5 / 7 / 10 / 15 / 20 / 30). Other dashboards don't expose it yet; if a user complains they can't see 2005-era data, the right fix is to add a similar UI control rather than removing the fallback.

---

## Scorecard (chronological, April 14–15, 2026)

| Dashboard | Before | After | Fix applied |
|---|---|---|---|
| LYBUNT - NEW (built from scratch) | 25s timeout | ~8-12s first load, <100ms cached | All 4 patterns |
| Legacy CRM Overview | 25s timeout | ~3-6s | Composite index |
| Legacy LYBUNT / SYBUNT | 25s timeout | ~24s, passes | Composite index |
| Pledge Pipeline | 30s+ timeout | ~7s | #1 + #2 + pre-filter |
| Household Giving | 25s timeout | ~3-6s | #1 + #3 (compute-graph-once) |
| YoY Comparison | high-risk unbounded | bounded | #1 |
| Gift Trend Analysis | high-risk unbounded | bounded | #1 |
| Donor Insights | high-risk unbounded | bounded | #1 |
| Donor Lifecycle | medium-risk unbounded | bounded | #1 |
| Dept Analytics (no-MV) | 24.5s | bounded | #1 |
| Dept Extras | 24s | bounded | #1 |
| Geographic | 30s timeout | ~3ms (cached) 🚀 | #1 + bounded `first_gifts` CTE |
| Giving By Month (no-MV) | unbounded | bounded | #1 |
| Top Donors / Funds / Campaigns / Appeals (no-MV) | unbounded GROUP BY | bounded | #1 |
| Gifts By Type (no-MV) | unbounded | bounded | #1 |
| Fundraiser Leaderboard (no-MV) | unbounded JOIN | bounded | #1 |
| Entity Detail (Fund/Campaign/Appeal) | unbounded | bounded | #1 |
| Giving Pyramid | unbounded GROUP BY constituent_id | bounded | #1 |
| Donor Scoring (RFM) | unbounded + NTILE over all donors | bounded | #1 |
| Recurring Donor Analysis | unbounded GROUP BY constituent_id | bounded | #1 |
| Acknowledgment Tracker | unbounded | bounded | #1 |
| Matching Gift / Soft Credit | unbounded JOINs | bounded | #1 |
| Payment Method Analysis | unbounded | bounded | #1 |
| Campaign Comparison | unbounded GROUP BY | bounded | #1 |
| Fund Health Report (incl. `fundGrowth`) | always-unbounded GROUP BY fund + fy | always 10y bounded | #1 |
| Appeal Comparison / Detail | unbounded | bounded | #1 |
| First-Time Donor Conversion | 5 unbounded ROW_NUMBER CTEs | bounded | #1 |
| Anomaly Detection | 4 unbounded scans | bounded | #1 (donor anomaly scoped to 730d) |
| Department Detail (incl. `yoy`) | always-unbounded yoy | always 10y bounded | #1 |

---

## When a NEW dashboard times out, do this

1. Tail the Render log, trigger the load, capture the lines.
2. Find the function in `src/services/crmDashboardService.js` (or the V2 service file).
3. Is there per-query timing? If not, add `const t1 = Date.now(); ... console.log(...)` around each `sequelize.query` call, deploy, try again.
4. Which pattern is it?
   - **Unbounded scan** → `fallbackLookback(dateRange)` helper, splice `${fb.sql}` into WHERE, add `...fb.repl` to replacements.
   - **LEFT JOIN crm_gifts for names** → split into cohort query (LIMIT inside) + by-ID name lookup.
   - **CTE materialized twice** → UNION ALL with `row_type` + `AS MATERIALIZED` hint, demux in JS.
   - **Concurrent duplicate requests** → wrap the service function in `cached()` (already dedupes in-flight).
5. Commit, push, verify with the log.

If none of the patterns match: `EXPLAIN ANALYZE` the slow query directly against the DB. The planner's output usually makes the problem obvious.
