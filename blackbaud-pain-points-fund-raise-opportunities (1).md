# Blackbaud Pain Points & Fund-Raise Feature Opportunities

## Research Report — April 2026

*Sources: Blackbaud Community Forums, Capterra/G2/Gartner Reviews, StatusGator, Zuri Group, SelectHub, industry benchmarks (AFP Fundraising Effectiveness Project, M+R Benchmarks), and practitioner blogs.*

---

## PART 1: VALIDATED ANALYTICS & DATA VISUALIZATION GAPS

These are specific, documented reporting/analytics complaints from RE NXT users that represent buildable features for Fund-Raise.

---

### 1. Dashboard Totals Don't Match Actual Data

**The Problem:** Multiple users on Blackbaud Community have confirmed that NXT dashboard insight totals frequently don't match the underlying gift lists. One user reported showing £100,000 on a dashboard when the actual exported list totaled £95,000. Blackbaud confirmed gifts can go **missing** from dashboard reporting data entirely — one user proved gifts from October 2024 were absent as late as March 2025. There's also a ~30-minute sync delay between database view and NXT web view.

**User Quote Context:** Users report this as random with no identifiable pattern — sometimes it affects funds received, other times committed funds, and it spans both recent and historical gifts.

**Fund-Raise Opportunity:** Build dashboards that calculate directly from the imported gift data in your PostgreSQL database — no sync lag, no missing records, no mystery discrepancies. Your bulk import approach (weekly ~700K gift import) actually becomes a **feature** here: the data source is a single snapshot with a known timestamp, so every number is auditable and traceable. Add a "data freshness" indicator showing when the last import ran.

**Priority: HIGH** — This is a trust issue. Foundations making decisions off wrong numbers is a crisis-level problem.

---

### 2. Insight Designer Is a Paid Add-On ($2,500/yr) With Significant Limitations

**The Problem:** Insight Designer is Blackbaud's answer to custom reporting — but it costs ~$2,500/year on top of the already-expensive RE NXT subscription. It can't handle complex logic (e.g., showing total giving that includes both hard and soft credits without double-counting). It's limited to NXT data only — if your Crystal Reports required database-view-only data, Insight Designer won't help. Users describe its rules as "too complex" for many real-world reporting needs.

**Fund-Raise Opportunity:** Every Fund-Raise customer gets analytics included — no $2,500 upsell. Since you're working from imported raw gift data, you can build custom logic for soft credit handling, split gifts, and complex aggregation that Insight Designer simply can't do. This is a clear value proposition in sales conversations: "We don't charge extra for analytics that should be standard."

**Priority: HIGH** — Direct cost-saving value prop.

---

### 3. Year-Over-Year Comparison & Fiscal Year Reporting Is Painful

**The Problem:** Users consistently want side-by-side fiscal year comparisons (pledged vs. actual, YoY giving trends, campaign comparisons) and NXT makes this extremely difficult. Building a major gift pipeline dashboard requires combining multiple queries, multiple data sources, and often Power BI expertise. Pledge forecasting is described as "lackluster" — there's no single API endpoint for installment schedules with payments against each schedule. Users have to export 10+ installment columns per pledge, unpivot them, and write date formulas manually.

**Fund-Raise Opportunity:** Pre-built fiscal year comparison views. Since you have all the gift data imported, build:
- YoY revenue comparison (current FY vs. previous FY, with % change)
- Campaign-over-campaign comparison
- Pledge pipeline with forecasted installments by fiscal year
- Automatic LYBUNT/SYBUNT identification with revenue-at-risk calculations

This is the kind of analysis that takes fundraising staff hours in Excel or requires Power BI expertise they don't have.

**Priority: HIGH** — This is the #1 analytics use case that comes up in forums.

---

### 4. Donor Retention/Lifecycle Analytics Are Rigid & Surface-Level

**The Problem:** NXT has built-in lifecycle tags (Acquired, Retained, At-Risk, Lapsing, Lapsed, Lost) and some dashboard views, but the analytics are rigid:
- Lifecycle status doesn't update with gift filters
- Doesn't include soft credits
- Can't segment by fund, campaign, or giving level
- The retention dashboard uses fixed fiscal year windows — you can't customize the retention period
- First-time donor retention nationally is only 19% (FEP data) but NXT doesn't make it easy to drill into WHY

