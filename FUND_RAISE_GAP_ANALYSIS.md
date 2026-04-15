# Fund-Raise Platform — Comprehensive Gap Analysis

> **Date:** 2026-04-15
> **Scope:** What's missing on Fund-Raise vs. top-tier nonprofit SaaS (Raiser's Edge NXT, Bloomerang, Virtuous, Bonterra/EveryAction, DonorPerfect, Neon One, Keela, Kindful, Salesforce NPSP, Givebutter, Classy, Little Green Light) and general SaaS category leaders.
> **Audience:** Product + engineering planning.
> **Purpose:** Decide what to build next and what to cut from scope.

---

## How to read this document

Fund-Raise today is an **analytics companion** for Raiser's Edge NXT foundations. It does one thing extremely well — turning a weekly CSV/XLSX export into 30+ instant dashboards and an AI analyst — and it replaces the Insight Designer + Power BI + data-warehouse stack that most RE NXT shops cobble together.

That is a real product with a real wedge.

But the term "Fund-Raise" implies the full platform a fundraising shop would live in. If you want it to actually replace Raiser's Edge — not just supplement it — or if you want it to stand up against Bloomerang, Virtuous, Neon One, or Bonterra as a full all-in-one, the surface area below tells you exactly where the gaps are.

Every gap below is labelled:

- **Scope:** `companion` (nice-to-have as the analytics layer) | `core` (required to be the primary fundraising platform) | `enterprise` (required for >$10M foundations / healthcare / higher-ed)
- **Effort:** `S` (days) | `M` (weeks) | `L` (months) | `XL` (multi-quarter)
- **Competitor presence:** The vendors where this is already table-stakes.

This document is intentionally exhaustive. Cut aggressively before committing to build.

---

## Table of Contents

