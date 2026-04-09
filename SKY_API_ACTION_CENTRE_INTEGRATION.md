# SKY API Integration: Action Centre → Raiser's Edge NXT

## Overview

Integrate Fund-Raise's existing Action Centre with Blackbaud's SKY API so that when a user creates/updates/completes a task in Fund-Raise, it is simultaneously written to Raiser's Edge NXT as an **Action**. This keeps RE NXT as the system of record while Fund-Raise serves as the AI-powered analytics layer that generates and manages tasks.

---

## Architecture

```
User creates task in Fund-Raise Action Centre
        │
        ▼
Fund-Raise backend (Node.js/Express)
        │
        ├── Saves to Fund-Raise PostgreSQL database (existing)
        │
        └── POST/PATCH to SKY API ──► Raiser's Edge NXT Action
                                        (system of record)
```

The integration is **bi-directional write, one-way sync**:
- Fund-Raise **creates/updates/completes** actions in RE NXT via the SKY API
- Fund-Raise stores the RE NXT `action_id` returned from the API so it can update/delete later
- Fund-Raise does NOT pull actions back from RE NXT (avoids complexity; RE NXT remains source of truth for anything created directly in RE NXT)

---

## Prerequisites: Blackbaud SKY API Setup

Before writing any code, the following must be set up in Blackbaud's developer ecosystem. This is a manual process that Torin (or the client's Blackbaud admin) must complete.

### 1. Create a SKY Developer Account
- URL: https://developer.blackbaud.com/
- Sign up with a Blackbaud ID (or create one)
- This is the developer portal — separate from the RE NXT admin portal

### 2. Create a SKY Application
- Go to **My Applications** in the developer portal
- Click **Add** to create a new application
- Name it something like "Fund-Raise Integration"
- This generates two critical credentials:
  - **Application ID** (this is the OAuth `client_id`)
  - **Application Secret** (this is the OAuth `client_secret`)
- Set the **Redirect URI** to your Fund-Raise callback URL, e.g.:
  - Production: `https://fund-raise.ca/auth/blackbaud/callback`
  - Development: `http://localhost:3000/auth/blackbaud/callback`
- **Important**: The redirect URI must match EXACTLY (including trailing slashes, capitalization)

### 3. Get a Subscription Key
- Go to **My Subscriptions** in the developer portal
- Subscribe to **Standard APIs** (free tier gives 1,000 calls/day; Standard tier gives 25,000 calls/day)
- This generates a **Primary** and **Secondary** subscription key
- You'll use one of these as the `Bb-Api-Subscription-Key` header in every API call

### 4. Connect the Application to the Client's RE NXT Environment
- The client's Blackbaud **organization administrator** must:
  1. Go to **Control Panel** → **Applications** in their RE NXT web view
  2. Search for and approve/connect the "Fund-Raise Integration" application
  3. This authorizes Fund-Raise to access their RE NXT data
- Without this step, OAuth will fail with a "not connected" error

### 5. Environment Variables to Add
```env
# Blackbaud SKY API
BLACKBAUD_CLIENT_ID=<Application ID from My Applications>
BLACKBAUD_CLIENT_SECRET=<Application Secret from My Applications>
BLACKBAUD_SUBSCRIPTION_KEY=<Primary or Secondary key from My Subscriptions>
BLACKBAUD_REDIRECT_URI=https://fund-raise.ca/auth/blackbaud/callback
BLACKBAUD_AUTH_URL=https://oauth2.sky.blackbaud.com/authorization
BLACKBAUD_TOKEN_URL=https://oauth2.sky.blackbaud.com/token
BLACKBAUD_API_BASE=https://api.sky.blackbaud.com
```

---

## OAuth 2.0 Authorization Code Flow

SKY API uses OAuth 2.0 Authorization Code Flow. This is a **per-organization** authorization — each Fund-Raise client organization connects once, and the tokens are stored and refreshed automatically.

