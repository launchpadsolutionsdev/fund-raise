# Fund-Raise Competitive Analysis & Feature Roadmap
## April 5, 2026

*Analysis of Blackbaud pain points (from community forums research) mapped against Fund-Raise's existing capabilities and buildable opportunities.*

---

## PART A: What We've ALREADY Built

| # | Blackbaud Pain Point | Fund-Raise Feature | Status |
|---|---------------------|-------------------|--------|
| **1** | **Dashboard totals don't match actual data** | All dashboards calculate directly from imported PostgreSQL data. Single snapshot, auditable, no sync lag. CRM import shows timestamp + row counts. | **SOLVED** |
| **2** | **Insight Designer is a $2,500/yr add-on** | 22 analytics dashboards included: CRM overview, dept analytics, donor scoring, gift trends, campaign compare, fund health, YoY, appeal compare, donor lifecycle, recurring donors, soft credits, matching gifts, payment methods, acknowledgments, donor insights, gift search + filters. No upsell. | **SOLVED** |
| **3** | **YoY comparison & fiscal year reporting** | `getYearOverYearComparison()` — dedicated YoY dashboard. `getCampaignComparison()` — campaign-over-campaign. `getAppealComparison()` — appeal-over-appeal. FY picker on every dashboard (April-March). Department analytics has YoY growth table. | **MOSTLY SOLVED** (missing: pledge pipeline/installment forecasting, LYBUNT/SYBUNT) |
| **4** | **Donor retention/lifecycle is rigid** | `getDonorRetention()` — retention rates. `getDonorLifecycleAnalysis()` — full lifecycle dashboard. `getDonorScoring()` — scoring with recency/frequency/monetary. `getDonorInsights()` — donor insights dashboard. | **PARTIALLY SOLVED** (missing: retention by fund/campaign/channel, first-time donor conversion funnel, upgrade/downgrade tracking, revenue impact of attrition, customizable retention windows) |
| **5** | **Reporting workflow is broken (generate → download → open)** | All dashboards render instantly in-browser. CSV export available. Ask Fund-Raise AI answers ad-hoc questions with instant results. Gift search with filters returns inline results. | **SOLVED** |
| **6** | **Power BI integration is a nightmare** | Fund-Raise IS the visualization layer. No Power BI needed. 22 pre-built dashboards + Chart.js charts + AI chat. | **SOLVED** |
| **7** | **Soft credit & split gift reporting** | `getSoftCreditAnalysis()` — dedicated soft credit dashboard. `getMatchingGiftAnalysis()` — matching gift analysis. Separate `crm_gift_soft_credits` and `crm_gift_matches` tables imported from RE NXT export. | **PARTIALLY SOLVED** (missing: household-level deduplication, toggle views for hard/soft/household) |
| **8** | **NXT is unfinished** | Fund-Raise positions as the analytics companion, not a replacement. Works from bulk CSV import alongside RE NXT. | **SOLVED** (architectural decision) |
| **9** | **Performance & reliability** | PostgreSQL local queries, 10-min cache, pre-computed department column, materialized views, covering indexes. Works when NXT is down. | **SOLVED** |
| **10** | **SKY API limitations** | Bulk CSV import sidesteps all API issues. No rate limits, no quotas, no OAuth complexity. | **SOLVED** (architectural decision) |
| **11** | **Customer support deteriorated** | Ask Fund-Raise AI — contextual, always-available, understands the org's specific data. | **PARTIALLY SOLVED** (AI chat exists, but doesn't yet do RE NXT troubleshooting from screenshots) |
| **12** | **Cost escalation** | Replaces Insight Designer ($2,500/yr) + Power BI stack ($5-15K/yr). Transparent pricing. | **SOLVED** (positioning) |

---

## PART B: Feature Matrix — Built vs. Gaps

| Feature | Priority (from research) | Status | What Exists |
|---------|--------------------------|--------|-------------|
| Instant donor retention dashboard | P0 | **BUILT** | `getDonorRetention()`, `getDonorLifecycleAnalysis()` |
| YoY fiscal year comparison | P0 | **BUILT** | `getYearOverYearComparison()`, dedicated page |
| Campaign performance comparison | P0 | **BUILT** | `getCampaignComparison()`, dedicated page |
| LYBUNT/SYBUNT with revenue-at-risk | P0 | **NOT BUILT** | Gap — #1 priority to build |
| Donor upgrade/downgrade tracking | P1 | **NOT BUILT** | Gap — #2 priority to build |
| Gift channel/source analysis | P1 | **PARTIALLY** | `getPaymentMethodAnalysis()` covers payment methods, `getGiftsByType()` covers gift codes |
| Pledge pipeline & installment forecast | P1 | **NOT BUILT** | No pledge data in current model |
| Household-level giving | P1 | **NOT BUILT** | Gap — needs soft credit grouping logic |
| AI-generated natural language insights | P1 | **BUILT** | Ask Fund-Raise AI chat with CRM context + streaming |
| Giving band distribution (pyramid) | P2 | **BUILT** | `getGivingPyramid()` |
| First-time donor conversion funnel | P2 | **NOT BUILT** | Gap — #3 priority to build |
| Board-ready report generation | P2 | **NOT BUILT** | Gap |
| Recurring giving growth tracking | P2 | **BUILT** | `getRecurringDonorAnalysis()` |
| Event ROI analysis | P2 | **NOT BUILT** | Gap — needs expense data |