1. [What Fund-Raise has today (the baseline)](#1-what-fund-raise-has-today-the-baseline)
2. [Data model gaps — the foundation everything else sits on](#2-data-model-gaps--the-foundation-everything-else-sits-on)
3. [Constituent / donor CRM gaps](#3-constituent--donor-crm-gaps)
4. [Gift processing, receipting, compliance](#4-gift-processing-receipting-compliance)
5. [Online giving & donation forms](#5-online-giving--donation-forms)
6. [Pledges, recurring, planned giving](#6-pledges-recurring-planned-giving)
7. [Prospect research, moves management, major gifts](#7-prospect-research-moves-management-major-gifts)
8. [Grants & grant management](#8-grants--grant-management)
9. [Events, P2P, auctions](#9-events-p2p-auctions)
10. [Communications & marketing automation](#10-communications--marketing-automation)
11. [Direct mail workflow](#11-direct-mail-workflow)
12. [Volunteer & membership management](#12-volunteer--membership-management)
13. [Reporting & BI depth](#13-reporting--bi-depth)
14. [AI / intelligence gaps](#14-ai--intelligence-gaps)
15. [Integrations catalog](#15-integrations-catalog)
16. [Security, compliance, enterprise readiness](#16-security-compliance-enterprise-readiness)
17. [Admin, billing, multi-tenant ops](#17-admin-billing-multi-tenant-ops)
18. [Quality-of-life & UX table stakes](#18-quality-of-life--ux-table-stakes)
19. [Mobile, accessibility, internationalization](#19-mobile-accessibility-internationalization)
20. [Developer platform & extensibility](#20-developer-platform--extensibility)
21. [Observability & reliability](#21-observability--reliability)
22. [Vertical-specific gaps (healthcare, higher-ed, arts, faith)](#22-vertical-specific-gaps)
23. [Priority matrix — what to build first](#23-priority-matrix--what-to-build-first)
24. [Appendix A: Competitor feature cross-reference](#appendix-a-competitor-feature-cross-reference)
25. [Appendix B: "Raiser's Edge NXT parity" checklist](#appendix-b-raisers-edge-nxt-parity-checklist)

---

## 1. What Fund-Raise has today (the baseline)

So that we're grading against the right baseline. Every gap below is calibrated off this inventory.

### Analytics (30+ dashboards)
- CRM overview, giving-by-month, top donors/funds/campaigns/appeals
- Donor scoring (RFM, 9 segments), retention (overall + drilldown by fund/campaign/giving-level/department), lifecycle (6 stages), insights (Thank/Reconnect/Upgrade/New lists)
- LYBUNT/SYBUNT with revenue-at-risk, upgrade/downgrade tracking, first-time-donor conversion funnel with 19% FEP benchmark
- Household giving (soft-credit dedup), geographic analytics, donor-upgrade/downgrade, giving pyramid
- Recurring donors, acknowledgments tracker, matching gifts, soft credits, payment methods, gift trends
- Campaign/appeal/fund/YoY comparison, fund health, appeal detail
- Fundraiser leaderboard + portfolio, fundraiser goals, department analytics + department goals
- Data quality dashboard (health score, field completeness, duplicates), anomaly detection (statistical: monthly spikes, outlier gifts, fund anomalies, donor behavior, seasonal)
- AI Recommendations (rule-based: thank-you follow-ups, lapsed major re-engagement, upgrade candidates, recurring conversion, year-end appeal, data quality)
- Proactive insights card row on dashboard (at-risk, YoY change, retention, upgrade summary, recent large gifts, anomalies)

### AI / intelligence
- **Ask Fund-Raise** — conversational SSE-streamed chat with tool-use (CRM query via safe SELECT, analytics tools, action tools, team tools, operational tools, Blackbaud SKY tools, web search)
- Conversation persistence, rename, delete, share-with-teammate
- Image upload for multimodal analysis
- Deep Dive mode + CRM mode + RE NXT knowledge base routing
- Push-panel AI on every page (540px slide-out)
- **Writing assistant** — 3 modes × 6 content types × 4 tones
- **Thank-you letters** — 5 styles with personalization
- **Impact stories** — 5 formats × 5 focus areas
- **Meeting prep** — 6 meeting types with live data context
- **Weekly digest** — 4 tones × 4 audiences
- **Scenario planner** — what-if analysis

### Team / workflow
- Action Centre — task assignment with priority/due-date/constituent link, comments, RE NXT sync (bidirectional with SKY API)
- Message board with categories, pinning, comments
- Kudos wall with categories + emoji reactions + leaderboard
- Milestones with celebration animations
- Bingo (gamified challenge board)
- Quick notes (sticky-note-style personal notes)
- Staff directory, profile editor (name/title/bio/avatar)

### Data / integrations
- CRM import: CSV + XLSX up to 300 MB, auto column mapping, preview, background progress, UPSERT transaction with stale-row cleanup, post-import classification + cache warming
- Department snapshot upload (legacy, per-department Excel)
- Blackbaud OAuth 2.0 connection (token encryption at rest, auto-refresh)
- Blackbaud SKY API — constituent/gift search, profile, giving history, action sync
- Google OAuth sign-in (only auth method)
- Email via Nodemailer/SMTP (invitations, welcome, import-complete, quota warning, invite-accepted)
- CSV export from 7 dashboards; PDF board report (PDFKit)

### Admin / settings
- Organization profile (name, mission, address, phone, website, EIN, fiscal year start, logo)
- Team management — invite by email, 3 roles (admin/uploader/viewer)
- Onboarding wizard (5 steps)
- Blackbaud settings page
- Feature flags (code-level, cached 5 min in session)
- Audit log *model* (with category, action, target, metadata, ipAddress) — no UI

### Infrastructure / security (post-remediation)
- PostgreSQL RLS for tenant isolation (defense-in-depth on top of explicit WHERE clauses)
- CSRF protection (csrf-csrf), Helmet headers, rate-limited login (10/15min)
- Token encryption (AES-256-GCM) for Blackbaud tokens
- Express-validator for input validation
- Global 28s timeout, 25s per-handler timeout
- Session store in Postgres, 7-day cookie
- Materialized views (11), covering indexes, 10-min in-memory cache, cache warming

### Content / SEO
- Public landing page + insights blog (9 articles indexed)
- `/whats-new` page
- Privacy + terms pages

### Absent baselines worth calling out
- No PWA manifest beyond the HTML link (no service worker)
- No TypeScript, ESLint, Prettier
- No CI/CD, no staging environment
- No Sentry / APM / uptime monitor
- No dark mode
- No global search
- No notification center
- No in-app help / tour
- No public API / webhooks
- No billing / subscription

---

## 2. Data model gaps — the foundation everything else sits on

This is the single biggest structural gap and blocks almost every feature below.

The `crm_gifts` table is a wide denormalized row — one gift carries constituent PII, fund metadata, campaign metadata, appeal metadata, package metadata, and a pre-computed department string. There is **no first-class Constituent, Fund, Campaign, Appeal, Relationship, Household, Pledge, Proposal, or Action-on-Donor model**. Everything is re-derived from gift rows at query time (with materialized views to make it fast).

This works *only* because Fund-Raise is a read-only analytics layer over a weekly export. The moment you want to let a user create/edit a donor, log a call, write a pledge, or link two constituents, you have nowhere to put the data.

### 2.1 Missing first-class entities

| Entity | Scope | Effort | Why it matters |
|--------|-------|--------|----------------|
| **Constituent** (normalized) | core | L | One row per person/org, joined by ID. Required to edit donor info, add notes, track relationships. Fixes the "update address on 50 gift rows" bloat. |
| **Household** | core | M | Currently derived from soft credits at query time. Needs to be a named entity with head-of-household, member list, combined giving, shared mailing address. Competitors call this "Household record" (RE), "Relationship" (Bloomerang), "Household Account" (NPSP). |
| **Relationship** | core | M | Spouse, partner, child, parent, sibling, employer, employee, board, volunteer, advisor, executor. RE and NPSP both model relationships as bidirectional records. Drives household formation, stewardship mapping, grateful-patient referrals. |
| **Fund / Designation** | core | S | Currently just a string on gifts. Should have description, restricted/unrestricted flag, GL account, start/end date, target amount, parent hierarchy. |
| **Campaign** | core | S | Needs goal, phases (quiet/public/wrap), start/end, parent campaign, gift-table target (e.g., "3 gifts at $100K"). |
| **Appeal** | core | S | Package, channel, segment, cost, projected response rate — all needed for real appeal ROI analysis. |
| **Package** | companion | S | Mailing variant within an appeal (A/B test). Currently stored as a string on the gift. |
| **Pledge** | core | L | Installment schedule, write-offs, balance outstanding, pledge-vs-payment reconciliation. Fund-Raise currently *excludes pledges* from materialized views (see `EXCLUDE_PLEDGE_SQL`). |
| **Recurring gift / commitment** | core | M | Modeled today only by pattern-matching historical gift cadences. Real recurring giving needs schedule, next-run date, card-on-file, lapse reason, upgrade history. |
| **Proposal / Opportunity** | core | M | Moves-management record. Stage, ask amount, expected close, probability, solicitor, strategy, gift-chart placement. RE calls this "Opportunity"; NPSP calls it "Opportunity" too; Bloomerang calls it "Proposal". |
| **Action / Contact Report** | partial | M | Fund-Raise has a lightweight Action model scoped to task assignment. A real "contact report" is a logged interaction (call, visit, email, letter) with channel, direction, duration, attendees, follow-up tasks, attachments. |
| **Note / Attachment** | core | M | No attachments anywhere. Donors need proposal PDFs, gift agreements, MOUs, photos, handwritten-note scans attached to their record. |
| **Rating** | enterprise | M | Capacity / affinity / inclination ratings, sourced from wealth screens or staff input. Drives portfolio triage. |
| **Membership** | core (verticals) | M | Required for museums, public broadcasters, professional associations. Tiers, benefits, renewal date, lapsed date. |
| **Event** | core | L | Event header + registrations + tickets + tables + seating + sponsorship levels. Currently no event entity at all. |
| **Volunteer assignment** | companion | M | Hours, role, certifications, background check status. |
| **Tribute / Memorial / Honor gift** | core | S | A gift in honor/memory of someone, with an acknowledgement recipient. Every CRM has this. Fund-Raise has no tribute fields. |
| **Gift designation split** | core | S | One gift across multiple funds with per-split amounts. RE supports this; Fund-Raise currently flattens to a single fund per gift row. |
| **Matching-gift claim** | partial | S | Has `crm_gift_matches` but no workflow for "submit claim", "pending", "paid". |
| **Solicit code** | partial | S | Stored on gift rows; needs UI to manage codes and exclusion rules (do-not-solicit, do-not-phone, no-email). |
| **Consent ledger** | core | M | Immutable history of every consent change (opt-in, opt-out, channel, date, source). CASL/GDPR/PIPEDA require this. Today only single boolean flags. |
| **Constituent code / type** | partial | S | Individual / Organization / Foundation / Trust / Government / Corporation — each with a different processing flow. Today a single string. |
| **Address (multiple)** | core | M | Home, seasonal, work, legal, mailing — each with start/end dates and primary flag. Today one address per gift row. |
| **Phone (multiple)** | core | S | Home / mobile / work / fax with do-not-call per number. |
| **Email (multiple)** | core | S | Primary, work, bounce status, last-click date. |
| **Salutation variants** | core | S | Formal, informal, envelope, addressee, spouse-joint — essential for mail merge. Fund-Raise has `primaryAddressee` only. |
| **Custom fields** | enterprise | L | Every CRM lets customers add their own fields to constituents, gifts, campaigns. Fund-Raise has no custom-field framework. |

### 2.2 Consequences of the current flat model

- **Can't let users edit a donor** — the "donor" is an aggregation of gift rows.
- **Can't attach documents** to a donor, fund, campaign.
- **Can't log interactions** beyond tasks.
- **Can't build a proper portfolio view** — a fundraiser's "my donors" is currently computed from gift attribution, not from an assignment record.
- **Can't run an appeal ROI report** — there's no cost-of-appeal anywhere.
- **Can't track pledges** — the system explicitly filters them out.
- **Data quality dashboard is the ceiling of data-quality functionality** — you can see bad data but you can't fix it in-app.

### 2.3 What to do about it

Three options, in order of effort:

1. **Normalize behind the analytics layer** (M–L). Create `constituents`, `funds`, `campaigns`, `appeals`, `pledges`, `households`, `relationships`, `proposals`, `contact_reports` tables. Populate from the weekly import. The analytics layer keeps working; mutation flows can land on normalized tables first. This is the pragmatic path.
2. **Move to a hybrid model** (L). Keep `crm_gifts` as the fact table, but constituent/fund/campaign become reference tables with full CRUD. Join via IDs, not by re-aggregating from gifts.
3. **Rebuild as a full constituent-centric CRM** (XL). Multi-quarter effort. Only worth doing if the product positioning moves from "analytics companion" to "Raiser's Edge replacement."

Recommendation: **option 1 this quarter**, revisit after six months of customer conversations.

---

## 3. Constituent / donor CRM gaps

Assuming you address the data-model gap above, here is the constituent-experience feature set missing today.

### 3.1 Constituent record essentials

| Gap | Scope | Effort | RE NXT | Bloomerang | Virtuous | NPSP |
|-----|-------|--------|--------|------------|----------|------|
| Create / edit / merge constituents | core | M | ✓ | ✓ | ✓ | ✓ |
| Merge duplicate constituents with audit trail | core | M | ✓ | ✓ | ✓ | ✓ |
| Attach documents (PDFs, images, signed agreements) | core | M | ✓ | ✓ | ✓ | ✓ |
| Multi-address with seasonal dates + NCOA flag | core | M | ✓ | ✓ | ✓ | ✓ |
| Multi-email with bounce tracking + validation | core | M | ✓ | ✓ | ✓ | ✓ |
| Multi-phone with do-not-call reason | core | S | ✓ | ✓ | ✓ | ✓ |
| Salutation / addressee variants (formal, informal, envelope, joint) | core | S | ✓ | ✓ | ✓ | ✓ |
| Constituent code / type (Individual, Organization, Foundation, Trust, Government, Corporate, DAF) | core | S | ✓ | ✓ | ✓ | ✓ |
| Relationships with role + bidirectional record | core | M | ✓ | ✓ | ✓ | ✓ |
| Employment (current employer, job title, dates) | core | S | ✓ | ✓ | ✓ | ✓ |
| Education / alma mater / class year | core (higher-ed) | S | ✓ | partial | partial | ✓ |
| Board / committee / volunteer roles with start/end dates | companion | S | ✓ | ✓ | ✓ | ✓ |
| Birthday + anniversary with reminders | companion | S | ✓ | ✓ | ✓ | ✓ |
| Communication preferences per channel with effective-date history | core | M | ✓ | ✓ | ✓ | ✓ |
| Do-not-contact reason + who flagged it + when | core | S | ✓ | ✓ | ✓ | ✓ |
| Tags / interests / affiliations (open taxonomy) | core | S | ✓ | ✓ | ✓ | ✓ |
| Wealth / capacity indicators (net worth, real estate, stock, ticker) | enterprise | L | add-on | partial | ✓ | via integration |
| Custom fields per tenant | enterprise | L | ✓ | ✓ | ✓ | ✓ |

### 3.2 Interaction log (contact reports)

Every serious fundraising CRM has a "log an interaction" flow that Fund-Raise lacks:

- Log call, visit, email, letter, text, video call, event attendance with date/duration/channel/direction.
- Attach attendees (internal + external).
- Attach documents (proposal drafts, site-visit photos, signed letters).
- Spawn follow-up tasks automatically.
- Roll up to donor record with filterable timeline.
- Convert email thread → contact report (Outlook/Gmail add-in).
- AI-summarize voice memo → contact report (Otter / Fathom / Fireflies integration).

Fund-Raise has the `actions` table (tasks only) and `postComments` (board comments). Neither is a substitute for a proper interaction log.

### 3.3 Donor 360° view

A donor detail page today (`/crm/donor/:constituentId`) is excellent as a giving-history visualization. What's missing:

- **Engagement score** (giving + opens + clicks + event attendance + volunteer + responses) — Bloomerang's "Engagement Meter" is their single most-recognized feature.
- **Timeline** merging gifts, actions, emails, calls, events, web visits.
- **At-a-glance summary** panel the AI generates: "Mrs. Smith gave $12K over 8 years, her average gift has grown 15% YoY, she's historically a Q4 donor, she responds to handwritten notes, her spouse is a soft-credit recipient on 60% of gifts."
- **Next best action** suggestion per donor.
- **Proposed ask amount** (propensity × capacity × inclination).
- **Stewardship history** (thank-you sent, impact report sent, event invited, event attended).
- **Wealth indicators** panel (when wealth screening is integrated).
- **Communications history** — what was sent, opened, clicked.
- **Notes** with @mentions, rich text, pinning.
- **Portfolio assignment** — which fundraiser(s) steward this donor.

### 3.4 Portfolio management

Fundraisers need a "my donors" screen that isn't just "gifts I'm credited on":

- Assignment records (solicitor of record, primary manager, secondary manager, stewardship owner).
- Portfolio capacity / triage view.
- Due-for-touch list based on last-contact rules.
- Portfolio performance dashboard (pipeline $, won $, touches completed).
- Transfer portfolios when a fundraiser leaves.

Today you have `getFundraiserPortfolio()` which groups gifts by fundraiser name — no assignment concept.

### 3.5 Prospect pool

A distinct list of "people worth cultivating" vs. "confirmed donors". Competitors support:

- Status stages: Identify → Qualify → Cultivate → Solicit → Steward → Dormant.
- Pool workflows: daily prospect review, reassignment queue.
- Research packet export (profile + capacity + affinity + notes in one PDF).
- Constituent code filtering (Board prospect, major prospect, planned-giving prospect).

---

## 4. Gift processing, receipting, compliance

Fund-Raise is a read-only reporter; it does not *process* gifts. For a healthcare or university foundation that may be fine — they use RE NXT as system-of-record and Fund-Raise as analytics. For a foundation looking to consolidate stacks, this is table-stakes missing.

### 4.1 Gift entry / adjustment

| Gap | Scope | Effort |
|-----|-------|--------|
| Manual gift entry form (one-off gifts) | core | M |
| Bulk gift batch entry (daily batch, like a gift officer's data-entry screen) | core | M |
| Gift adjustment / reversal / refund with audit trail | core | M |
| Stock gift entry (ticker, shares, price, broker, sale-proceeds received) | core (large shops) | M |
| In-kind gift entry (description, valuation, valuation source) | core | S |
| DAF (Donor-Advised Fund) handling — acknowledge the individual, receipt to the DAF sponsor | core | S |
| Matching-gift claim workflow (company, status, claim URL, paid date) | core | M |
| Tribute / memorial / honor flag with ack-to recipient | core | S |
| Split designation (one gift → multiple funds) | core | S |
| Soft-credit allocation override | core | S |
| Pledge payment application (apply this gift to that pledge installment) | core | M |

### 4.2 Receipting & tax compliance

Every foundation needs audit-proof receipts. Fund-Raise has none of this.

- **Automated tax receipts** on every gift, sent via email + optional PDF archive.
- **Receipt numbering** sequential per fiscal year (CRA requirement in Canada).
- **CRA-compliant charitable receipts** (T3010 compatible): charity name, BN/RR, receipt number, date issued, gift date, gift value, eligible amount, donor name and address, signature, CRA website, "Official receipt for income tax purposes", advantage disclosure for split receipts.
- **IRS-compliant US acknowledgment** per §170(f)(8): charity name, EIN, gift date, gift amount, "no goods or services provided" or description of goods/services.
- **Split receipts** (event tickets: FMV – advantage = eligible amount).
- **Year-end consolidated tax summary** — aggregated PDF per donor.
- **Receipt reissue / void / correction** workflow with proper audit log.
- **Multi-language receipts** (EN/FR for Canadian charities).
- **Custom branded receipt templates** per tenant with logo + signature.

Example competitors that ship this: CanadaHelps, CharityVillage, DonorPerfect, Sumac, Virtuous (US), RE NXT, Bloomerang (US), Neon One, Keela (US+CA).

### 4.3 Payment reconciliation & GL

- **QuickBooks / Xero / Sage Intacct / NetSuite integration** — daily gift export with GL coding.
- **Deposit slip / batch reconciliation** — gifts batched for bank deposit, match to statement.
- **Refund / chargeback handling** through payment processor with GL impact.
- **Fund allocation rules** — "if gift code = ANNUAL, post to GL 4010; if fund = CAPITAL, split 80/20 between 4020/4021."
- **Fee tracking** (processor fees net of gross gift).
- **Reconciliation report** for auditors.

### 4.4 Gift agreement management

For major / planned / capital gifts:

- Gift agreement template library.
- Pledge agreement with installment schedule, restrictions, naming-right language.
- DocuSign / Adobe Sign integration for signature.
- Naming opportunity tracker (which space/chair/scholarship is promised to whom, for how long).

### 4.5 Anti-fraud / compliance

- **OFAC / sanctions screening** on new donors (nonprofits accepting > $10K often need this).
- **PEP (Politically Exposed Person) screening.**
- **Duplicate detection** with merge review queue (data-quality dashboard flags candidates; no workflow to merge).
- **Anonymous-gift handling** with proper reporting masking.

---

## 5. Online giving & donation forms

This is the single highest-ROI feature category Fund-Raise is missing if you want to become a primary platform. Every new-wave competitor (Givebutter, Classy, Keela, Bloomerang, Virtuous, Neon One, DonorPerfect, Bonterra) ships donation forms as a first-class product.

### 5.1 Donation forms & checkout

| Gap | Scope | Effort |
|-----|-------|--------|
| Hosted donation page per tenant | core | M |
| Embeddable donation widget (JS + iframe) | core | M |
| Mobile-optimized checkout | core | M |
| One-time + recurring (monthly, weekly, annual) toggle | core | M |
| Suggested-amount buttons + "other" | core | S |
| Cover-the-fee toggle | core | S |
| Fund / designation picker | core | S |
| Tribute / honor / memorial mode | core | S |
| In-honor-of notification email to honoree | core | S |
| Matching-gift lookup (Double the Donation / 360MatchPro) | core | S |
| Employer-match auto-complete | core | S |
| Payment methods: credit/debit, ACH, Apple Pay, Google Pay, PayPal, Venmo, bank transfer, crypto (Giving Block), DAF (DAFpay/Chariot) | core | L |
| Multi-currency donation | enterprise | M |
| 3DS/SCA compliance for EU donors | enterprise | S |
| Recurring donor portal (update card, cancel, change amount, skip a month) | core | M |
| Donor receipt + welcome email sequence | core | S |
| Confetti / celebration animation + social share buttons | companion | S |
| Campaign progress thermometer + top-donor wall | companion | S |
| UTM / source / referrer capture into gift record | core | S |
| A/B testing for ask amounts / form layout | companion | M |
| Abandoned-cart recovery email | companion | M |

### 5.2 Payment processor integrations

Fund-Raise has **no payment processor integration at all**. For any form/checkout:

- **Stripe** (Stripe Connect for charity-specific rates).
- **PayPal Giving Fund** (zero fees for nonprofits).
- **Braintree**, **Authorize.Net**, **Square**.
- **Bambora / Moneris** for Canadian processors.
- **ACH / EFT** via Plaid / Stripe ACH.
- **Apple Pay / Google Pay** via Stripe.
- **The Giving Block** for crypto.
- **Chariot / DAFpay** for DAF-to-charity flow.
- **GiveCampus** for higher-ed specific.

### 5.3 Giving Day / campaign microsites

- Giving day mini-site with branded URL (`yourorg.fund-raise.ca/givingday2026`).
- Live leaderboard (by team, by hour, by fundraiser).
- Matching-gift unlock mechanics (challenge gifts).
- Stretch goal reveals.
- Social-share autogenerated images.
- Text-to-give (Twilio integration).
- Day-of board (real-time donations feed for event wall).

### 5.4 Peer-to-peer fundraising

- Individual fundraiser pages within a campaign.
- Team pages with team leaderboard.
- Training / resource emails to P2P fundraisers.
- Social share with pre-written copy.
- Fundraiser dashboard (my page, my donors, my total).

Competitors: Classy, Givebutter, Donorbox, OneCause, Qgiv, GoFundMe Charity.

### 5.5 Text-to-give / SMS giving

- Short-code or keyword-based SMS gift.
- "GIVE50 to 12345" → SMS reply with link → hosted form.
- Twilio or Tatango integration.

### 5.6 Crowdfunding / tribute pages

- Donor-created tribute pages (Mom ran the marathon — support her).
- Memorial pages for deceased loved ones.
- Wedding / birthday fundraising pages.

---

## 6. Pledges, recurring, planned giving

### 6.1 Pledges

Fund-Raise **explicitly excludes pledges** from materialized views (`EXCLUDE_PLEDGE_SQL`). This is the right call for current reports (don't double-count committed + paid) but it means pledges aren't a first-class feature at all.

| Gap | Scope | Effort |
|-----|-------|--------|
| Pledge record with installment schedule | core | M |
| Pledge-vs-actual tracking | core | S |
| Pledge aging (30/60/90+ day overdue) | core | S |
| Pledge write-off workflow | core | S |
| Automated installment reminder emails | core | M |
| Automated recurring credit-card billing for pledges | core | M |
| Pledge balance forecast by fiscal year | core | M |
| Capital campaign pipeline (pledges by phase) | enterprise | M |

### 6.2 Recurring giving

Fund-Raise infers recurring donors from gift patterns; there's no actual subscription management.

| Gap | Scope | Effort |
|-----|-------|--------|
| Recurring gift record with amount + frequency + next-run date | core | M |
| Card-on-file vault via Stripe Customer | core | M |
| Sustainer upgrade path ("go from $25/mo to $35/mo") | core | S |
| Failed-payment dunning (3–5 retry sequence) | core | M |
| Update-card-link email before expiration | core | S |
| Sustainer-only landing page (skip the pitch, straight to checkout) | companion | S |
| Sustainer conversion widgets on thank-you page ("Become a Monthly Donor") | companion | S |
| Recurring-gift anniversary acknowledgment | companion | S |
| Lapsed-sustainer automated re-engagement | core | M |
| Sustainer cohort retention chart | companion | S |

### 6.3 Planned / legacy giving

For legacy-gift tracking (TBRHSF-style healthcare foundations have significant bequest pipelines):

| Gap | Scope | Effort |
|-----|-------|--------|
| Expectancy record (confirmed bequest, gift type, value range, revocable y/n) | core | M |
| Intention form (donor declares intent) | core | S |
| Estate tracking (open estate, executor, attorney, expected distribution) | core | M |
| Life-income vehicle tracking (charitable gift annuity, charitable remainder trust) | enterprise | L |
| Planned-giving calculator widget (annuity rate lookup) | enterprise | M |
| Bequest language library (sample wording for wills) | companion | S |
| Will-planning tool integration (FreeWill, Daffy, Giving Docs) | companion | S |
| Bequest pipeline dashboard (projected revenue by year) | core | M |

---

## 7. Prospect research, moves management, major gifts

This is the highest-value workflow in any shop raising >$5M/year. Fund-Raise has **none of it**.

### 7.1 Prospect research

| Gap | Scope | Effort |
|-----|-------|--------|
| Wealth screening integration (WealthEngine, iWave, DonorSearch, Windfall, Altrata) | enterprise | M |
| Bulk screen-all-constituents job with rating refresh | enterprise | M |
| Individual profile enrichment lookup | enterprise | S |
| Prospect research report (capacity, affinity, philanthropic giving, public-company stock, real-estate, board roles) | enterprise | M |
| News / social feed per donor (tracking signals) | enterprise | M |
| Peer-network discovery (people similar to your top donors) | enterprise | L |
| Foundation grant history lookup (Foundation Directory Online / Candid integration) | core (grants shops) | M |

### 7.2 Moves management

| Gap | Scope | Effort |
|-----|-------|--------|
| Opportunity / Proposal record with stage pipeline | core | M |
| Kanban / pipeline view by fundraiser | core | M |
| Weighted pipeline forecast ($ × probability × weighted-by-stage) | core | M |
| Cultivation plan template (touch cadence, suggested actions) | core | M |
| Stewardship plan template | companion | M |
| Solicitation strategy document attached to proposal | core | S |
| Win / close-won reason tracking | core | S |
| Loss / close-lost reason tracking + revive-date | core | S |
| "Next touch due" reminder per portfolio donor | core | M |
| Contact-cadence rules (major donors = every 45 days, annual = yearly) | core | M |
| Moves-management Gantt / timeline by donor | companion | M |

### 7.3 Campaign / gift-table planning

- **Gift-table construction** (pyramid): "To raise $10M, we need 1 gift at $2M, 3 gifts at $1M, 6 gifts at $500K..." — every capital campaign requires this.
- **Prospect-to-gift-table matching** — overlay prospects against the table.
- **Campaign phase tracking** (quiet / public / wrap-up) with phase goals.
- **Naming-opportunity inventory** — spaces, chairs, scholarships with price and status.
- **Feasibility study tooling** — pre-campaign survey capture.

### 7.4 Major donor briefing

Already partially covered by Meeting Prep tool, but lacks:

- **One-click AI donor brief** from anywhere in the app ("Prep me for meeting with Mrs. Kim tomorrow").
- **Print-ready briefing packet** — profile + giving history + recent interactions + AI-generated talking points + ask recommendation.
- **Pre-meeting email to the fundraiser** (night before) with briefing attached.
- **Post-meeting contact-report template** that Claude pre-fills from the briefing.

---

## 8. Grants & grant management

For foundations that both give and receive grants (common in healthcare, community foundations, arts).

| Gap | Scope | Effort |
|-----|-------|--------|
| Grant pipeline (funder, program, amount, deadline, status) | core | M |
| Application calendar with deadline alerts | core | S |
| LOI → full-proposal workflow | core | M |
| Grant budget + narrative + attachments | core | M |
| Multi-reviewer approval flow | core | M |
| Reporting deadline tracker (interim reports, final reports) | core | M |
| Funder-specific requirements library | companion | M |
| Grant-writer AI assistant (draft LOIs, budgets, narratives) | companion | M |
| Foundation directory integration (Candid / Foundation Directory Online / Instrumentl) | core | M |
| Award letter & contract storage | core | S |
| Grant disbursement schedule | core | S |

Competitors: Submittable, Fluxx, Instrumentl, GrantHub, Foundant GLM.

---

## 9. Events, P2P, auctions

Completely absent from Fund-Raise today. These are entire product categories.

### 9.1 Event management

| Gap | Scope | Effort |
|-----|-------|--------|
| Event record (date, venue, capacity, theme) | core | M |
| Online registration form with ticket types | core | M |
| Ticket pricing with tax-advantage split (FMV vs. charitable portion) | core | M |
| Seating / table assignment | core | M |
| Sponsor / sponsorship-level tracking | core | M |
| Guest list with check-in (QR code scan) | core | M |
| Event communications (save-the-date, invitation, reminder, thank-you) | core | M |
| Post-event receipting with split-value calculation | core | S |
| Event dashboard (registered, checked-in, raised, sponsor-progress) | core | S |
| Net-revenue vs. expense tracking (event P&L) | core | M |
| Multi-venue, multi-session support | enterprise | L |

### 9.2 Auction platform

| Gap | Scope | Effort |
|-----|-------|--------|
| Silent / live auction item catalog | core | M |
| Mobile bidding with SMS outbid alerts | core | M |
| Bid-sheet printing for paper auctions | core | S |
| Auction-close and winner notification | core | S |
| Paddle-raise / fund-a-need live entry | core | S |
| Text-to-bid integration | core | M |

### 9.3 Golf / gala / specialty events

- Golf tournament: team/player, handicap, hole assignment, sponsor holes, scorecards.
- Gala: head table, photo check-in, raffle integration.
- 5K / walk / ride: P2P leaderboard, fundraising minimums.

Competitors: OneCause, Qgiv, Givebutter, Handbid, Greater Giving, ClickBid, GalaBid.

---

## 10. Communications & marketing automation

This is the category where Fund-Raise has the biggest surface area of competing products. Most nonprofits use Mailchimp, Constant Contact, or Emma *separately* from their CRM — Fund-Raise could eat that spend with native sends.

### 10.1 Email marketing

| Gap | Scope | Effort |
|-----|-------|--------|
| HTML drag-and-drop email builder | core | L |
| Template library with tenant branding | core | M |
| Merge fields (first name, last gift amount, giving level) | core | M |
| Send-to-segment (any filter from dashboards becomes a list) | core | M |
| Schedule send (send later, timezone-aware) | core | S |
| A/B subject-line + preview-text testing | companion | M |
| Recurring / series campaigns | core | M |
| Transactional (receipt, thank-you, reminder) with deliverability separation | core | M |
| Bounce / complaint / unsubscribe handling | core | M |
| List hygiene (auto-suppress hard bounces, role addresses) | core | S |
| CAN-SPAM / CASL compliance footer auto-inject | core | S |
| Open / click tracking back to donor record | core | M |
| Engagement dashboard (open rate by segment, click heatmap) | core | M |
| Deliverability panel (spam scoring, DMARC / DKIM / SPF check) | enterprise | M |
| Dedicated IP / subdomain warmup | enterprise | M |
| Sunset policy (auto-stop emailing unengaged donors) | companion | S |

### 10.2 Journey / automation

"Responsive fundraising" / "donor journey" — Virtuous built a whole company on this.

| Gap | Scope | Effort |
|-----|-------|--------|
| Visual journey builder (trigger → branch → delay → action) | core | XL |
| Triggers: first gift, upgrade, lapse, birthday, milestone, survey response | core | L |
| Actions: send email, create action, tag donor, add to segment, slack notify | core | L |
| Delay / wait steps with timezone awareness | core | M |
| Branch logic (did they open? did they give again?) | core | M |
| A/B branch split for experiments | companion | M |
| Goal tracking per journey (conversion %) | core | M |
| Lapsed-donor re-engagement sequence template | core | S |
| New-donor welcome sequence template | core | S |
| Recurring-donor stewardship sequence | core | S |
| Major-donor cultivation cadence | core | S |

### 10.3 SMS / text

| Gap | Scope | Effort |
|-----|-------|--------|
| Twilio integration | core | M |
| SMS broadcast to segment | core | M |
| Text-to-give short code | core | M |
| Two-way SMS inbox per donor | companion | M |
| Keyword auto-responders | companion | S |

### 10.4 Direct mail (see §11 for full breakdown)

### 10.5 Template & asset library

- Reusable templates for email / letters / social with version control.
- Brand-asset library (logo, photos, video, approved headshots).
- Asset tagging + search.
- Shared team template library vs. personal.

### 10.6 Sent-communications history

Every interaction with every donor, searchable:

- "Show me every email Mrs. Kim received in the last year."
- "Who has NOT been emailed in 6 months?"
- "Suppress anyone who got the fall appeal from this year-end send."

Today, none of this exists in Fund-Raise.

---

## 11. Direct mail workflow

RE NXT users spend hours exporting to Excel, running mail merge in Word, uploading to mail house. Fund-Raise could own this workflow.

| Gap | Scope | Effort |
|-----|-------|--------|
| List builder with saved / named lists | core | M |
| Query-to-mailing-list pipeline (any dashboard filter → mailing list) | core | M |
| Salutation / addressee templating with fall-back rules | core | S |
| Mail merge to Word / PDF with branded letterhead | core | M |
| Envelope / label printing (Avery 5160, #10 envelope, etc.) | core | S |
| Address standardization + NCOA (CanadaPost AMS / USPS CASS) | core (large mailings) | M |
| Deceased suppression (DSF / MAT) | enterprise | M |
| Postal barcode / postal-bin sort | enterprise | M |
| Data-export file for mail house (Cheshire, NDSL, PostalOne) | core | S |
| Ask-string / personalized gift-amount insertion ("based on your last gift of $X, consider $Y") | companion | S |
| Mail-piece cost tracking + response-rate reporting | core | M |
| Seed / decoy list (your director + auditors get a copy) | companion | S |
| Version / segment splits (e.g., LYBUNT copy vs. SYBUNT copy) | core | S |
| Mailing archive (PDF of what was sent, who got it) | core | S |

---

## 12. Volunteer & membership management

### 12.1 Volunteer management

| Gap | Scope | Effort |
|-----|-------|--------|
| Volunteer record with skills, availability, certifications | core (some shops) | M |
| Hour tracking with timesheet approval | core | M |
| Background-check status + expiration | core | S |
| Shift / assignment scheduling | core | M |
| Volunteer event sign-up form | core | M |
| Volunteer-hour reporting (for CRA / IRS volunteer letters, not receipts) | core | S |
| Volunteer-to-donor conversion tracking | companion | S |

Competitors: Better Impact, GalaxyDigital, Point, VolunteerMatters, Timecounts.

### 12.2 Membership management

Required for museums, public broadcasters, professional associations, zoos, arts orgs.

| Gap | Scope | Effort |
|-----|-------|--------|
| Membership tiers (Basic, Family, Supporter, Patron, Lifetime) | core | M |
| Auto-renewal with card-on-file | core | M |
| Membership card (digital + printable) | core | S |
| Benefits tracker (admissions, discounts, invites) | core | M |
| Member portal (self-service renewal, update info) | core | M |
| Lapsed-member re-join campaigns | core | S |
| Family / household membership linkage | core | M |

Competitors: MemberClicks, Neon Membership, WildApricot, YourMembership, Personify.

---

## 13. Reporting & BI depth

Fund-Raise's 30+ dashboards are its strength. But top-tier BI and RE's power-user crowd expect workbench-level capability:

### 13.1 Self-service reporting

| Gap | Scope | Effort |
|-----|-------|--------|
| Custom report builder (drag-and-drop fields, filter, group, sort) | core | L |
| Saved reports / saved queries per user + shared team library | core | M |
| Report parameters (prompt user for FY, segment, min-amount at runtime) | core | M |
| Cross-tab / pivot-table view | core | M |
| Conditional formatting (highlight top donors in red) | companion | S |
| Report export in Excel with preserved formulas / formatting | companion | M |
| Report scheduling (run weekly, email CSV/PDF to distribution list) | core | M |
| Report subscription (user subscribes, gets emailed any time report changes) | companion | M |
| Ad-hoc query against constituent + gift + action + note | core | L |
| "Save as list" — query result becomes a mailing list / segment | core | M |

### 13.2 Dashboard customization

| Gap | Scope | Effort |
|-----|-------|--------|
| User-configurable dashboard (drag to reorder, hide widgets, resize) | core | L |
| Multiple dashboards per user (Executive / My Portfolio / Board View) | core | L |
| Widget library (KPI tile, trend chart, pie, bar, table, map) | core | L |
| "Add this chart to my dashboard" from any analytics page | core | M |
| Role-based default dashboard (Gift Officer vs. Exec vs. Board) | core | M |
| Dashboard sharing with read-only URL | companion | M |
| Dashboard templating for new users | companion | S |

### 13.3 Advanced analytics

| Gap | Scope | Effort |
|-----|-------|--------|
| Cohort retention curves by acquisition year (visual cohort grid) | core | M |
| Multi-touch attribution across channels | enterprise | L |
| Donor journey Sankey / funnel | enterprise | M |
| RFV (Recency, Frequency, Value) 3-D scoring visual | companion | S |
| Predictive donor churn ML model | enterprise | L |
| Next-best-gift-amount ML model | enterprise | L |
| Capacity-to-give ML model | enterprise | L |
| Anomaly detection on *per-donor* not just portfolio-level | companion | M |
| What-if scenario chaining (if retention up 5% AND avg gift up 10%, revenue = X) | companion | M |
| Goal forecasting w/ Monte Carlo / confidence bands | companion | M |
| Time-series forecasting (ARIMA / Prophet) for revenue projection | companion | M |
| Correlation finder ("donors who gave to Fund X also gave to Campaign Y") | companion | M |

### 13.4 Benchmarks & peer comparison

| Gap | Scope | Effort |
|-----|-------|--------|
| Industry benchmark integration (FEP, M+R Benchmarks, GivingUSA) | companion | M |
| Peer benchmark by sector (healthcare foundations size-matched) | enterprise | M |
| Bloomerang-style per-metric benchmark panel on every dashboard | companion | S |

### 13.5 Export / delivery

| Gap | Scope | Effort |
|-----|-------|--------|
| Asynchronous export queue (click export → email link when ready, handles 100K rows) | core | M |
| Direct PostgreSQL read-only connection for customer's Power BI / Tableau / Looker | enterprise | M |
| REST API endpoint for data access | core | M |
| BigQuery / Snowflake / Redshift connector | enterprise | L |
| Parquet / Arrow export for data scientists | enterprise | M |
| Scheduled Google Sheets / OneDrive export | companion | M |

---

## 14. AI / intelligence gaps

Fund-Raise's AI is very strong on ad-hoc analytics + content generation. Here's what it doesn't yet do that SOTA nonprofit AI tools do.

### 14.1 Per-donor AI

| Gap | Scope | Effort |
|-----|-------|--------|
| One-click AI donor summary on every donor page | core | M |
| AI "next best action" per donor (call them, send stewardship, upgrade-ask, etc.) | core | M |
| AI-recommended ask amount with reasoning | core | M |
| AI-drafted personal email to this donor (pre-filled with history + recent gift) | core | M |
| AI-generated stewardship plan per major donor | companion | M |
| AI call-brief before meeting (summarize last 5 interactions + giving trends) | core | M |
| AI post-meeting contact-report auto-draft | core | M |

### 14.2 AI-driven automation

| Gap | Scope | Effort |
|-----|-------|--------|
| AI alert ("Mrs. Kim's giving has dropped 60% this year, recommend outreach") pushed to fundraiser | core | M |
| AI action-generation ("give me a list of 10 tasks for this week based on the data") → Action Centre | core | M |
| AI follow-up generation from a contact report ("I visited Mr. Smith" → create 3 follow-up tasks) | companion | S |
| AI weekly digest auto-send to team leaders | companion | S |
| AI gift-officer coaching (portfolio review narrative) | companion | M |

### 14.3 AI content

| Gap | Scope | Effort |
|-----|-------|--------|
| AI grant-writing assistant (LOI, narrative, budget justification) | core (grants shops) | M |
| AI proposal / case-for-support generator | companion | M |
| AI social-media post from a gift announcement | companion | S |
| AI newsletter draft from the fiscal month | companion | M |
| AI board-report narrative (currently produces PDF with static tables — add AI commentary) | companion | M |
| AI voice-to-contact-report (phone dictation → structured log) | companion | M |
| AI impact-report generator per donor ("Your $X gift this year funded...") | companion | M |

### 14.4 AI search / knowledge

| Gap | Scope | Effort |
|-----|-------|--------|
| Embedding search over donor notes / contact reports / uploaded documents | core | M |
| AI policy / org-knowledge base ("what's our DAF acknowledgment policy?") | companion | M |
| AI document Q&A over a proposal / grant report PDF | companion | M |
| AI over email (Gmail / Outlook plug-in: read thread, log it, summarize) | companion | L |

### 14.5 AI governance

| Gap | Scope | Effort |
|-----|-------|--------|
| Per-tenant AI usage dashboard with cost control | core | M |
| Per-user AI rate limit + spending cap | core | S |
| Prompt template management (tenant-level) | companion | M |
| Human-in-the-loop approval for AI-sent emails | core | M |
| AI output audit log (what did it say, who asked, did they use it) | core | M |
| PII redaction in AI logs for compliance | enterprise | M |
| BYOK — bring-your-own Anthropic/OpenAI/Azure key | enterprise | M |
| Model choice per feature (cheap Haiku for titles, Opus for deep dive) — already partial | companion | S |

---

## 15. Integrations catalog

Fund-Raise has exactly **two external integrations**: Google OAuth and Blackbaud SKY API. Every major nonprofit CRM has 30–3000+ pre-built integrations. This is the single biggest strategic gap because it's the most visible one in a sales demo.

### 15.1 Payment / giving

| Integration | Purpose | Competitor parity |
|-------------|---------|-------------------|
| **Stripe / Stripe Connect** | cards, ACH, Apple/Google Pay, recurring | all modern CRMs |
| **PayPal / PayPal Giving Fund** | zero-fee nonprofit processing | all |
| **Braintree, Authorize.Net, Square** | alternate processors | most |
| **Bambora / Moneris / Chase Paymentech** | Canadian processors | Keela, Sumac |
| **Plaid** | ACH bank-account verification | Givebutter, Classy |
| **The Giving Block** | crypto | Classy, Bonterra |
| **Chariot / DAFpay / Daffy** | donor-advised-fund giving | Bloomerang, Virtuous |
| **FreeWill / Giving Docs** | estate / bequest intake | Bloomerang |

### 15.2 Marketing / communications

| Integration | Purpose |
|-------------|---------|
| **Mailchimp, Constant Contact, Emma, Campaign Monitor, HubSpot, Klaviyo, ActiveCampaign** | email marketing |
| **SendGrid, Mailgun, Postmark, Amazon SES** | transactional email infra |
| **Twilio, Plivo, Bandwidth** | SMS |
| **Vidyard, Bonjoro, Loom** | personalized video |
| **Canva, Unlayer** | design / template building |

### 15.3 Productivity / workspace

| Integration | Purpose |
|-------------|---------|
| **Google Workspace (Calendar, Drive, Docs, Gmail)** | mail, file, calendar |
| **Microsoft 365 (Outlook, OneDrive, Teams, SharePoint)** | same, enterprise side |
| **Slack** | team notifications, @mentions, daily digest delivery |
| **Notion, Coda, Confluence** | documentation |
| **Zoom, Google Meet, Microsoft Teams** | donor meetings, recording |
| **Calendly, Cal.com** | scheduling |
| **DocuSign, Adobe Sign, Dropbox Sign** | gift agreements, NDAs |
| **Otter, Fathom, Fireflies** | meeting transcription → contact report |

### 15.4 Finance / accounting

| Integration | Purpose |
|-------------|---------|
| **QuickBooks Online / Desktop** | daily gift export |
| **Xero** | UK/AU/CA market |
| **Sage Intacct** | enterprise nonprofit finance |
| **NetSuite** | enterprise |
| **Microsoft Dynamics GP/BC** | enterprise |
| **Oracle NetSuite, Workday** | very large nonprofits |

### 15.5 Wealth screening / research

| Integration | Purpose |
|-------------|---------|
| **WealthEngine** | capacity + affinity screening |
| **iWave** | PRI-Plus screening |
| **DonorSearch** | screening + modeling |
| **Windfall** | net-worth estimates |
| **Altrata / RelSci** | board/exec relationships |
| **Candid / Foundation Directory Online / Instrumentl** | foundation / grant research |
| **GuideStar / Charity Navigator API** | peer benchmarking |

### 15.6 Matching gifts / engagement

| Integration | Purpose |
|-------------|---------|
| **Double the Donation / 360MatchPro** | matching-gift lookup |
| **HEPdata** | matching-gift DB |
| **GiveGab / Mightycause** | giving-day platforms |
| **Benevity** | employee-giving / match portal |

### 15.7 Data quality / enrichment

| Integration | Purpose |
|-------------|---------|
| **Clearbit, FullContact** | email / domain enrichment |
| **Smarty, Google Address Validation, Canada Post AMS, USPS CASS** | address standardization |
| **NCOA / DSF / MAT** | move tracking + deceased suppression |
| **FreshAddress** | email validation |
| **Melissa, Experian** | identity / contact data |
| **LocAlert** | deceased identification |

### 15.8 Identity / security / SSO

| Integration | Purpose |
|-------------|---------|
| **Okta, Azure AD / Entra, OneLogin, Auth0, Ping, JumpCloud** | SAML/OIDC SSO |
| **Google Workspace SSO** | currently only Google OAuth, not Workspace SSO with provisioning |
| **SCIM** | auto-provision / deprovision users |
| **Duo / Authy / Yubikey** | MFA |

### 15.9 Events / fundraising tools

| Integration | Purpose |
|-------------|---------|
| **OneCause, Qgiv, Handbid, ClickBid, Greater Giving, Givebutter** | auction + event platforms |
| **Eventbrite, Cvent, Swoogo** | event registration |
| **TripleSeat, Tripleseat, Social Tables** | venue management |

### 15.10 Workflow / automation

| Integration | Purpose |
|-------------|---------|
| **Zapier, Make (Integromat), n8n, Workato, Tray.io** | iPaaS |
| **Power Automate, Nintex** | enterprise workflow |
| **Airtable, Smartsheet, Monday** | lightweight PM |

### 15.11 Analytics / BI passthrough

| Integration | Purpose |
|-------------|---------|
| **Power BI, Tableau, Looker, Metabase, Mode** | external BI |
| **Segment, RudderStack, Snowplow** | CDP |
| **BigQuery, Snowflake, Redshift, Databricks** | data warehouse |
| **dbt, Fivetran, Airbyte** | ELT |

### 15.12 Vertical-specific

| Integration | Purpose |
|-------------|---------|
| **EpicCare / Cerner / Meditech** | grateful-patient (healthcare) |
| **Banner / Ellucian / PeopleSoft** | higher-ed SIS |
| **Salesforce NPSP / Education Cloud** | cross-CRM sync |
| **Microsoft Fundraising & Engagement** | cross-platform |

### 15.13 Specialist nonprofits

| Integration | Purpose |
|-------------|---------|
| **RE NXT** | already done |
| **DonorPerfect, Bloomerang, Virtuous, Little Green Light, NeonCRM** | migration / cross-platform sync |
| **Causeview, Engaging Networks, EveryAction** | advocacy |
| **Change.org, Action Network, NationBuilder** | advocacy / movement |

**Recommendation:** Build a public REST API + webhooks *first* (§20) so Zapier/Make can cover 70% of this list with minimal direct engineering. Then build 5–10 native integrations for the highest-leverage vendors (Stripe, Mailchimp, QuickBooks, Zoom, Slack, Google Workspace, Microsoft 365, Okta, DocuSign, Double the Donation).

---

## 16. Security, compliance, enterprise readiness

Fund-Raise has sensible baseline security (RLS, CSRF, token encryption, Helmet, rate-limited login). Enterprise buyers need more.

### 16.1 Authentication

| Gap | Scope | Effort |
|-----|-------|--------|
| Email + password auth fallback (for users who don't want Google login) | core | S |
| Magic-link / passkey / WebAuthn sign-in | companion | M |
| MFA / 2FA (TOTP, SMS, security key) | core | M |
| SAML 2.0 / OIDC SSO (Okta, Azure AD, OneLogin) | enterprise | M |
| SCIM 2.0 for user provisioning / deprovisioning | enterprise | M |
| Domain-verified auto-join (e.g., anyone @ourorg.com auto-joins tenant) | companion | S |
| Session list + revoke ("sign me out everywhere") | core | S |
| Idle timeout with org-level policy | core | S |
| IP allow-list per tenant | enterprise | M |
| Device trust / known-device tracking | enterprise | M |

### 16.2 Authorization / RBAC

Today: 3 roles (admin, uploader, viewer). Per-tenant role granularity is limited.

| Gap | Scope | Effort |
|-----|-------|--------|
| Custom role builder (permission matrix: which features × which actions) | enterprise | L |
| Record-level sharing / portfolio access (Gift Officer A only sees their 150 donors) | enterprise | L |
| Field-level masking (hide SSN / DOB / wealth fields unless role has permission) | enterprise | M |
| Department-based permissions (Annual Giving team can't see Major Gifts donors) | core | M |
| Temporary / time-boxed access (consultant gets 30-day read-only) | enterprise | M |
| "Act as" / impersonation for support (with audit trail) | enterprise | M |
| Approval workflow (role-based approve/reject for critical actions) | enterprise | L |

### 16.3 Audit & compliance

Audit log *model* exists; there is no UI and many mutations are not captured.

| Gap | Scope | Effort |
|-----|-------|--------|
| Audit log viewer UI with search / filter / export | core | M |
| Coverage sweep: ensure every mutation writes to audit log | core | M |
| Change tracking ("who changed this donor's address?") with before/after diff | core | M |
| Data-access logging ("who viewed Mrs. Kim's profile?") | enterprise | M |
| Export of user activity for SOC 2 audits | enterprise | M |
| Consent ledger (immutable opt-in / opt-out history) | core | M |
| Right-to-be-forgotten workflow (GDPR/CCPA/PIPEDA erasure request) | core | M |
| Data-subject access request (DSAR) — "give me everything you have on me" export | core | M |
| Retention / purge policies per tenant (auto-delete actions >3 yrs old) | enterprise | M |
| Field-level encryption for sensitive PII (SIN/SSN/DOB) | enterprise | M |
| Per-tenant encryption keys / BYOK | enterprise | L |
| Immutable backups (WORM / object-lock) | enterprise | M |
| Tenant-level data export (bulk download of all their data) | core | M |
| Tenant-level data deletion on churn | core | S |

### 16.4 Certifications / attestations (for enterprise sales)

| Certification | Scope |
|---------------|-------|
| **SOC 2 Type II** | Needed for healthcare, higher-ed, any >$10M shop |
| **ISO 27001** | Enterprise / international |
| **HIPAA + BAA** | Healthcare foundations (TBRHSF is one!) |
| **PCI-DSS SAQ** | Once payments land |
| **GDPR** | EU donors |
| **PIPEDA** | Canadian donors |
| **CCPA / CPRA** | California donors |
| **FERPA** | Higher-ed alumni data |
| **WCAG 2.1 AA** | Public sector / higher-ed procurement |
| **Section 508** | US federal |

Today: no formal compliance posture published.

### 16.5 Data security

| Gap | Scope | Effort |
|-----|-------|--------|
| Encrypted file uploads (avatars, logos currently on local disk — should be S3 + server-side encryption) | core | M |
| Virus scanning on uploads (ClamAV / VirusTotal) | core | S |
| File-type / content validation beyond extension | core | S |
| Signed URL download for attachments | core | S |
| Secrets management (HashiCorp Vault / AWS Secrets Manager / Render Secrets) | core | S |
| Dependency scanning (Snyk / Dependabot / npm audit in CI) | core | S |
| SAST / DAST (GitHub Advanced Security / Snyk Code / Semgrep) | core | M |
| Pen-test on an annual cadence | enterprise | (external) |
| Bug bounty program | enterprise | (external) |

### 16.6 DR / business continuity

| Gap | Scope | Effort |
|-----|-------|--------|
| Automated nightly backup with point-in-time recovery | core | S |
| Cross-region replica | enterprise | M |
| Documented RPO / RTO | enterprise | S |
| Backup restore runbook + drills | core | M |
| Tenant-level snapshot / restore | enterprise | M |

---

## 17. Admin, billing, multi-tenant ops

Critical for running a real SaaS; almost entirely missing.

### 17.1 Billing & subscription

| Gap | Scope | Effort |
|-----|-------|--------|
| Stripe Billing / Chargebee / Paddle integration | core | M |
| Subscription plans (Starter / Pro / Enterprise) with feature gating | core | M |
| Per-seat pricing + seat management | core | M |
| Usage metering (AI calls, storage, gifts/records, API calls) | core | M |
| Self-service upgrade / downgrade | core | M |
| Self-service cancel / pause | core | S |
| Trial period with expiration | core | S |
| Dunning (failed-payment retry sequence) | core | M |
| Proration + mid-cycle changes | core | M |
| Invoice history + PDF | core | S |
| Tax collection (Stripe Tax / TaxJar) | core (US/EU) | M |
| Annual vs monthly billing | core | S |
| Coupon / referral codes | companion | S |
| In-app billing portal | core | M |
| Chargeback / refund handling | core | M |
| Revenue reporting (MRR, ARR, churn, NRR) | companion | M |
| Stripe Customer Portal integration | core | S |

### 17.2 Super-admin / ops console

| Gap | Scope | Effort |
|-----|-------|--------|
| Internal tenant health dashboard (records, storage, last activity, MRR tier) | core | M |
| Support impersonation ("log in as tenant admin to reproduce a bug") with audit | core | M |
| Per-tenant feature-flag toggle UI | core | S |
| Usage + quota dashboard per tenant | core | M |
| Tenant suspend / freeze workflow | core | S |
| Tenant tombstone + data retention after cancel | core | M |
| Cross-tenant search (for support: "find donor John Smith across all tenants") | core | M |
| Error log drill-down per tenant | core | M |
| Manual data-fix tooling (e.g., re-run a failed import) | core | M |

### 17.3 Tenant switcher / multi-tenant consultant support

Consultants serve multiple nonprofits. Today, a user belongs to one tenant only.

- Consultant / agency accounts that can belong to N tenants.
- Tenant picker in the top nav for consultants.
- Billable-by-hour tracking per tenant for agencies.

### 17.4 Status / incident communication

- Public status page (status.fund-raise.ca).
- In-app banner for maintenance windows.
- Email notification for major outages.
- Postmortem publication.

### 17.5 Customer success / in-product signals

| Gap | Scope | Effort |
|-----|-------|--------|
| Product analytics (Amplitude, Mixpanel, PostHog) on feature usage | core | M |
| Adoption dashboard per tenant (did they use Ask Fund-Raise this month?) | core | M |
| NPS / CSAT in-app survey | companion | S |
| Churn-risk scoring (declining login frequency) | enterprise | M |
| Usage-based nudges ("You haven't uploaded data in 45 days") | core | S |
| Playbooks for CSMs | enterprise | M |

---

## 18. Quality-of-life & UX table stakes

These are the features users *expect* from any 2026 SaaS and don't forgive the absence of.

### 18.1 Navigation & discovery

| Gap | Scope | Effort | Example competitor |
|-----|-------|--------|-------------------|
| **Global command palette** (Cmd+K / Ctrl+K) — fuzzy search across donors, dashboards, actions, pages | core | M | Linear, Notion, Stripe, Mercury |
| **Universal search** — search donors, gifts, funds, campaigns, team, pages, notes | core | M | every SaaS |
| **Recently viewed** dropdown | companion | S | Notion, Google Docs |
| **Favorites / bookmarks** (pin a donor, a report, a dashboard) | core | S | RE NXT, Bloomerang |
| **Customizable sidebar** (pin, hide, reorder) | core | M | VS Code, Linear |
| **Breadcrumb nav** with last-visited | companion | S | |
| **Back button memory** (return to scroll position + filter state) | core | M | |
| **URL-first state** (filters in URL, shareable/bookmarkable) — partial today | core | M | |
| **Keyboard shortcuts** overlay (press ?) | companion | S | Linear, Gmail |

### 18.2 Notifications & real-time

| Gap | Scope | Effort |
|-----|-------|--------|
| In-app notification center (bell icon + dropdown) | core | M |
| Real-time notifications (WebSocket / SSE) for actions, mentions, comments | core | M |
| Email notification digest preferences | core | S |
| Push notifications (PWA + mobile) | companion | M |
| @mention users in actions / posts / notes | core | M |
| Mark-all-as-read, notification filters | core | S |
| Per-feature notification settings (email me about new actions but not kudos) | core | S |
| Browser notifications for long-running imports | companion | S |
| Slack notification per tenant | core | M |

### 18.3 Personalization

| Gap | Scope | Effort |
|-----|-------|--------|
| **Dark mode** | core | M |
| System / light / dark / auto preference | core | S |
| Custom brand accent color per tenant (logo → color) | companion | S |
| Font size preference | companion | S |
| Density (compact / comfortable / cozy) | companion | S |
| Date format preference (MM/DD vs DD/MM vs ISO) | core | S |
| Number format preference (1,000.00 vs 1.000,00) | core | S |
| Currency display (CAD / USD / EUR, with symbol) | core | S |
| Timezone preference per user | core | S |
| First-day-of-week preference | companion | S |

### 18.4 Collaboration primitives

| Gap | Scope | Effort |
|-----|-------|--------|
| @mentions across actions / notes / comments | core | M |
| Rich-text editor (bold, italic, lists, link) in notes / comments | core | M |
| Comment threads with reactions | companion | S |
| Shared / public view of a dashboard (read-only link for the board) | core | M |
| Real-time multi-user editing for notes / reports | companion | L |
| Activity feed ("X created this action", "Y uploaded data") | core | M |
| Presence indicators (who else is looking at this page) | companion | M |
| Draft / autosave | core | S |

### 18.5 Power-user features

| Gap | Scope | Effort |
|-----|-------|--------|
| Bulk actions (select 50 donors → tag all, email all, assign action all) | core | M |
| Saved filters / saved views on gift search + donor lists | core | M |
| Quick filters / chips on every list page | companion | S |
| Inline editing (click amount, change, save) | companion | M |
| Multi-select with shift-click | companion | S |
| Sort by any column | companion | S |
| Column chooser / reorder | companion | M |
| Kanban view for actions / proposals | core | M |
| Calendar view for actions with due dates | core | M |
| Gantt view for campaigns | companion | M |
| Drag-to-reschedule actions | companion | S |

### 18.6 Help / support / adoption

| Gap | Scope | Effort |
|-----|-------|--------|
| In-product help widget (Intercom / Crisp / Pylon) | core | M |
| Contextual tooltips on every chart / metric | core | M |
| Guided tour on first login (Product tour / Appcues / Pendo / UserFlow) | core | M |
| "What's new" in-app modal with badge | companion | S |
| Embedded video tutorials | companion | M |
| Searchable knowledge base | core | M |
| Live chat support or AI-answer-first support | core | M |
| In-app NPS / CSAT micro-surveys | companion | S |
| Feature-request / voting board (Canny / Productboard) | companion | M |
| Changelog RSS / email subscribe | companion | S |
| Onboarding checklist with progress bar | core | S |
| Sample / demo data mode ("Try with fake data") | core | M |

### 18.7 Forms / input

| Gap | Scope | Effort |
|-----|-------|--------|
| Autosave on long forms (writing assistant outputs, meeting-prep inputs) | core | S |
| Undo / redo | companion | M |
| Confirmation dialogs before destructive actions (currently partial) | core | S |
| Draft state across devices | companion | M |

### 18.8 Lists & tables

| Gap | Scope | Effort |
|-----|-------|--------|
| Virtualized scrolling for long lists (10K+ rows) | core | M |
| Cursor pagination (instead of offset) | core | M |
| Sticky header on scroll | companion | S |
| Resizable columns | companion | S |
| Export-visible-rows vs. export-all | companion | S |
| Print CSS (clean print layout for every dashboard) | companion | S |

### 18.9 Small niceties that add up

- Tooltip on every truncated string.
- Copy-to-clipboard button on IDs / emails / phone.
- Loading skeletons instead of spinners (partial today).
- Empty-state illustrations (partial).
- Optimistic UI updates.
- Retry / "try again" prompts on network errors.
- Debounced search inputs (300 ms typical).
- Auto-retry for flaky requests.
- Idempotent POSTs (avoid double-submit).
- 404 page with site-map suggestions.
- Status colors consistent across app (green = good, amber = at-risk, red = lost).

---

## 19. Mobile, accessibility, internationalization

### 19.1 Mobile / PWA

| Gap | Scope | Effort |
|-----|-------|--------|
| PWA manifest + service worker (currently just the HTML link) | core | M |
| Offline mode for dashboards (read-only last-cached data) | companion | M |
| Add-to-home-screen with splash | companion | S |
| Mobile-optimized nav (bottom tabs vs. sidebar) | core | M |
| Touch-friendly tap targets (44×44 px min) | core | S |
| iOS / Android native apps (or Capacitor / React Native wrapper) | companion | L |
| Mobile gift entry (for event check-in, on-site donations) | core | M |
| Mobile contact-report dictation (record → AI log) | companion | M |
| Apple Wallet / Google Wallet pass (membership cards) | companion (verticals) | M |
| Deep-linking from emails into specific donor / action pages | core | S |

### 19.2 Accessibility (WCAG 2.1 AA)

Procurement for public-sector orgs, universities, and government-funded healthcare requires WCAG audit.

| Gap | Scope | Effort |
|-----|-------|--------|
| WCAG 2.1 AA audit + remediation | core | L |
| Keyboard-only navigation pass across all screens | core | M |
| Screen-reader labels on every icon / button / chart | core | M |
| Color-contrast audit (light + dark mode) | core | M |
| Reduced-motion mode (respect `prefers-reduced-motion`) | companion | S |
| Focus ring visibility on all interactive elements | core | S |
| Skip-to-content link (partial today) | companion | done |
| Live-region announcements for async updates | companion | M |
| Chart accessibility (text alternatives, sonification for blind users) | companion | L |
| VPAT / ACR document for enterprise procurement | enterprise | M |
| Section 508 compliance statement | enterprise | S |

### 19.3 Internationalization

Single-language, single-currency today.

| Gap | Scope | Effort |
|-----|-------|--------|
| i18n framework (i18next or similar) | core | M |
| Locale strings extracted | core | L |
| French / Spanish / Canadian French translations | core (CA, US, EU) | M |
| RTL layout support (Arabic, Hebrew) | companion | M |
| Multi-currency with FX conversion | core | M |
| Timezone-aware date storage + display | core | M |
| Regional date / number formatting | core | S |

### 19.4 Mobile-specific fundraising

- **Event check-in app** — scan QR, record gift, print badge.
- **On-site auction paddle-raise** for mobile.
- **Mobile call-report** — fundraiser pulls donor record in the car, logs the visit.
- **Mobile briefing before a meeting** — the donor profile + AI brief collapsed onto a phone.

---

## 20. Developer platform & extensibility

Zero public API today. This is the single fastest way to 10× integration coverage without building each one yourself.

### 20.1 Public REST API

| Gap | Scope | Effort |
|-----|-------|--------|
| Versioned REST API (`/api/v1/...`) | core | L |
| Auth: API keys per tenant + scopes | core | M |
| OAuth 2.0 for third-party apps | enterprise | M |
| Rate limiting per key (Redis-backed) | core | M |
| OpenAPI 3.1 spec + Swagger UI | core | S |
| Interactive API playground | companion | M |
| SDKs (Node, Python, Ruby, PHP, .NET) | companion | M |
| Cursor-based pagination for all list endpoints | core | M |
| Idempotency keys on mutations | core | S |
| Partial response / field selection (GraphQL or `?fields=`) | companion | M |
| Expand / include related records in one call | companion | M |

### 20.2 Webhooks

| Gap | Scope | Effort |
|-----|-------|--------|
| Webhook subscription UI (event type + URL + secret) | core | M |
| Event types: gift.created, pledge.updated, donor.created, action.assigned, import.completed, anomaly.detected | core | M |
| HMAC-signed payloads | core | S |
| Retry with exponential backoff | core | S |
| Dead-letter queue for failed deliveries | core | M |
| Webhook debugger / replay | companion | M |

### 20.3 Embeddable components

- **Embed tiles** — put a thermometer or KPI on the org's marketing website.
- **Donate button widget** (once donation forms exist).
- **Donor portal widget** for the org's website.

### 20.4 Plugin / extension system

| Gap | Scope | Effort |
|-----|-------|--------|
| Custom fields on constituents / gifts | enterprise | L |
| Custom objects (for unusual entity types) | enterprise | XL |
| Custom tabs on donor page | enterprise | L |
| Per-tenant custom dashboards | core | L |
| Tenant-defined workflows (low-code) | enterprise | XL |
| Marketplace for 3rd-party apps | enterprise | XL |

### 20.5 Developer portal

- Documentation site (built with Mintlify / Scalar / Redocly).
- API-key management UI.
- Webhook configurator UI.
- Code examples per endpoint.
- "Try it now" playground.
- Changelog per API version.
- Deprecation notice system.

---

## 21. Observability & reliability

### 21.1 Runtime observability

| Gap | Scope | Effort |
|-----|-------|--------|
| Error tracking (Sentry, Rollbar, Bugsnag) | core | S |
| APM (Datadog, New Relic, Honeycomb) with tenant tag | core | M |
| Structured logging (pino / winston) with tenant/user/request IDs | core | M |
| Log aggregation (Logtail, Papertrail, Datadog Logs) | core | S |
| Custom metrics (Prometheus / Datadog StatsD) | core | M |
| Per-tenant SLI dashboards (latency, error rate, API usage) | enterprise | M |
| Uptime monitoring (Pingdom, UptimeRobot, BetterStack) | core | S |
| Synthetic canary tests | enterprise | M |
| Real-user monitoring (Datadog RUM / Sentry Performance) | companion | M |
| Distributed tracing (OpenTelemetry) | enterprise | M |

### 21.2 Reliability engineering

| Gap | Scope | Effort |
|-----|-------|--------|
| Horizontal autoscaling (cluster mode, multiple replicas) | core | M |
| Background job queue (BullMQ + Redis) for imports, MV refresh, AI calls, PDF gen | core | M |
| Redis for sessions + cache | core | M |
| Read replicas for analytics queries | core | M |
| Connection-pool bouncer (PgBouncer) | core | S |
| Graceful shutdown (SIGTERM handler) | core | S |
| Circuit breakers on external APIs (Blackbaud, Anthropic) — partial today | core | S |
| Feature-flag kill switches for every non-essential feature | core | M |
| Blue/green or canary deploys | core | M |
| Staging environment with prod-like data | core | M |

### 21.3 Testing / CI / CD

| Gap | Scope | Effort |
|-----|-------|--------|
| CI pipeline (GitHub Actions): lint, test, typecheck, audit, build | core | S |
| E2E tests (Playwright) covering critical flows | core | M |
| Visual regression tests (Chromatic / Percy) | companion | M |
| Contract tests (Pact) for external API consumers | enterprise | M |
| Load tests (k6 / Artillery) per release | core | S |
| Migration tests (run against copy of prod) | core | M |
| Chaos testing (kill pod, latency injection) | enterprise | M |
| Automated security scans (Snyk, Dependabot, OSV-Scanner) | core | S |
| Pre-commit hooks (lint-staged, husky) | companion | S |
| Code coverage gating | companion | S |

---

## 22. Vertical-specific gaps

Fund-Raise's anchor customer (TBRHSF) is a **healthcare foundation**. Healthcare, higher-ed, arts, and faith each have idiosyncratic needs competitors cater to.

### 22.1 Healthcare foundations (e.g., TBRHSF)

| Gap | Scope | Effort |
|-----|-------|--------|
| **Grateful Patient program** — caregiver referrals, patient encounter trigger, consent-aware workflow | core | L |
| EMR integration (Epic / Cerner / Meditech) with HIPAA BAA | enterprise | L |
| Clinician fundraising impact dashboard (physician referrals → gifts) | core | M |
| Patient privacy masking (PHI separated from donor record) | core | M |
| Tribute-gift workflow (in honor of a nurse, surgeon) with notification | core | S |
| Bioethics / research gift allocation (restricted fund compliance) | enterprise | M |
| Healthcare-specific fund library (Cardiology Unit, ICU Equipment, Cancer Research) | companion | S |
| Department-head reporting | core | S |
| HIPAA audit log + access controls | core | M |
| **Hospital giving-day microsite** (Radiothon, Telethon support) | companion | M |

### 22.2 Higher-education foundations

| Gap | Scope | Effort |
|-----|-------|--------|
| Alumni CRM concepts: class year, degree, school/college, major, affinity group, Greek life | core | M |
| Reunion giving tracker (5th / 10th / 25th / 50th) | core | M |
| Class-agent program (volunteer alumni calling peers) | core | M |
| Giving clubs / loyalty levels (25+ consecutive years) | core | S |
| Senior-class gift campaign | core | S |
| Athletics giving integration (booster clubs) | core | M |
| Scholarship / endowment fund tracking (named scholarships, spending rules) | core | M |
| Banner / Ellucian / Workday Student integration | enterprise | L |
| Constituent flag for parent / grandparent / friend / faculty / staff / student | core | S |
| Reunion table seating tool | companion | M |

### 22.3 Arts / museums / performing arts

| Gap | Scope | Effort |
|-----|-------|--------|
| Membership tiers with benefits (preview nights, discounts, invitations) | core | M |
| Ticketing integration (Tessitura, Spektrix, PatronManager) | enterprise | L |
| Subscriber management for seasons | core | M |
| Seat-reservation for major donors | companion | M |
| Gallery / exhibit naming opportunities | core | S |
| Gala / auction event kit | core | L |

### 22.4 Faith-based (churches, dioceses, seminaries)

| Gap | Scope | Effort |
|-----|-------|--------|
| Tithe / pledge tracking per family | core | M |
| Envelope number management | core | S |
| Family / parishioner record with children | core | M |
| Online tithing form with recurring default | core | M |
| Pastor briefing (similar to MGO brief) | core | S |
| Mass intention donations tracking | companion | S |
| Diocesan / parish roll-up reporting | core | M |

### 22.5 International / UK

| Gap | Scope | Effort |
|-----|-------|--------|
| Gift Aid (UK) capture + HMRC export | core | M |
| Payroll Giving processing | companion | M |
| Multi-currency ops | core | M |
| VAT handling on events | enterprise | M |
| EU GDPR cookie banner / consent | core | S |

### 22.6 Community foundations

| Gap | Scope | Effort |
|-----|-------|--------|
| Donor-advised fund administration (DAF-sponsor workflow) | core | L |
| Grantmaking pipeline (you are the grantor) | core | L |
| Scholarship-program administration | core | M |
| Fiscal sponsorship management | core | M |
| Field-of-interest / agency funds | core | M |

---

## 23. Priority matrix — what to build first

The universe above is huge. Here's how we'd sequence it, assuming the product positioning stays **"analytics + AI companion to Raiser's Edge NXT"**, then broadens over 18 months.

### Q1 (now) — unlock revenue with minimum surface

1. **Billing / Stripe subscription** (§17.1) — you can't monetize until this ships. `S` effort; the billing model is simple (per-seat + per-tenant add-ons).
2. **Custom report builder + saved reports + scheduled email delivery** (§13.1) — closes the #1 pain in forums ("I still have to export to Excel"). `M` effort but highest demo leverage.
3. **Dashboard customization + favorites + global search (Cmd+K)** (§13.2, §18.1) — keeps power users in the product. Visible polish.
4. **Notification center + @mentions + Slack integration** (§18.2) — team collaboration glue.
5. **Audit log UI + per-tenant usage dashboard** (§16.3, §17.2) — unblocks enterprise deals that ask for SOC 2 evidence.
6. **Dark mode, keyboard shortcuts, date/number/timezone prefs** (§18.3) — user-delight polish bundle.

### Q2 — build donor operations

7. **Data-model normalization** (§2.3 option 1) — create `constituents`, `households`, `proposals`, `contact_reports`, `pledges` tables. Unblocks everything below.
8. **Donor 360° view** (§3.3) with AI summary + timeline + engagement meter.
9. **Contact-report / interaction log** (§3.2) with voice dictation and email-thread capture.
10. **Portfolio management** (§3.4) — assignment records + "my donors" view + due-for-touch list.
11. **Moves-management pipeline** (§7.2) — Kanban of proposals with weighted forecast.
12. **Public REST API v1 + webhooks** (§20.1–20.2) — every future integration gets easier.

### Q3 — online giving + comms

13. **Donation forms + Stripe integration** (§5.1–5.2) — now Fund-Raise *processes* gifts.
14. **Recurring-gift subscription management** (§6.2) — monthly-donor portal, dunning, sustainer upgrade path.
15. **Email marketing** (§10.1) — native campaign sender with segment integration from dashboards.
16. **Donor journey automation** (§10.2) — at least lapsed, new-donor, recurring, and major-donor sequences.
17. **Direct-mail list builder + mail-merge export** (§11) — differentiator vs. RE's terrible workflow.
18. **Integrations: QuickBooks, Mailchimp, Zoom, Google Workspace, Microsoft 365, DocuSign** (§15) — top 5 covered as cheap wins via Zapier, 3 native.

### Q4 — enterprise + scale

19. **SSO (SAML/OIDC) + MFA + SCIM** (§16.1).
20. **Custom roles + record-level permissions** (§16.2).
21. **Receipting** (CRA + IRS compliant) (§4.2).
22. **Event + P2P platform MVP** (§9.1–9.2) — at least event registration + golf/gala + auction basics.
23. **Grateful-patient workflow** (§22.1) — lock in healthcare vertical.
24. **SOC 2 Type II readiness** (§16.4).

### Always-on (ongoing)

- Observability (Sentry, Datadog, structured logging).
- Performance (Redis, BullMQ, read replicas, cursor pagination).
- Horizontal scaling (cluster mode, PgBouncer).
- CI/CD (GitHub Actions, staging environment, E2E Playwright).
- WCAG 2.1 AA remediation.
- Documentation + help center + product tour.

### Deliberate "no's" (don't build)

- **Peer-to-peer crowdfunding** — too much table-stakes feature work; partner with Givebutter instead.
- **Full event ticketing** beyond registration — partner with Eventbrite / OneCause.
- **Wealth-screening native** — integrate WealthEngine + iWave, don't build your own DB.
- **Grant-application portal for external funders** — partner with Submittable / Instrumentl.
- **Own mobile app (native iOS/Android)** — stretch the PWA first; only build native once 3+ customers demand it.

---

## Appendix A: Competitor feature cross-reference

Rough grade across top peer platforms. ✓ = ships today, ○ = partial / add-on, – = absent. "FR" = Fund-Raise current state.

| Feature | RE NXT | Bloomerang | Virtuous | Bonterra (EA) | Neon One | DonorPerfect | Kindful | Little Green Light | Keela | Givebutter | Classy | Salesforce NPSP | **FR** |
|---------|--------|------------|----------|---------------|----------|--------------|---------|---------------------|-------|------------|--------|-----------------|--------|
| Donor record (full) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | ✓ | – |
| Household / relationships | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ○ |
| Pledges + installments | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ○ | ✓ | – |
| Moves management | ✓ | ✓ | ✓ | ✓ | ○ | ✓ | ○ | ○ | ○ | – | – | ✓ | – |
| Donation forms | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | – |
| Recurring giving | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ |
| Peer-to-peer | – | ○ | ✓ | ✓ | ✓ | ○ | – | – | – | ✓ | ✓ | – | – |
| Events / ticketing | ○ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | – | ✓ | ✓ | ✓ | – | – |
| Auctions | – | – | – | ○ | ○ | – | – | – | – | ✓ | ○ | – | – |
| Email marketing | ○ | ✓ | ✓ | ✓ | ✓ | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | – |
| Journey / automation | – | ○ | ✓ | ✓ | ○ | – | – | – | ○ | – | – | ○ | – |
| SMS / text | – | – | ○ | ✓ | ○ | – | – | – | – | ✓ | – | – | – |
| Direct mail merge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ○ | – |
| Receipting (CRA/IRS) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | – |
| QuickBooks/Xero | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | – |
| Wealth screening | ○ | ○ | ✓ | ✓ | ○ | ○ | ○ | – | – | – | – | ○ | – |
| Grants mgmt | ○ | ○ | ○ | ○ | ○ | – | – | – | – | – | – | ○ | – |
| Volunteers | ○ | ✓ | ○ | ✓ | ✓ | ✓ | – | – | ✓ | – | – | ✓ | – |
| Memberships | ○ | ○ | ○ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | – | ○ | – |
| Custom report builder | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | – | ○ | ✓ | – |
| Scheduled reports | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | – | – | ✓ | – |
| AI assistant | – | ○ | ✓ | – | ○ | – | – | – | ○ | – | – | ○ | ✓ |
| Journey AI / next-best-action | – | ○ | ✓ | – | – | – | – | – | – | – | – | ○ | ○ |
| Public REST API | ✓ (SKY) | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | – |
| Webhooks | – | – | ✓ | ✓ | ✓ | ○ | ✓ | – | ○ | ✓ | ✓ | ✓ | – |
| SSO (SAML) | ○ | ○ | ✓ | ✓ | ○ | ○ | – | – | – | – | – | ✓ | – |
| MFA | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | – | ○ | ✓ | ✓ | ✓ | – |
| HIPAA BAA | ○ | – | ○ | ✓ | – | – | – | – | – | – | – | ✓ | – |
| Grateful-patient | – | – | – | ✓ | – | – | – | – | – | – | – | ○ | – |
| Dark mode | – | – | ○ | – | – | – | – | – | – | – | – | ○ | – |
| Global search | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | ○ | – | – | ✓ | – |
| Command palette | – | – | ○ | – | – | – | – | – | – | – | – | – | – |
| Notification center | ○ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | – | ○ | ○ | ○ | ✓ | – |
| Mobile app | ○ | ✓ | ○ | ✓ | ○ | ○ | – | – | – | ✓ | ○ | ✓ | – |
| White-label donor portal | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ○ | ○ | ✓ | ○ | ✓ | ○ | – |
| Dashboard customization | ○ | ○ | ✓ | ✓ | ○ | ○ | ○ | – | – | – | – | ✓ | – |
| Benchmark panel | – | ✓ | – | – | – | – | – | – | – | – | – | – | ○ |

### Where Fund-Raise is already ahead of most competitors

- **AI-native** (Ask Fund-Raise with tool-use, per-dashboard AI context, writing assistant suite).
- **Dashboard depth** (30+ specific analytics views vs. Bloomerang's ~15, Neon's ~20).
- **LYBUNT/SYBUNT with revenue-at-risk**, upgrade/downgrade, first-time conversion with FEP benchmark, retention drilldown by fund/campaign/level — these are better than any competitor.
- **Proactive insights + anomaly detection** on login — rare in this category.
- **Instant dashboards from CSV**, no long data-warehouse setup.
- **Data-freshness transparency** — dashboards tell you exactly when data was last imported.
- **AI-generated thank-you / impact / meeting-prep / digest** — built-in.

Lean into these in positioning; the list above is the fill-in-the-blanks work, not the core value.

---

## Appendix B: "Raiser's Edge NXT parity" checklist

If the goal is to *replace* RE NXT (not just supplement it), here is the minimum feature list for a foundation to cancel its RE subscription.

### Must-have before replacement is credible

- [ ] Create / edit / merge constituents with full contact info
- [ ] Log contact reports (calls, visits, emails, letters)
- [ ] Enter gifts manually (single + batch)
- [ ] Attach documents to constituents / gifts / proposals
- [ ] Issue tax receipts (CRA + IRS compliant)
- [ ] Manage pledges + installments + balance tracking
- [ ] Record recurring gifts with card-on-file + dunning
- [ ] Opportunity / proposal pipeline with stages + probability
- [ ] Online donation forms with Stripe processing
- [ ] Mail merge to Word/PDF with letterhead
- [ ] Query builder / list builder with save + share
- [ ] Scheduled reports to email
- [ ] QuickBooks GL export
- [ ] Event registration + ticketing
- [ ] Membership management (for applicable verticals)
- [ ] Volunteer hour tracking (for applicable verticals)
- [ ] Wealth-screening integration
- [ ] SSO + MFA
- [ ] Custom roles + record-level permissions
- [ ] SOC 2 + HIPAA BAA (healthcare vertical)
- [ ] Full audit log with UI
- [ ] Data migration tool from RE NXT export
- [ ] Public REST API + webhooks

### Nice-to-have

- [ ] Grant-management pipeline
- [ ] Advocacy tools (phonebanks, petitions)
- [ ] Board management (meeting agendas, minutes, voting)
- [ ] Training / LMS
- [ ] Print-on-demand letterhead + envelopes
- [ ] Peer-to-peer fundraising pages

### Explicit non-goals (for positioning)

- No intent to build retail fundraising platform (Givebutter territory)
- No intent to build constituent-engagement platform (EveryAction territory)
- No intent to build fiscal sponsorship or DAF administration (FreeFunder / Daffy territory)

---

*Compiled 2026-04-15. This document reflects the Fund-Raise codebase state as of branch `claude/analyze-fundraise-gaps-XTZ6H`.*
