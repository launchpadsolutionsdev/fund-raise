# Fund-Raise

Fundraising intelligence for nonprofits. Fund-Raise turns Blackbaud Raiser's Edge NXT exports into real-time dashboards, donor analytics, and AI-powered insights so foundation teams can spend less time in spreadsheets and more time building relationships.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ |
| Backend | Express.js 4.x |
| Database | PostgreSQL (Sequelize ORM) |
| Templating | EJS (server-rendered) |
| Auth | Passport.js + Google OAuth 2.0 |
| AI | Anthropic Claude API |
| Deployment | Render |

## Features

- **22+ Analytics Dashboards** — CRM overview, donor scoring, retention, lifecycle, gift trends, campaign/appeal comparison, year-over-year, geographic, and more
- **Ask Fund-Raise** — AI-powered conversational analytics over your CRM data
- **Action Centre** — Task assignment linked to donors with priority and due dates
- **Writing Assistant** — AI-generated donor communications with 6 templates and 4 tones
- **Team Collaboration** — Message board, kudos wall, milestones, staff directory
- **CRM Data Import** — Upload Blackbaud RE NXT exports (CSV/XLSX) with auto column mapping
- **Multi-Tenancy** — Row-level security with PostgreSQL RLS policies
- **PDF Reports & CSV Export** — Generate and download from any dashboard

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Setup

```bash
# Clone and install
git clone <repo-url>
cd fund-raise
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database URL, Google OAuth credentials, etc.

# Generate encryption key
openssl rand -hex 32
# Add the output as TOKEN_ENCRYPTION_KEY in .env

# Run migrations
npx sequelize-cli db:migrate

# Start development server
npm run dev
```

The app will be available at `http://localhost:3000`.

### Environment Variables

See [`.env.example`](.env.example) for the full list. Required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Random string for session signing |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `TOKEN_ENCRYPTION_KEY` | 64 hex chars for encrypting Blackbaud tokens |

Optional: `ANTHROPIC_API_KEY` (AI features), `SMTP_*` (email notifications), `BLACKBAUD_*` (live data sync).

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start with `--watch` for auto-reload |
| `npm run migrate` | Run database migrations |
| `npm test` | Run test suite (Jest) |
| `npm run test:coverage` | Run tests with coverage report |

## Project Structure

```
src/
  app.js              # Express app entry point
  config/             # Database & Passport config
  middleware/          # Auth, CSRF, tenant context, validation
  models/             # Sequelize models (26 models)
  routes/             # Express route handlers
  services/           # Business logic (AI, import, dashboard queries)
  migrations/         # Sequelize CLI migrations
  utils/              # Feature flags, helpers
views/                # EJS templates (95 templates)
public/               # Static assets (CSS, JS, images)
tests/                # Jest test suite
```

## Security

- Google OAuth SSO (no password storage)
- PostgreSQL Row-Level Security for tenant isolation
- Blackbaud OAuth tokens encrypted at rest (AES-256-GCM)
- CSRF protection on all state-changing endpoints
- Helmet.js security headers
- Rate limiting on authentication endpoints
- Input validation with express-validator

## License

Proprietary. All rights reserved.
