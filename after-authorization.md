# Blackbaud Integration — Picking Up After Authorization

## Current Status

Phase 1 is complete: OAuth flow, token storage, and connection UI are built and deployed. The app is waiting for Blackbaud Marketplace approval before the admin can authorize the connection.

## What's Been Built (Phase 1)

| File | Purpose |
|------|---------|
| `src/models/blackbaudToken.js` | Stores OAuth access/refresh tokens per tenant |
| `src/services/blackbaudClient.js` | API client with token exchange, auto-refresh, pagination |
| `src/routes/blackbaud.js` | OAuth routes (`/auth/blackbaud`, callback, disconnect) + settings page |
| `views/settings/blackbaud.ejs` | Admin UI to connect/disconnect Blackbaud |
| `views/partials/header.ejs` | Sidebar shows "Live" section when connected |

## Environment Variables Required on Render

```
BLACKBAUD_CLIENT_ID=<from developer.blackbaud.com>
BLACKBAUD_CLIENT_SECRET=<from developer.blackbaud.com>
BLACKBAUD_SUBSCRIPTION_KEY=<your SKY API subscription key>
BLACKBAUD_REDIRECT_URI=https://fund-raise.ca/auth/blackbaud/callback
```

Make sure `BLACKBAUD_REDIRECT_URI` exactly matches the redirect URI registered in your Blackbaud developer app.

## Steps to Complete After Approval

### Step 1: Authorize the App

1. Your Blackbaud org admin connects the app — either through the Marketplace or by visiting the direct authorization URL:
   ```
   https://app.blackbaud.com/oauth/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=https://fund-raise.ca/auth/blackbaud/callback&response_type=code&state=direct
   ```
2. Log into Fund-Raise as an admin
3. Go to **Blackbaud** in the sidebar (under Admin)
4. Click **Connect Blackbaud**
5. Authorize in the Blackbaud popup
6. You should see "Connected" status with a green checkmark

### Step 2: Verify the Connection

After connecting, check the settings page shows:
- Status: Connected (green)
- Token Status: Valid
- Connected By: your name

If the token shows as expired, click **Reconnect**.

### Step 3: Build the Live Dashboard (Phase 2)

Once connected, the next phase is building the live data pages. Here's the plan:

#### Phase 2: Live Dashboard
- Route: `GET /live/dashboard`
- Pulls summary data from SKY API endpoints:
  - `GET /constituent/v1/constituents` — donor counts
  - `GET /gift/v1/gifts` — recent gifts
  - `GET /fundraising/v1/campaigns` — campaign data
- Shows real-time KPIs: total constituents, recent gift activity, campaign progress

#### Phase 3: Live Gifts Page
- Route: `GET /live/gifts`
- Uses `GET /gift/v1/gifts` with filters (date range, fund, campaign)
- Sortable/searchable table of recent gifts
- Gift size distribution chart

#### Phase 4: Live Donors Page
- Route: `GET /live/donors`
- Uses `GET /constituent/v1/constituents` with search
- Donor lookup and profile cards
- Giving history per donor

#### Phase 5: Live Funds Page
- Route: `GET /live/funds`
- Uses `GET /fundraising/v1/funds`
- Fund balances and activity

#### Phase 6: Department Mapping
- Config to map Blackbaud fund/campaign codes to the 5 departments (Annual Giving, Direct Mail, Events, Major Gifts, Legacy Giving)
- Allows live data to be viewed per-department

## Key Technical Notes

- **SKY API requires two headers**: `Authorization: Bearer <token>` and `Bb-Api-Subscription-Key: <key>`
- **Pagination**: Blackbaud uses cursor-based pagination via `next_link` in responses. The `apiRequestAll()` helper handles this automatically.
- **Rate limits**: SKY API has rate limits. The client throws a clear error on 429 responses.
- **Token auto-refresh**: Tokens expire after ~60 minutes. The client auto-refreshes when a token is within 5 minutes of expiry. If refresh fails, the admin needs to reconnect.
- **No official Node.js SDK**: All API calls use raw `fetch` via `blackbaudClient.js`.
- **One connection per tenant**: The `blackbaud_tokens` table stores one row per tenant.

## How to Use the API Client

```javascript
const blackbaud = require('./src/services/blackbaudClient');

// Single request
const data = await blackbaud.apiRequest(tenantId, '/constituent/v1/constituents?limit=10');

// Paginated (fetches all pages, up to maxPages)
const allGifts = await blackbaud.apiRequestAll(tenantId, '/gift/v1/gifts', 'value', 20);

// Check connection
const status = await blackbaud.getConnectionStatus(tenantId);
// { connected: true, connectedBy: 'John', connectedAt: ..., isExpired: false }
```

## Blackbaud SKY API Reference

- API docs: https://developer.blackbaud.com/skyapi/apis
- Constituent API: https://developer.blackbaud.com/skyapi/apis/constituent
- Gift API: https://developer.blackbaud.com/skyapi/apis/gift
- Fundraising API: https://developer.blackbaud.com/skyapi/apis/fundraising
- OAuth docs: https://developer.blackbaud.com/skyapi/docs/authorization
