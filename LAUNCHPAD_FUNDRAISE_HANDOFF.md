# Fund-Raise Section for Launchpad Solutions — Handoff Brief

Self-contained brief for another Claude Code session to build a "Fund-Raise" product section on the Launchpad Solutions consulting website.

---

## 1. Positioning

**Launchpad Solutions** is the parent consulting company. Fund-Raise is one of its products; the other line is a consulting-based raffle management business (not in this codebase — write a placeholder for it if needed).

**Fund-Raise one-liner:** The fundraising intelligence platform for RE NXT foundations.

**Elevator pitch:** Fund-Raise replaces $7,000–$24,000 of scattered tools (Blackbaud Insight Designer, MissionBI, Power BI + CData, Crystal Reports, ChatGPT) with one AI-powered platform — 30+ dashboards, conversational analytics, donor scoring, and 6 writing tools — for $199/month.

**Target customer:** Nonprofit foundations running Blackbaud Raiser's Edge NXT (RE NXT). Currently live with foundations across Canada. Fiscal year Apr 1 – Mar 31.

**Primary CTA:** Get Started (→ /auth/login on the product site) + Contact Us (support@fund-raise.com).

---

## 2. Brand Identity

### Logo
- Wordmark: **Fund-Raise** (note the hyphen; the product's old camelCase "FundRaise" has been deprecated in the live site).
- Geometric mark — gradient arrow/chevron shapes.
- SVG sources in this repo: `fund-raise-icon-flat.svg`, `fund-raise-icon-light.svg`, `fund-raise-icon-accent (1).svg`, `Asset 5.svg`, `public/images/fund-raise-logo-mark.svg`, `Fund-Raise-Logo.png`, `public/images/fund-raise-mark.png`.
- Inline SVG used on the live landing page (drop into the Launchpad section for an authentic mark):

```html
<svg viewBox="0 0 478 520" width="28" height="28">
  <defs>
    <linearGradient id="fr-b" x1="44" y1="280" x2="136" y2="189" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#1960F9"/><stop offset="1" stop-color="#0D8CFF"/>
    </linearGradient>
    <linearGradient id="fr-c" x1="25" y1="211" x2="355" y2="541" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#12DEFF"/><stop offset="1" stop-color="#29C8F9"/>
    </linearGradient>
  </defs>
  <polygon fill="url(#fr-b)" points="0 235 7 230 174 227 179 235 168 241 8 243"/>
  <polygon fill="url(#fr-b)" points="208 276 199 276 112 380 113 394 123 401 290 399 292 393 295 378 216 276"/>
  <path fill="url(#fr-b)" d="M477 164L292 393 208 276l93-115c1-2 3-3 5-3l168 0c3 0 5 4 3 6Z"/>
  <polygon fill="#3434D6" points="292 393 113 394 208 276"/>
  <path fill="url(#fr-c)" d="M375 519l-168 1c-2 0-4-1-6-3L113 394l179 0 86 120c2 2 0 6-3 6ZM179 235L0 235l113 158 95-117-29-41Z"/>
  <path fill="url(#fr-b)" d="M364 6L179 235 0 235 188 3c1-2 3-3 5-3L361 0c3 0 5 4 3 6Z"/>
</svg>
```

### Colour tokens

```css
:root {
  /* Primary */
  --fr-snow: #EFF1F4;         /* light surfaces, cards */
  --fr-navy: #1A223D;         /* primary dark */
  --fr-indigo: #3434D6;       /* primary accent — CTAs, links */
  --fr-blue-start: #1960F9;   /* gradient start */
  --fr-blue-end: #0D8CFF;     /* gradient end */
  --fr-cyan-start: #12DEFF;   /* AI accent */
  --fr-cyan-end: #29C8F9;

  /* Grayscale */
  --fr-cloud: #EDEFF7;
  --fr-smoke: #D3D6E0;
  --fr-steel: #BCBFCC;
  --fr-space: #9DA2B3;
  --fr-graphite: #6E7180;
  --fr-arsenic: #40424D;
  --fr-phantom: #1E1E24;

  /* Gradients */
  --fr-gradient-blue: linear-gradient(135deg, #1960F9, #0D8CFF);
  --fr-gradient-cyan: linear-gradient(135deg, #12DEFF, #29C8F9);
}
```

Meta theme-color used on the live site: `#3434D6` (indigo).

### Typography
- **Manrope** (Google Fonts), weights 300/400/500/600/700/800.
- Scale: H1 64px / H2 48px / H3 32px / H4 24px / P 18px / small 16px.

```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

### Tone of voice
Authoritative, modern/cutting-edge, trustworthy, approachable. Sophisticated enough to signal cutting-edge AI; plain enough for nonprofit executives who aren't tech-forward.

---

## 3. Feature Set (what to showcase)

### Headline stats
- **30+ pre-built dashboards**
- **50 AI-powered analysis tools** powering Ask Fund-Raise
- **6 AI writing tools**
- **10 one-click PDF reports**
- **5 fundraising departments tracked** (Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving)
- **Unlimited users — no per-seat fees**

### Pillars to highlight on the Launchpad page

1. **30+ Dashboards** — CRM Master, Donor Scoring, Retention, LYBUNT/SYBUNT, Campaign Compare, Appeal Compare, Fund Health, Anomaly Detection, Recurring Donors, Donor Lifecycle, First-Time Donor Conversion, Upgrade/Downgrade, Household Giving, Gift Trends, Payment Methods, Matching Gifts, Soft Credits, Acknowledgments, YoY Compare, Department Analytics, Data Quality, Geographic, Donor Detail, Gift Search, Fundraiser Performance, Fundraiser Goals, Department Goals, Scenario Planner, Campaign Thermometer, Board Report PDF, AI Recommendations.

2. **Ask Fund-Raise (AI)** — Conversational analytics powered by Claude (Anthropic). CRM Mode, Deep Dive mode, image uploads, live Blackbaud SKY API queries, export to CSV. Example prompts: *"Who are my lapsed major donors?"*, *"Draft a stewardship email for Q4 donors"*, *"Compare this year vs last by fund."*

3. **Deep Donor Analytics** — RFM scoring (Recency/Frequency/Monetary), segments (Champion, Loyal, At Risk, New, Upgrade Candidate, Lapsed), LYBUNT/SYBUNT, lifecycle funnel, first-time → repeat conversion (benchmarked vs 19% national FEP average), household deduplication, upgrade/downgrade tracking.

4. **Six AI writing tools** — Writing Assistant, Thank-You Letters, Impact Stories, Meeting Prep, Weekly Digest, Quick Notes. Modes: draft from scratch / polish / reply. Tones: warm, professional, celebratory, empathetic. All personalised with the org's actual donor data.

5. **Reports & Exports** — 10 one-click PDF reports (Executive Summary, Retention, RFM Scoring, Recurring Donors, LYBUNT/SYBUNT, Gift Trends, Campaign Performance, Fund Health, Donor Lifecycle, Upgrade/Downgrade). CSV export on every table.

6. **Integrations** — Blackbaud RE NXT via SKY API (OAuth 2.0, encrypted tokens, real-time constituent lookups). Google OAuth 2.0 sign-in. CSV/Excel import with auto-column mapping (300MB limit, background processing).

7. **Team collaboration** — Action Centre (task assignment), Message Board, Kudos Wall, Milestones, Fundraising Bingo, Staff Directory.

8. **Security & multi-tenancy** — PostgreSQL row-level security for tenant isolation, AES-256-GCM token encryption, Helmet.js, CSRF protection, rate limiting, role-based access (Admin / Uploader / Viewer).

---

## 4. "What Fund-Raise Replaces" table (ready to paste)

| What you pay for today | Annual cost | What Fund-Raise gives you |
|---|---|---|
| Blackbaud Insight Designer | $2,500/yr | 30+ built-in dashboards |
| MissionBI Connect / Zuri Aqueduct | $3,000–$10,000/yr | Direct CSV/Excel import into PostgreSQL |
| Power BI Pro + CData connector | $1,000–$4,000/yr | Native in-app visualisations |
| Excel exports + manual analysis | 8–15 hrs/mo staff time | Board report PDF + AI queries |
| Crystal Reports (being sunset 2027) | $500–$1,500/yr | No coding required |
| Standalone AI writing tools | $240–$6,000/yr | 6 built-in writing tools |
| **Patchwork total** | **$7,000–$24,000/yr** | **Fund-Raise: $199/mo** |

---

## 5. Pricing

- **$199 / month** (flat; unlimited users).
- **Annual: $2,030 / year** (save 15% / ~$358 vs monthly).
- Currency: CAD.
- Includes all features — no per-user fees, no add-ons.

---

## 6. SEO / metadata (from live site, reuse on Launchpad subpage)

- **Title:** `Fund-Raise — Fundraising Intelligence for RE NXT Foundations`
- **Meta description:** `Fund-Raise replaces $7,000–$24,000 in scattered tools with one AI-powered platform. 30+ dashboards, conversational analytics, and smart writing tools — built for foundations running Raiser's Edge NXT.`
- **Keywords:** fundraising software, nonprofit dashboard, donor analytics, AI fundraising, nonprofit CRM, philanthropy analytics, Blackbaud alternative, RE NXT analytics.
- **OG image:** `SEO-Image-FR.jpg` (1200×630) in this repo.
- **Schema.org:** SoftwareApplication, BusinessApplication, price 199 CAD/month.
- **Live product URL:** `https://fund-raise.onrender.com` (link "Launch Fund-Raise" / "Go to app" CTAs here).

---

## 7. Suggested Launchpad-page structure

1. **Hero** — Eyebrow "A Launchpad Solutions product"; H1 "The fundraising intelligence platform for RE NXT foundations"; sub-copy about replacing the $7–24K patchwork; primary CTA "Launch Fund-Raise" → fund-raise.onrender.com; secondary "Book a demo" → mailto:support@fund-raise.com. Mockup: CRM dashboard with KPI row + revenue chart + department goals.
2. **Why Fund-Raise / What It Replaces** — the replacement table above.
3. **Dashboards** — tabbed carousel: CRM Dashboard, Donor Scoring, Retention, LYBUNT/SYBUNT, Campaign Compare. Use indigo `#3434D6` bars, navy text, snow backgrounds.
4. **Ask Fund-Raise (AI)** — dark/navy section with cyan-blue gradient accents; chat-mockup example ("Show me everyone who gave $500+ last year but not this year → 47 donors, $284,750").
5. **Deep Donor Analytics** — chips row (RFM Scoring, Retention, LYBUNT/SYBUNT, Recurring Donors, Upgrade/Downgrade, Lifecycle, Anomaly Detection, Fund Health) + lifecycle-funnel mockup.
6. **AI Writing Tools** — 6-card grid: Writing Assistant (feature), Thank-You Letters, Impact Stories, Meeting Prep, Weekly Digest, Quick Notes.
7. **Reports & Integrations** — 10 PDF reports list + Blackbaud RE NXT integration card (SKY API, OAuth 2.0, Real-Time).
8. **Pricing** — side-by-side "Patchwork $7K–$24K/yr" vs "Fund-Raise $199/mo" with monthly/annual toggle.
9. **FAQ** — reuse the 6 Qs below.
10. **Final CTA** — "Launch Fund-Raise" → external product site.

The full reference implementation lives at `views/landing/index.ejs` + `public/css/landing.css` in this repo — pull patterns from there directly.

---

## 8. FAQ (verbatim, ready to paste)

- **What is Fund-Raise?** — A fundraising intelligence platform for foundations and nonprofits running Blackbaud RE NXT. 30+ dashboards, AI conversational analytics, donor scoring, 6 writing tools — replacing Insight Designer, MissionBI, Crystal Reports, and standalone AI tools.
- **How does the AI assistant work?** — Ask Fund-Raise uses Claude by Anthropic. It looks up donors in Blackbaud via SKY API, analyses imported CRM data, compares campaigns YoY, flags anomalies, and accepts image uploads.
- **Is my data secure?** — TLS in transit + at rest encryption, Google OAuth 2.0, role-based access control, PostgreSQL row-level security for tenant isolation. Data is never sold or shared. AI queries don't retain data.
- **Do I need Blackbaud RE NXT?** — No. Fund-Raise works standalone with CSV/Excel uploads. The Blackbaud integration is optional and adds real-time lookups.
- **How do I get my data in?** — Drag-and-drop CSV/Excel (auto-column mapping, background processing, 300MB cap), or connect Blackbaud RE NXT via OAuth.
- **How much does it cost?** — $199/month, or $2,030/year (save 15%). Unlimited users. Everything included.

---

## 9. Launchpad Solutions cross-links to plan for

Since Launchpad is the parent, the site likely needs:
- Parent nav with: **Services · Fund-Raise · Raffle Management · About · Contact**.
- Product-agnostic Launchpad brand above Fund-Raise's brand on the page (small "A Launchpad Solutions product" tag; main section can use Fund-Raise brand colours/typography within the section).
- Footer block listing both Fund-Raise (product) and the raffle management business (consulting) so Launchpad acts as the umbrella.
- A shared contact funnel that routes Fund-Raise inquiries to `support@fund-raise.com` and raffle inquiries to a separate address.

**Note:** No information about the raffle management business exists in this codebase — the other Claude Code session will need that from you separately. Treat the raffle section as a placeholder to be filled in.

---

## 10. Reference files in this repo (for the other session to pull from if given access)

- `README.md` — tech stack + feature summary
- `FUND-RAISE-BRAND-GUIDE.md` — full brand system
- `Fund-Raise_Platform_Features_User_Manual.md` — every feature in detail
- `docs/fund-raise-client-guide.md` — customer-facing guide
- `views/landing/index.ejs` + `views/landing/footer.ejs` — live marketing page HTML
- `public/css/landing.css` — marketing page styles
- `public/images/SEO-Image-FR.jpg`, `Fund-Raise-Logo.png`, `fund-raise-icon-*.svg` — brand assets
- `fund_raise_homepage_wireframe.html` — early dashboard wireframe