### Flow Summary

```
1. Admin clicks "Connect to Raiser's Edge" in Fund-Raise settings
        │
        ▼
2. Redirect to Blackbaud authorization page:
   GET https://oauth2.sky.blackbaud.com/authorization
     ?client_id={BLACKBAUD_CLIENT_ID}
     &response_type=code
     &redirect_uri={BLACKBAUD_REDIRECT_URI}
     &state={random_csrf_token}
        │
        ▼
3. User logs in with Blackbaud ID and grants consent
        │
        ▼
4. Blackbaud redirects back to:
   {BLACKBAUD_REDIRECT_URI}?code={authorization_code}&state={csrf_token}
        │
        ▼
5. Exchange code for tokens:
   POST https://oauth2.sky.blackbaud.com/token
   Headers:
     Authorization: Basic {base64(client_id:client_secret)}
     Content-Type: application/x-www-form-urlencoded
   Body:
     grant_type=authorization_code
     &code={authorization_code}
     &redirect_uri={BLACKBAUD_REDIRECT_URI}
        │
        ▼
6. Response:
   {
     "access_token": "eyJ...",
     "token_type": "bearer",
     "expires_in": 3600,
     "refresh_token": "abc123...",
     "tenant_id": "p-xxx...",
     "environment_id": "p-xxx...",
     "environment_name": "Production",
     "email": "admin@foundation.org"
   }
```

### Token Storage

Store per-organization in your existing PostgreSQL database. Suggested schema addition:

```sql
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_access_token TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_refresh_token TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_token_expires_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_tenant_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_environment_id TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS blackbaud_connected BOOLEAN DEFAULT false;
```

### Token Refresh

- Access tokens expire after **60 minutes** (3600 seconds)
- Refresh tokens expire after **365 days**
- **Refresh tokens are single-use** — each refresh returns a NEW refresh token
- You must store the new refresh token every time you refresh

```
POST https://oauth2.sky.blackbaud.com/token
Headers:
  Authorization: Basic {base64(client_id:client_secret)}
  Content-Type: application/x-www-form-urlencoded
Body:
  grant_type=refresh_token
  &refresh_token={stored_refresh_token}
```

**Critical**: Only refresh one token at a time per organization. If two requests try to refresh simultaneously, the second will fail because the refresh token was already consumed by the first.

### Implementation: Blackbaud API Helper Module

Create a module that handles all SKY API calls with automatic token refresh:

**File: `services/blackbaudApi.js`**

This module should:
1. Accept an `organizationId` parameter to look up stored tokens
2. Check if the access token is expired (compare `blackbaud_token_expires_at` with current time, minus a 5-minute buffer)
3. If expired, refresh the token and store the new access + refresh tokens
4. Make the API call with proper headers
5. Handle 429 (rate limit) by reading `retry-after` header and retrying
6. Handle 403 (quota exceeded) by reading `retry-after` header and queuing for later
7. Handle 500 by waiting 5 seconds and retrying once

Every SKY API request requires these headers:
```
Authorization: Bearer {access_token}
Bb-Api-Subscription-Key: {BLACKBAUD_SUBSCRIPTION_KEY}
Content-Type: application/json
```

---

## SKY API Endpoints for Actions

Base URL: `https://api.sky.blackbaud.com`

### Create Action
```
POST /constituent/v1/actions
```

**Request Body (JSON):**
```json
{
  "constituent_id": "280",
  "date": "2026-04-15T00:00:00Z",
  "category": "Phone Call",
  "type": "Follow-up",
  "summary": "Follow up on major gift conversation",
  "description": "Discuss the $50K pledge timeline and answer questions about naming opportunities.",
  "status": "Open",
  "priority": "High",
  "direction": "Outbound",
  "location": "Office",
  "start_time": "14:00",
  "end_time": "14:30",
  "fundraisers": ["252"],
  "completed": false,
  "opportunity_id": "456",
  "author": "Fund-Raise AI"
}
```