**Fund-Raise Opportunity:** Build retention analytics that are actually actionable:
- Retention rate by campaign, fund, gift channel, gift size bracket
- First-time donor conversion tracking (first gift → second gift timeline)
- At-risk donor identification with suggested re-engagement timing
- Donor upgrade/downgrade tracking (who increased/decreased giving YoY)
- Revenue impact of attrition ("you lost X donors worth $Y this year")
- Customizable retention windows (not locked to Blackbaud's 12/15/24/60 month definitions)

**Priority: HIGH** — Donor retention is the #1 strategic metric every foundation cares about, and NXT's version is acknowledged as incomplete even by Blackbaud's own documentation.

---

### 5. Reporting Workflow Is Broken (Generate → Download → Open)

**The Problem:** Blackbaud recently changed how reports work in FE NXT — you can no longer preview reports in-browser. Every report must be generated, downloaded as PDF/Excel, and then opened. Users describe this as "awful" and a "serious waste of time." There's no progress indicator while reports generate. Error messages don't surface until after a 20-minute wait. The notification system for completed reports is clunky — items don't disappear after download, so you lose track of what you've already opened.

**Fund-Raise Opportunity:** Fund-Raise dashboards render instantly in the browser. No downloads, no waiting, no lost notifications. The AI assistant can also generate on-demand custom reports through conversation: "Show me all donors over $1,000 in the last fiscal year who haven't given yet this year" → instant table, exportable to CSV if needed.

**Priority: MEDIUM** — This is more of a UX differentiator than a feature gap, but it matters for daily workflow.

---

### 6. Power BI Integration Is a Multi-Tool Nightmare

**The Problem:** Getting RE NXT data into Power BI requires one of:
- Blackbaud's Power BI Connector (limited data elements, same limited set as Insight Designer)
- CData connectors (paid third-party product)
- Query API → Power Automate → OneDrive/SharePoint → Power BI (complex, requires developer skills)
- Nightly database backup → SQL Server restore → SSRS (requires IT infrastructure)
- Third-party data warehouse (Aqueduct by Zuri Group, MissionBI Connect — both paid)

One user on the Community described trying to build a Power BI dashboard and finding the Power BI connector data "insufficient for their reporting needs." Another user built a pipeline of queries → Google Sheets via Apps Script → Power BI because nothing else worked reliably.

**Fund-Raise Opportunity:** Fund-Raise IS the visualization layer. No Power BI needed, no middleware, no data warehouse subscription. The imported gift data is already in PostgreSQL — you build the dashboards directly. For foundations that DO want Power BI, you could eventually offer a direct PostgreSQL connection or a simple API endpoint that returns clean, query-ready data.

**Priority: HIGH** — This eliminates an entire category of tooling and cost.

---

### 7. Soft Credit & Split Gift Reporting Confusion

**The Problem:** RE NXT's handling of soft credits and split gifts in analytics is a persistent source of confusion. If you use "gift amount received," soft credits are excluded. If you use "gift recognition amount," spousal soft credits double-count. There's no built-in way to get a financial report that includes both hard and soft credits without duplication. Split gifts (a single gift allocated across multiple campaigns/funds) create similar reporting complications.

**Fund-Raise Opportunity:** Since you control the data model, build configurable attribution logic:
- "Show me giving by household" (deduplicated across spouses)
- "Show me total raised per fund" (split gift amounts, not full gift amounts)
- Toggle views: hard credit only / with soft credits / household-level
- Clear labeling of what each number represents

**Priority: MEDIUM** — Important for sophisticated shops, less relevant for smaller foundations.

---

## PART 2: BROADER BLACKBAUD PAIN POINTS — GENERAL PLATFORM FRUSTRATIONS

These aren't just analytics issues — they're fundamental platform complaints that create opportunities for Fund-Raise to differentiate.

---

### 8. NXT Is Unfinished — "Don't Expect a Fully Armed and Operational Database"

**The Problem:** This is the single most consistent criticism across all sources. RE NXT has been in transition from Database View for years (since ~2021 for many orgs), and as of 2025-2026:
- Database View sunset is planned for first half of 2027
- Batch templates were removed with no NXT equivalent
- Global change/import functionality is uncertain
- Fields that can be made "required" in DB view aren't enforceable in NXT
- Media/document uploads done in NXT don't carry over to DB view (and vice versa in some cases)
- Many functions still require toggling between two different interfaces
- Query in web view was only fully released in December 2024

One Blackbaud Community power user summed it up: "Every time Blackbaud makes an 'improvement,' it actually reduces functionality and creates more difficulties."

**Fund-Raise Opportunity:** Fund-Raise doesn't need to replace RE NXT — it just needs to be the layer that makes RE NXT's data *useful*. Position Fund-Raise as the analytics and intelligence companion that does what NXT can't, without requiring foundations to leave Blackbaud. The weekly bulk import means Fund-Raise works alongside RE NXT rather than competing with it.

---

### 9. Performance & Reliability Issues

**The Problem:** NXT is widely reported as slow. Users report frequent browser freezes, loading circles that never resolve, blank screens, 504/503 errors, and sessions that crash when entering actions. StatusGator shows regular outage warnings — multiple incidents logged in January and February 2026 alone. One user said in 6 years of Database View they experienced 2 freezes; in NXT, they've lost count. Data input that took 3 hours in DB view balloons to 6-9 hours in NXT.

**Fund-Raise Opportunity:** Fund-Raise dashboards load from a local PostgreSQL database — no dependency on Blackbaud's servers. Even when NXT is down, your foundation can still view their analytics, run reports, and use the AI assistant. This is a resilience argument.

---

### 10. SKY API Limitations & Rate Limiting

**The Problem:** The SKY API is the only programmatic way to access NXT data, and it has significant constraints:
- Rate limits return 429 errors requiring backoff/retry logic
- Quota limits return 403 errors over broader time periods
- Data available through the API is limited to what Blackbaud exposes
- No bulk export endpoint — you have to paginate through records
- Pledge installment data requires per-pledge API calls (no batch endpoint)
- OAuth authentication is complex for non-developers
- API access may depend on subscription tier

**Fund-Raise Opportunity:** Your architectural decision to use bulk CSV imports instead of live API calls was prescient. The weekly import sidesteps all API limitations — rate limits, quotas, incomplete endpoints. This is worth highlighting in your sales material: "We don't fight with the API. We work with your data export."

---

### 11. Customer Support Has Deteriorated

**The Problem:** Blackbaud eliminated phone support in favor of chat-only, and users report:
- Chat agents are often unavailable even during stated hours
- Agents lack deep product knowledge
- Cases stay open for months (one user reported unresolved cases since 2014)
- The Blackbaud Community (user forums) has become the de facto support channel — users help each other because official support is inadequate

**Fund-Raise Opportunity:** The AI assistant in Fund-Raise can serve as instant, always-available support for RE NXT questions. Since you're building the AI to understand each foundation's specific RE NXT configuration (inferred from imported data), this is contextual support that Blackbaud's own team can't provide.

---

### 12. Cost Escalation & Vendor Lock-In

**The Problem:** RE NXT pricing is not publicly listed and varies by organization. Users report:
- Costs nearly doubling when moving from RE7 to NXT
- Constituent count bands that penalize organizations for having alumni/non-donors in their database
- Insight Designer as a $2,500/yr add-on
- Hidden costs for modules, training (Blackbaud University), and integrations
- Third-party reporting solutions (MissionBI, Aqueduct, CData) adding $3,000-$10,000+/yr on top
- Switching costs are prohibitive — orgs feel locked in

**Fund-Raise Opportunity:** Transparent, predictable pricing. And by replacing the need for Insight Designer + Power BI + data warehouse middleware, Fund-Raise can position itself as cost-negative: "Fund-Raise costs $X, but it eliminates $Y in reporting tool subscriptions you're currently paying."

---

## PART 3: FEATURE OPPORTUNITY MATRIX

What Fund-Raise can realistically build that RE NXT currently doesn't do well, ranked by impact and feasibility given your stack (Node/Express/PostgreSQL + Claude AI).

| Feature | User Demand | Build Complexity | Competitive Gap | Priority |
|---------|-------------|-----------------|-----------------|----------|
| **Instant donor retention dashboard** | Very High | Medium | Wide | 🔴 P0 |
| **YoY fiscal year comparison** | Very High | Low | Wide | 🔴 P0 |
| **Campaign performance comparison** | High | Low | Medium | 🔴 P0 |
| **LYBUNT/SYBUNT with revenue-at-risk** | Very High | Medium | Wide | 🔴 P0 |
| **Donor upgrade/downgrade tracking** | High | Medium | Wide | 🟡 P1 |
| **Gift channel/source analysis** | High | Low | Medium | 🟡 P1 |
| **Pledge pipeline & installment forecast** | High | Medium | Wide | 🟡 P1 |
| **Household-level giving (deduped soft credits)** | Medium | High | Wide | 🟡 P1 |
| **AI-generated natural language insights** | Medium | Medium | Very Wide | 🟡 P1 |
| **Giving band distribution (pyramid)** | Medium | Low | Medium | 🟢 P2 |
| **First-time donor conversion funnel** | Medium | Medium | Wide | 🟢 P2 |
| **Board-ready report generation** | Medium | Medium | Medium | 🟢 P2 |
| **Recurring giving growth tracking** | Medium | Low | Medium | 🟢 P2 |
| **Event ROI analysis** | Low-Medium | Medium | Medium | 🟢 P2 |

---

## PART 4: WHAT THE AI ASSISTANT UNIQUELY ENABLES

These are opportunities that only exist because Fund-Raise has an AI layer — things no amount of traditional dashboard building can replicate.

1. **Natural Language Querying:** "How many donors gave over $500 last year but haven't given yet this year?" → instant answer with exportable list. No query builder, no filters, no export process.

2. **Anomaly Detection:** "Your Q2 giving is tracking 12% below Q2 last year. The largest single-factor is a decline in $100-$499 gifts. Here are the 47 donors in that bracket who gave last Q2 but not this Q2."

3. **RE NXT Troubleshooting via Screenshots:** Users upload a screenshot of an error or confusing screen → AI identifies the issue and provides step-by-step guidance specific to their org's configuration.

4. **Proactive Insights:** Rather than waiting for users to ask questions, the AI can surface insights when they log in: "You have 23 donors at risk of lapsing this month based on their historical giving patterns."

5. **Data Quality Flags:** "I noticed 147 constituent records with no email address who have given in the last 12 months. Want to see the list?" — something RE NXT doesn't proactively surface.

6. **Benchmark Context:** Pair internal metrics with industry benchmarks (FEP, M+R data): "Your first-time donor retention rate is 22%, which is above the national average of 19%."

---

## PART 5: KEY INDUSTRY DATA POINTS FOR POSITIONING

Use these in sales materials and product messaging:

- **$557.16B** in total US charitable giving (2023)
- **19%** first-time donor retention rate nationally (FEP 2024)
- **69%** existing donor retention rate nationally
- **31%** of online nonprofit revenue now comes from monthly/recurring gifts
- **Only 12%** donor conversion rate on donation pages
- **Only 7%** of nonprofits use AI strategically enough to enhance workflows (2026 AI Adoption Report)
- **5%** growth in monthly giving revenue vs. flat one-time giving
- **$2,500/yr** for Blackbaud Insight Designer (on top of RE NXT subscription)
- **$3,000-$10,000+/yr** for third-party data warehouse/reporting solutions

---

## PART 6: COMPETITIVE POSITIONING NOTES

### Fund-Raise vs. the Current Blackbaud Reporting Stack

| Capability | RE NXT Native | + Insight Designer ($2,500/yr) | + Power BI + Data Warehouse ($5K-$15K/yr) | Fund-Raise |
|------------|---------------|-------------------------------|-------------------------------------------|------------|
| Basic dashboards | ✅ (buggy) | ✅ | ✅ | ✅ |
| Custom analytics | ❌ | Partial | ✅ | ✅ |
| YoY comparison | ❌ | Limited | ✅ | ✅ |
| Retention analysis | Rigid | Rigid | ✅ | ✅ |
| AI-powered insights | ❌ | ❌ | ❌ | ✅ |
| Natural language queries | ❌ | ❌ | ❌ | ✅ |
| RE NXT troubleshooting | ❌ | ❌ | ❌ | ✅ |
| No API dependency | ❌ | ❌ | ❌ | ✅ |
| Works when NXT is down | ❌ | ❌ | Partial | ✅ |
| Total incremental cost | $0 | $2,500/yr | $5K-$15K/yr | TBD |

---

*Research compiled April 2026. Sources include Blackbaud Community forums, Capterra, Gartner Peer Insights, G2, Software Advice, industry benchmark reports, and practitioner blogs.*
