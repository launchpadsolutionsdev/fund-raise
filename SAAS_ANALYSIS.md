# SaaS Gap Analysis: Fund-Raise

> Generated 2026-04-05 — Full codebase audit of what every polished, profitable SaaS has that Fund-Raise currently lacks.

## Current State Summary

Fund-Raise is a **comprehensive fundraising analytics platform** built on Express.js + EJS + PostgreSQL with deep AI integration (Anthropic Claude). It features:
- **50+ routes/pages** across CRM analytics, AI writing tools, team collaboration, and planning
- **30 CRM analytics pages** (donor scoring, retention, lifecycle, YoY comparison, etc.)
- **6 AI-powered writing tools** (writing assistant, thank-you letters, impact stories, digest, meeting prep, scenario planner)
- **Team collaboration** (message board, kudos wall, milestones, bingo, quick notes)
- **Multi-tenant architecture** with Google OAuth authentication
- **Blackbaud RE NXT integration** for live CRM data

---

## Critical Gaps (P0 — Must Have)

### 1. Billing & Subscription System
**Impact: Can't generate revenue without it.**

Currently missing:
- No Stripe (or any payment processor) integration
- No subscription tiers or pricing plans
- No self-service upgrade/downgrade/cancel
- No usage metering or seat-based pricing
- No invoice history or receipt downloads
- No trial periods with expiration flows
- No dunning management (failed payment retry)
- No feature gating by plan tier

The landing page has a "Pricing" nav anchor but no actual billing infrastructure exists.

### 2. Team Invitation System
**Impact: Can't grow accounts organically.**

Currently missing:
- No way to invite team members by email
- No pending invitation management
- No role management UI (admin/member/viewer)
- No ability to remove team members
- No department-level permissions UI

The User model has `role` and `isAdmin` fields, but these are managed manually — no admin UI exists.

### 3. Security Hardening
**Impact: Liability risk with sensitive donor data.**

Currently missing:
- **Helmet.js** — no HTTP security headers (CSP, HSTS, X-Frame-Options)
- **Rate limiting** — no rate limiter on login, API, or AI endpoints
- **CSRF protection** — no tokens on form submissions
- **Input sanitization** — no XSS prevention on user-generated content (Board, Kudos, Notes)
- **API authentication** — session-only; no API keys for programmatic access

Only security measures: `httpOnly` cookies, session auth, `trust proxy`.

---

## High Priority Gaps (P1 — Need Soon)

### 4. Transactional Email System
No email library exists (no nodemailer, SendGrid, or Postmark). Missing:
- Welcome emails, subscription receipts, team invitations
- Weekly digest delivery (ironic — the digest *generator* exists but can't email it)
- Failed payment notifications, onboarding drip sequences

### 5. Onboarding Flow
Minimal onboarding (empty state component + 3-step CRM import guide). Missing:
- Welcome wizard / setup checklist
- Interactive product tour
- Progress tracker
- Sample/demo data option
- Role-specific onboarding paths

### 6. In-App Notification System
No notification center. Missing:
- Bell icon with dropdown
- Real-time notifications (SSE infrastructure exists for AI, not for notifications)
- Notification preferences
- @mention alerts for Message Board
- Unread badge counts

### 7. Multi-Factor Authentication & SSO
Google OAuth only. Missing:
- Email/password auth option
- MFA/2FA (TOTP, SMS, security keys)
- SAML/OIDC SSO for enterprise
- Session management (view/revoke active sessions)

---

## Medium Priority Gaps (P2)

### 8. Audit Logging & Activity Feed
No audit trail for sensitive donor data. Missing:
- Activity log (who did what, when)
- Data change history, login history
- Export/download tracking
- Compliance logging

### 9. Global Search
No universal search across 50+ pages. Missing:
- Cmd+K / Ctrl+K universal search
- Cross-entity search (donors, gifts, campaigns, funds, team)
- Recent searches / history

### 10. Error Monitoring & Observability
No Sentry, Datadog, or structured logging. Uses `console.log` throughout. Missing:
- Error tracking, APM, uptime monitoring
- Session replay, structured JSON logging

### 11. Dark Mode / Theming
Light mode only. CSS variables defined but no dark theme. No `prefers-color-scheme` support.

### 12. Settings & Preferences
Current settings limited to profile, org, and Blackbaud. Missing:
- Notification preferences
- Display preferences (date format, currency, timezone)
- Account deletion / data export (GDPR compliance)

---

## Lower Priority Gaps (P3)

### 13. Help Center / In-App Support
No help system, knowledge base, chat widget, contextual tooltips, or FAQ.

### 14. Data Export & Scheduled Reporting
Limited CSV export only. No PDF dashboard export, scheduled report delivery, or custom report builder.

### 15. CI/CD Pipeline
Jest tests exist (24 files) but no GitHub Actions, no automated PR checks, no staging environment. Uses `sync({ alter: true })` instead of proper migrations.

### 16. Webhooks & Public API
Internal API only. No public REST API, webhook system, API key management, or documentation.

### 17. Mobile / PWA
Basic responsive CSS. No PWA manifest, service worker, offline capability, or mobile-optimized navigation.

### 18. In-App Changelog
`/whats-new` page exists but no in-app modal, "New" badges, or feature announcements.

---

## Priority Matrix

| Priority | Gap | Revenue Impact |
|----------|-----|----------------|
| **P0** | Billing & Subscriptions | Can't monetize |
| **P0** | Team Invitations | Can't grow accounts |
| **P0** | Security Hardening | Liability risk |
| **P1** | Transactional Email | Required for billing, invites, retention |
| **P1** | Onboarding Flow | Conversion rate |
| **P1** | Notification System | Engagement & retention |
| **P1** | MFA / SSO | Enterprise requirement |
| **P2** | Audit Logging | Compliance |
| **P2** | Global Search | UX at scale |
| **P2** | Error Monitoring | Operational visibility |
| **P2** | Dark Mode | Modern expectation |
| **P2** | Settings & Preferences | User control |
| **P3** | Help Center | Support cost reduction |
| **P3** | Data Export / Reporting | Enterprise expectation |
| **P3** | CI/CD Pipeline | Dev productivity |
| **P3** | Public API / Webhooks | Platform growth |
| **P3** | Mobile / PWA | Market expansion |
| **P3** | In-App Changelog | Feature awareness |

---

## Bottom Line

Fund-Raise has an **impressively deep analytics and AI feature set** — the product core is strong. What's missing is the **business infrastructure layer** that separates a project from a profitable SaaS: billing, email, invitations, security, notifications, onboarding, and observability.

The app is a powerful engine with no chassis around it.