---

## PART C: AI Features — Built vs. Gaps

| AI Feature (from research Part 4) | Status | Notes |
|-----------------------------------|--------|-------|
| Natural language querying | **BUILT** | Ask Fund-Raise AI with SSE streaming, conversation persistence |
| Anomaly detection | **NOT BUILT** | AI can answer if asked, but no proactive surfacing |
| RE NXT troubleshooting via screenshots | **NOT BUILT** | Multimodal upload exists but no RE NXT knowledge base |
| Proactive insights on login | **NOT BUILT** | High-value feature, buildable from existing data |
| Data quality flags | **BUILT** | Data Quality dashboard with health score, field completeness, duplicate detection |
| Benchmark context | **NOT BUILT** | No industry benchmark data (FEP/M+R) integrated yet |

---

## PART D: Build Roadmap (Prioritized)

### Immediate (Next to Build)

1. **LYBUNT/SYBUNT Dashboard** — "Last Year But Unfortunately Not This Year" / "Some Years But Unfortunately Not This Year." Query donors who gave in prior FY but not yet in current FY. Show dollar amount at risk, donor list with giving history, and segmentation by gift size. This is the single highest-value analytics feature missing from Fund-Raise.

2. **Donor Upgrade/Downgrade Tracking** — Compare each donor's giving in current FY vs. prior FY. Classify as upgraded (gave more), maintained (similar), downgraded (gave less), or lapsed (stopped). Show revenue impact per bucket and identify upgrade candidates.

3. **First-Time Donor Conversion Funnel** — Track the gap between first gift and second gift. What % of first-time donors convert to repeat donors? How long does it take? National benchmark is only 19% — this lets orgs measure themselves. Identify first-time donors who haven't yet made a second gift for targeted outreach.

### Near-Term Enhancements

4. **Proactive Insights on Login** — Auto-generated insight cards on the CRM dashboard: "23 donors at risk of lapsing this month", "Q2 giving is tracking 12% below last year", "Your first-time donor retention is 22%". Computed from existing queries.

5. **Enhanced Retention Analytics** — Add drill-down by fund, campaign, gift size bracket, and department to the existing retention dashboard.

6. **Household-Level Giving** — Use soft credit data to group spouses/households and show deduplicated household giving totals.

### Future Considerations

7. Board-ready PDF report generation
8. Event ROI analysis (needs expense data)
9. Industry benchmark integration (FEP/M+R numbers)
10. Pledge pipeline & installment forecasting (needs pledge data in import)

---

## PART E: Existing Feature Inventory (36 Analytics Functions)

For reference, Fund-Raise currently ships with:

**Core Analytics:** getCrmOverview, getGivingByMonth, getTopDonors, getTopFunds, getTopCampaigns, getTopAppeals, getGiftsByType, getFiscalYears

**Fundraiser Analytics:** getFundraiserLeaderboard, getFundraiserPortfolio

**Donor Analytics:** getDonorRetention, getGivingPyramid, getDonorDetail, getDonorScoring (RFM-based, 9 segments), getDonorLifecycleAnalysis (6 lifecycle stages), getDonorInsights (Thank/Reconnect/Upgrade/New lists)

**Gift Analytics:** searchGifts, getFilterOptions, getEntityDetail, getRecurringDonorAnalysis, getAcknowledgmentTracker, getMatchingGiftAnalysis, getSoftCreditAnalysis, getPaymentMethodAnalysis, getGiftTrendAnalysis

**Comparison Analytics:** getCampaignComparison, getAppealComparison, getAppealDetail, getFundHealthReport, getYearOverYearComparison

**Department Analytics:** getDepartmentAnalytics, getDepartmentExtras (pre-computed classification, no regex at query time)

**Goal Tracking:** getFundraiserGoals/set/delete, getDepartmentGoals/set/delete, getDepartmentActuals

**Data Quality:** getDataQualityReport (health score, field completeness, duplicates, anomalies)

**Infrastructure:** 11 materialized views, 10-minute in-memory cache, covering indexes, cache warming on import, 25s timeout guards

---

*Analysis compiled April 5, 2026. Based on Blackbaud community forum research cross-referenced against Fund-Raise codebase.*