**Required Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `constituent_id` | string | RE NXT system record ID of the constituent |
| `date` | datetime (ISO 8601) | The action date |
| `category` | string | The channel/intent — must match a value configured in RE NXT |

**Optional Fields:**
| Field | Type | Description | Limits |
|-------|------|-------------|--------|
| `type` | string | Sub-category to complement the category | Must match RE NXT config |
| `summary` | string | Short description shown at top of record | Max 255 chars |
| `description` | string | Detailed notes/explanation | No explicit limit |
| `status` | string | Action status (system-dependent) | Must match RE NXT config |
| `completed` | boolean | Whether the action is done | Defaults to `false` |
| `completed_date` | datetime | When it was completed | ISO 8601 |
| `direction` | string | Direction of the action | RE NXT configured values |
| `location` | string | Where the action takes place | RE NXT configured values |
| `priority` | string | Priority level | RE NXT configured values |
| `outcome` | string | Result of the action | RE NXT configured values |
| `start_time` | string | Start time in 24h format | `"HH:mm"` (e.g. `"14:00"`) |
| `end_time` | string | End time in 24h format | `"HH:mm"` (e.g. `"14:30"`) |
| `fundraisers` | string[] | Array of fundraiser system IDs | RE NXT constituent IDs |
| `opportunity_id` | string | Linked opportunity record ID | RE NXT system ID |
| `author` | string | Who created the summary/description | Max 50 chars |

**Response (201 Created):**
```json
{
  "id": "12345"
}
```

Store this `id` as `re_nxt_action_id` in your Fund-Raise action/task table.

### Update Action
```
PATCH /constituent/v1/actions/{action_id}
```

Same body fields as Create (all optional for PATCH). Only include fields you want to change.

**Response: 200 OK** (no body)

### Delete Action
```
DELETE /constituent/v1/actions/{action_id}
```

**Response: 200 OK** (no body)

### Get Single Action
```
GET /constituent/v1/actions/{action_id}
```

**Response (200 OK):**
```json
{
  "id": "12345",
  "constituent_id": "280",
  "category": "Phone Call",
  "completed": false,
  "computed_status": "Open",
  "date": "2026-04-15T00:00:00",
  "date_added": "2026-04-09T12:00:00+00:00",
  "date_modified": "2026-04-09T12:00:00+00:00",
  "description": "Discuss the $50K pledge timeline...",
  "direction": "Outbound",
  "fundraisers": ["252"],
  "location": "Office",
  "outcome": null,
  "priority": "High",
  "start_time": "14:00",
  "end_time": "14:30",
  "status": "Open",
  "status_code": "Open",
  "computed_status": "Open",
  "summary": "Follow up on major gift conversation",
  "type": "Follow-up"
}
```

### List Actions for a Constituent
```
GET /constituent/v1/constituents/{constituent_id}/actions
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| `limit` | integer | Records to return (default 500, max 5000) |
| `offset` | integer | Records to skip (for pagination) |

**Response:**
```json
{
  "count": 4,
  "next_link": "https://api.sky.blackbaud.com/constituent/v1/constituents/280/actions?offset=500",
  "value": [
    { /* action objects */ }
  ]
}
```

### List All Actions (across all constituents)
```
GET /constituent/v1/actions
```

Query Parameters:
| Param | Type | Description |
|-------|------|-------------|
| `list_id` | string | Filter to a specific RE NXT list |
| `computed_status` | string | `Open`, `Completed`, or `PastDue` |
| `status_code` | string | Filter by custom status code |
| `limit` | integer | Default 500, max 5000 |
| `offset` | integer | For pagination |
| `date_added` | datetime | Filter: created on or after this date |
| `last_modified` | datetime | Filter: modified on or after this date |

### List Action Configuration Values

To populate dropdowns in your UI with valid RE NXT values:

**Action Types (categories):**
```
GET /constituent/v1/actions/types
```

**Action Status Types:**
```
GET /constituent/v1/actions/statustypes
```

**Action Locations:**
```
GET /constituent/v1/actions/locations
```

These return arrays of strings that represent the values configured in each organization's RE NXT instance. **Cache these values** — they change rarely. Refresh daily or on-demand.

---

## Database Schema Changes

Add to your existing Fund-Raise task/action table:

```sql
-- Link Fund-Raise tasks to RE NXT actions
ALTER TABLE action_centre_tasks ADD COLUMN IF NOT EXISTS re_nxt_action_id TEXT;
ALTER TABLE action_centre_tasks ADD COLUMN IF NOT EXISTS re_nxt_sync_status TEXT DEFAULT 'pending';
-- Values: 'pending', 'synced', 'failed', 'not_connected'
ALTER TABLE action_centre_tasks ADD COLUMN IF NOT EXISTS re_nxt_sync_error TEXT;
ALTER TABLE action_centre_tasks ADD COLUMN IF NOT EXISTS re_nxt_last_synced_at TIMESTAMPTZ;

-- Store RE NXT configuration values (action types, statuses, etc.)
CREATE TABLE IF NOT EXISTS re_nxt_config_cache (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  config_type TEXT NOT NULL, -- 'action_types', 'status_types', 'locations'
  config_values JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, config_type)
);
```

---

## Implementation Plan

### Phase 1: OAuth Connection Flow

1. **Settings page UI**: Add a "Connect to Raiser's Edge NXT" button in the organization settings/admin area
2. **OAuth routes**:
   - `GET /auth/blackbaud` — Initiates OAuth flow (redirects to Blackbaud)
   - `GET /auth/blackbaud/callback` — Handles the callback, exchanges code for tokens, stores them
   - `POST /auth/blackbaud/disconnect` — Clears stored tokens, sets `blackbaud_connected = false`
3. **Connection status indicator**: Show whether the org is connected to RE NXT in the Action Centre UI

### Phase 2: API Helper Module

1. **`services/blackbaudApi.js`** — Core module with:
   - `makeRequest(orgId, method, endpoint, body)` — Handles auth, refresh, retries
   - `createAction(orgId, actionData)` — Wrapper for POST /actions
   - `updateAction(orgId, actionId, actionData)` — Wrapper for PATCH /actions/{id}
   - `deleteAction(orgId, actionId)` — Wrapper for DELETE /actions/{id}
   - `getAction(orgId, actionId)` — Wrapper for GET /actions/{id}
   - `listConstituentActions(orgId, constituentId)` — Wrapper for GET
   - `getActionTypes(orgId)` — Fetches and caches valid categories
   - `getActionStatuses(orgId)` — Fetches and caches valid statuses
   - `getActionLocations(orgId)` — Fetches and caches valid locations

### Phase 3: Action Centre Integration

1. **On task creation in Action Centre**:
   - Save to Fund-Raise DB (existing logic)
   - If org is connected to Blackbaud (`blackbaud_connected = true`):
     - Map Fund-Raise task fields to SKY API action fields
     - POST to SKY API
     - Store returned `id` as `re_nxt_action_id`
     - Set `re_nxt_sync_status = 'synced'`
   - If API call fails:
     - Set `re_nxt_sync_status = 'failed'`
     - Store error in `re_nxt_sync_error`
     - The task still exists in Fund-Raise — RE NXT sync is non-blocking

2. **On task update**:
   - Update in Fund-Raise DB (existing logic)
   - If `re_nxt_action_id` exists, PATCH the action in RE NXT

3. **On task completion**:
   - Update in Fund-Raise DB
   - PATCH the action in RE NXT with `completed: true` and `completed_date`

4. **On task deletion**:
   - Delete from Fund-Raise DB
   - DELETE the action from RE NXT

### Phase 4: Field Mapping & UI Enhancements

1. **Fetch and cache RE NXT config values** (action types, statuses, locations) when org connects
2. **Populate Action Centre dropdowns** with the cached RE NXT values so users pick valid categories
3. **Show sync status** on each task in the Action Centre UI:
   - Green checkmark = synced to RE NXT
   - Yellow warning = sync failed (with retry button)
   - Grey dash = org not connected to RE NXT
4. **Add a "Retry Failed Syncs" button** in admin settings

---

## Field Mapping: Fund-Raise → SKY API

Map your existing Action Centre fields to the SKY API Action entity:

| Fund-Raise Field | SKY API Field | Notes |
|-------------------|---------------|-------|
| Task title | `summary` | Max 255 chars |
| Task description/notes | `description` | Detailed notes |
| Assigned fundraiser | `fundraisers` | Array of RE NXT constituent IDs |
| Due date | `date` | ISO 8601 datetime |
| Task type/category | `category` | Must match RE NXT configured values |
| Sub-type | `type` | Must match RE NXT configured values |
| Status | `status` | Must match RE NXT configured values |
| Priority | `priority` | Must match RE NXT configured values |
| Completed | `completed` | Boolean |
| Completed date | `completed_date` | ISO 8601 datetime |
| Related constituent | `constituent_id` | RE NXT system record ID |
| Direction | `direction` | Inbound/Outbound |
| Location | `location` | Must match RE NXT configured values |
| Start time | `start_time` | "HH:mm" 24-hour format |
| End time | `end_time` | "HH:mm" 24-hour format |

**Important**: The `constituent_id` and `fundraisers` values must be RE NXT system IDs. If Fund-Raise already imports constituent data from RE NXT (which it does via the CSV import/header mapper), you likely already have these IDs stored. If not, you'll need to search for constituents via:
```
GET /constituent/v1/constituents/search?search_text={name_or_email}
```

---

## Rate Limits & Error Handling

### Rate Limits
- **Per-request rate limit**: If exceeded, returns `429 Too Many Requests` with a `retry-after` header (in seconds)
- **Daily quota**: Standard tier = 25,000 calls/day. If exceeded, returns `403 Forbidden` with a `retry-after` header
- **Per-connection rate limit** (Power Platform connectors): 100 calls per 60 seconds — this applies to the connector, not necessarily direct API, but good to stay under

### Error Handling Strategy

```javascript
async function makeBlackbaudRequest(orgId, method, endpoint, body = null) {
  // 1. Get/refresh tokens
  const tokens = await getValidTokens(orgId);
  if (!tokens) throw new Error('Organization not connected to Blackbaud');

  const url = `${process.env.BLACKBAUD_API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Bb-Api-Subscription-Key': process.env.BLACKBAUD_SUBSCRIPTION_KEY,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : null
    });

    // Rate limited — wait and retry
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after')) || 5;
      await sleep(retryAfter * 1000);
      return makeBlackbaudRequest(orgId, method, endpoint, body); // retry
    }

    // Quota exceeded — log and queue for later
    if (response.status === 403) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(`Blackbaud daily quota exceeded. Retry after ${retryAfter}s`);
    }

    // Server error — wait 5s and retry once
    if (response.status === 500) {
      await sleep(5000);
      const retryResponse = await fetch(url, { /* same config */ });
      if (!retryResponse.ok) throw new Error(`Blackbaud server error: ${retryResponse.status}`);
      return retryResponse.json();
    }

    // Auth error — token may have been revoked
    if (response.status === 401) {
      // Force token refresh and retry once
      await refreshTokens(orgId, true);
      return makeBlackbaudRequest(orgId, method, endpoint, body);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Blackbaud API error ${response.status}: ${errorBody}`);
    }

    // DELETE and PATCH return no body
    if (response.status === 200 && method !== 'GET') return { success: true };
    if (response.status === 204) return { success: true };

    return response.json();

  } catch (error) {
    console.error(`Blackbaud API error [${method} ${endpoint}]:`, error.message);
    throw error;
  }
}
```

---

## Important Considerations

### 1. Non-Blocking Sync
The SKY API call should NEVER block the user from creating a task in Fund-Raise. If the API is down, rate-limited, or the org isn't connected, the task should still save locally. Sync status is tracked separately.

### 2. Constituent ID Mapping
Fund-Raise already imports RE NXT data via CSV. Ensure the constituent's RE NXT system `id` is stored and accessible when creating actions. This is the `constituent_id` field required by the API.

### 3. Fundraiser ID Mapping
The `fundraisers` array expects RE NXT constituent IDs for the fundraisers (staff who are also constituents in RE NXT). You may need to provide a mapping UI or auto-detect based on the logged-in user's email matching a RE NXT constituent.

### 4. Category/Type Validation
The `category` and `type` fields must exactly match values configured in each organization's RE NXT instance. Use the List Action Types endpoint to fetch valid values and populate dropdowns. Don't let users type free-text for these fields.

### 5. Multi-Tenant Considerations
Each Fund-Raise organization will have its own Blackbaud OAuth tokens and subscription. The `Bb-Api-Subscription-Key` is tied to the Fund-Raise developer account (shared across all orgs), but the `access_token` is per-organization. Ensure token storage and refresh logic is org-scoped.

### 6. Webhook Consideration (Future Enhancement)
Blackbaud offers webhooks for action changes. This could enable two-way sync (changes in RE NXT reflected in Fund-Raise). This is NOT in scope for the initial build but worth noting for the roadmap. Webhook documentation: https://developer.blackbaud.com/skyapi/docs/in-depth-topics/webhooks

---

## Testing

### With Postman
1. Register a separate Blackbaud app for testing
2. Use Postman's OAuth 2.0 authorization type
3. Set Auth URL: `https://oauth2.sky.blackbaud.com/authorization`
4. Set Token URL: `https://oauth2.sky.blackbaud.com/token`
5. Set Client ID and Client Secret from your test app
6. Set Scope: (leave blank — SKY API doesn't use scopes)
7. Add `Bb-Api-Subscription-Key` as a header
8. Test against the sandbox/cohort environment first

### Sandbox Environment
Blackbaud offers a shared developer cohort environment for testing. Request access through the developer portal. Note: sandbox data is shared among all developers, so don't put sensitive data there.

### Test Sequence
1. Verify OAuth flow connects and stores tokens
2. Call `GET /constituent/v1/actions/types` to verify API access works
3. Create a test action with `POST /constituent/v1/actions`
4. Verify it appears in RE NXT web view
5. Update it with `PATCH /constituent/v1/actions/{id}`
6. Verify changes appear in RE NXT
7. Delete it with `DELETE /constituent/v1/actions/{id}`
8. Test token refresh by waiting 60+ minutes
9. Test error handling: invalid constituent_id, invalid category, etc.

---

## Key Reference Links

- SKY API Documentation: https://developer.blackbaud.com/skyapi
- Authorization Code Flow: https://developer.blackbaud.com/skyapi/docs/authorization/auth-code-flow
- Node.js OAuth Tutorial Code: https://github.com/blackbaud/sky-api-tutorial-auth-code-nodejs
- Constituent API (includes Actions): https://developer.blackbaud.com/skyapi/products/renxt/constituent
- Entity Reference (Action schema): https://developer.blackbaud.com/skyapi/products/renxt/constituent/entities
- Common Auth Issues: https://developer.blackbaud.com/skyapi/docs/authorization/common-auth-issues
- Rate Limits: https://developer.blackbaud.com/skyapi/docs/in-depth-topics/api-request-throttling
- Error Handling Guide: https://developer.blackbaud.com/skyapi/docs/in-depth-topics/handle-common-errors
- Blackbaud Developer Portal (manage apps): https://developer.blackbaud.com/apps
