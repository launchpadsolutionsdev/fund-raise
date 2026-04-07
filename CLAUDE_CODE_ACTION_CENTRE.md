# Claude Code Task: Build Action Centre for Fund-Raise

## Context

Fund-Raise is a monolithic Node.js/Express/PostgreSQL philanthropy dashboard (EJS-templated, no SPA). It currently has team collaboration features including a message board (Post/PostComment models), staff profiles, quick notes, and a kudos wall. The existing role system is: viewer → uploader → admin.

The Action Centre is a new feature that lets managers assign donor-related tasks to fundraisers directly within Fund-Raise. The key differentiator is that actions are linked to donor records from the CRM import data (CrmGift table), so every task carries full donor context. This turns Fund-Raise from a reporting tool into a daily management platform.

## Tech Stack (do not change)
- Runtime: Node.js (v18+)
- Backend: Express.js
- Templating: EJS (server-rendered)
- ORM: Sequelize
- Database: PostgreSQL
- Auth: Passport.js + Google OAuth 2.0
- Styling: Custom CSS with Manrope font (Google Fonts)
- Brand colors: Navy #1A223D, Indigo #3434D6, Blue #1960F9→#0D8CFF, Cyan #12DEFF→#29C8F9, Snow #EFF1F4

## Overview

Build 3 things:

1. **Action model & API** — data layer for tasks with donor linkage
2. **Action Centre UI** — notification hub, task list, and detail view
3. **Donor profile integration** — "Assign Action" button on donor records + Ask Fund-Raise AI integration

---

## Work Stream 1: Data Model

### Action Model

Create `src/models/action.js`:

```javascript
{
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  tenantId: { type: DataTypes.UUID, allowNull: false },
  
  // Who
  assignedById: { type: DataTypes.UUID, allowNull: false },    // User who created the action
  assignedToId: { type: DataTypes.UUID, allowNull: false },    // User who should complete it
  
  // What
  title: { type: DataTypes.STRING, allowNull: false },          // Short summary, e.g. "Follow up with Margaret Chen"
  description: { type: DataTypes.TEXT, allowNull: true },       // Detailed instructions / context
  
  // Donor linkage (optional — actions can exist without a donor link)
  constituentName: { type: DataTypes.STRING, allowNull: true },      // Denormalized for quick display
  constituentId: { type: DataTypes.STRING, allowNull: true },        // RE NXT constituent ID from CrmGift
  systemRecordId: { type: DataTypes.STRING, allowNull: true },       // RE NXT system record ID
  donorContext: { type: DataTypes.JSONB, allowNull: true },          // Snapshot of donor data at time of assignment
  // Structure: { lifetimeGiving: 12500, lastGiftDate: '2024-11-15', lastGiftAmount: 500, fundDescription: 'Annual Fund', giftCount: 24 }
  
  // Status
  status: { 
    type: DataTypes.ENUM('open', 'pending', 'resolved'),
    defaultValue: 'open',
    allowNull: false
  },
  
  // Priority
  priority: {
    type: DataTypes.ENUM('normal', 'high', 'urgent'),
    defaultValue: 'normal',
    allowNull: false
  },
  
  // Timestamps
  resolvedAt: { type: DataTypes.DATE, allowNull: true },
  resolvedById: { type: DataTypes.UUID, allowNull: true },
  
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE
}
```

### ActionComment Model

Create `src/models/actionComment.js`:

```javascript
{
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  actionId: { type: DataTypes.UUID, allowNull: false },
  userId: { type: DataTypes.UUID, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  
  // System-generated comments for status changes
  isSystemComment: { type: DataTypes.BOOLEAN, defaultValue: false },
  // e.g. "Chantal marked this action as pending" or "Glenn reassigned this to Mike"
  
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE
}
```

### Associations

```javascript
// In your model index or association setup:
Action.belongsTo(User, { as: 'assignedBy', foreignKey: 'assignedById' });
Action.belongsTo(User, { as: 'assignedTo', foreignKey: 'assignedToId' });
Action.belongsTo(User, { as: 'resolvedBy', foreignKey: 'resolvedById' });
Action.hasMany(ActionComment, { foreignKey: 'actionId', as: 'comments' });
ActionComment.belongsTo(User, { foreignKey: 'userId', as: 'author' });
ActionComment.belongsTo(Action, { foreignKey: 'actionId' });
```

---

## Work Stream 2: API Routes

Create `src/routes/api/actions.js`:

### Endpoints

| Method | Path | Description | Access |
|--------|------|-------------|--------|
| GET | `/api/actions` | List actions for current user (assigned to me) | All roles |
| GET | `/api/actions/assigned` | List actions I've assigned to others | All roles |
| GET | `/api/actions/all` | List all actions for the tenant | Admin only |
| GET | `/api/actions/stats` | Action stats (open/pending/resolved counts) | All roles |
| GET | `/api/actions/:id` | Get single action with comments | All roles (must be assignee, assigner, or admin) |
| POST | `/api/actions` | Create a new action | Uploader + Admin |
| PATCH | `/api/actions/:id/status` | Update status (open/pending/resolved) | Assignee, assigner, or admin |
| POST | `/api/actions/:id/comments` | Add a comment | Assignee, assigner, or admin |
| PATCH | `/api/actions/:id/reassign` | Reassign to a different user | Assigner or admin |
| DELETE | `/api/actions/:id` | Delete an action | Assigner or admin |

### Route Implementation Details

**GET `/api/actions`** — My inbox
```javascript
// Query actions where assignedToId = current user
// Default: status != 'resolved', ordered by priority (urgent first) then createdAt desc
// Query params: ?status=open|pending|resolved|all&page=1&limit=20
// Include: assignedBy user (name, avatar), comment count
```

**GET `/api/actions/assigned`** — Actions I've delegated
```javascript
// Query actions where assignedById = current user
// Same filters as above
// Include: assignedTo user (name, avatar), comment count, status
```

**GET `/api/actions/all`** — Admin overview
```javascript
// Admin only — all actions for the tenant
// Include: both assignedBy and assignedTo users
// Useful for management dashboards
```

**GET `/api/actions/stats`** — Notification badge counts
```javascript
// Returns: { myOpen: 3, myPending: 1, assignedOpen: 5, assignedPending: 2 }
// This powers the notification badge on the Action Centre nav item
```

**POST `/api/actions`** — Create action
```javascript
// Required: assignedToId, title
// Optional: description, constituentName, constituentId, systemRecordId, donorContext, priority
// Automatically sets assignedById to current user
// Automatically sets tenantId from current user's tenant
// Returns the created action with associations

// Body example:
{
  "assignedToId": "uuid-of-chantal",
  "title": "Follow up with Margaret Chen — lapsed major donor",
  "description": "Margaret is good friends with our board chair Mark. Reach out to Mark first and set up a lunch meeting. She gave $10,000 annually for 5 years but nothing in FY25.",
  "constituentName": "Margaret Chen",
  "constituentId": "12345",
  "systemRecordId": "67890",
  "donorContext": {
    "lifetimeGiving": 52000,
    "lastGiftDate": "2024-03-15",
    "lastGiftAmount": 10000,
    "giftCount": 12,
    "fundDescription": "Major Gifts - Unrestricted"
  },
  "priority": "high"
}
```

**PATCH `/api/actions/:id/status`** — Update status
```javascript
// Body: { status: 'pending' | 'resolved' | 'open' }
// When changing to 'resolved': set resolvedAt = now, resolvedById = current user
// When changing from 'resolved' to 'open': clear resolvedAt and resolvedById
// Automatically create a system comment: "Chantal marked this as pending"
```

**POST `/api/actions/:id/comments`** — Add comment
```javascript
// Body: { content: "Called Mark today, lunch is set for next Thursday." }
// Creates an ActionComment linked to the action
// Returns the comment with author info
```

**PATCH `/api/actions/:id/reassign`** — Reassign
```javascript
// Body: { assignedToId: "uuid-of-mike" }
// Only the original assigner or admin can reassign
// Creates a system comment: "Glenn reassigned this from Chantal to Mike"
```

---

## Work Stream 3: Action Centre UI

### Navigation

Add "Action Centre" to the main navigation bar. Include a notification badge showing the count of open actions assigned to the current user. The badge should be a small indigo circle with white text, similar to how messaging apps show unread counts.

### Page Route

Create `src/routes/actions.js` (page routes, not API):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/actions` | Action Centre main page |
| GET | `/actions/:id` | Action detail page |

### Action Centre Main Page

Create `views/actions/index.ejs`:

This is a two-tab layout:

**Tab 1: "My Actions"** (default)
- Shows actions assigned TO the current user
- Three filter pills at the top: Open (default), Pending, Resolved
- Each action card shows:
  - Priority indicator (colored left border: normal=indigo, high=amber, urgent=red)
  - Title (bold)
  - Donor name with a small link icon (if donor is linked)
  - "Assigned by [name]" with their avatar, and relative timestamp ("2 hours ago")
  - Comment count icon
  - Status badge (open=indigo, pending=amber, resolved=green)
- Clicking a card navigates to the action detail page

**Tab 2: "Assigned by Me"**
- Shows actions the current user has assigned to others
- Same card layout but shows "Assigned to [name]" instead
- Admins see an additional tab: "All Actions" showing the full tenant view

### Action Detail Page

Create `views/actions/detail.ejs`:

Layout:
- **Header area**: Title, priority badge, status badge, assigned by → assigned to
- **Donor context card** (if donor is linked): Shows constituentName, lifetime giving, last gift date/amount, gift count, fund. This is the snapshot stored in `donorContext` JSONB. Include a "View Donor Profile" link if donor profiles exist.
- **Description**: Full text of the action description
- **Status controls**: Three buttons — "Mark Open", "Mark Pending", "Mark Resolved". Highlight the current status. Only show buttons for statuses the user can transition to.
- **Comment thread**: Chronological list of comments (both user comments and system comments). System comments should be styled differently (smaller, gray, italic, centered). User comments show avatar, name, timestamp, and content.
- **Comment input**: Text area with "Add Comment" button at the bottom

### Styling

Use the Fund-Raise brand system:
- Navy (#1A223D) for the header and dark elements
- Indigo (#3434D6) for primary actions, the "open" status badge, and normal priority
- Amber (#BA7517) for "pending" status and high priority
- Green (#1D9E75) for "resolved" status
- Red (#A32D2D) for urgent priority
- Snow (#EFF1F4) for card backgrounds
- Manrope font throughout
- Cards should have subtle borders (1px #D3D6E0), 8px border-radius
- Priority indicator: 4px left border on action cards, colored by priority

---

## Work Stream 4: Donor Profile Integration

### "Assign Action" from Donor Context

Wherever donor information appears in Fund-Raise (search results, AI query results, donor profile pages if they exist), add an "Assign Action" button or icon.

When clicked, open a modal or slide-out panel with:
- **To**: Dropdown of all users in the tenant (populated from User model, filtered by tenantId)
- **Title**: Auto-populated with "Follow up with [Donor Name]" (editable)
- **Description**: Empty text area for instructions
- **Priority**: Radio buttons — Normal (default), High, Urgent
- **Donor context**: Auto-populated from the available donor data (read-only display showing what will be attached)
- **"Assign" button**: Creates the action via POST `/api/actions`

The donor context should be assembled from CrmGift data:
```javascript
// When assigning an action from a donor context, query their gift history:
async function buildDonorContext(tenantId, constituentId) {
  const gifts = await CrmGift.findAll({
    where: { tenantId, constituentId },
    order: [['giftDate', 'DESC']]
  });
  
  if (gifts.length === 0) return null;
  
  const totalGiving = gifts.reduce((sum, g) => sum + (parseFloat(g.giftAmount) || 0), 0);
  const lastGift = gifts[0];
  const firstGift = gifts[gifts.length - 1];
  
  return {
    lifetimeGiving: Math.round(totalGiving * 100) / 100,
    giftCount: gifts.length,
    lastGiftDate: lastGift.giftDate,
    lastGiftAmount: parseFloat(lastGift.giftAmount) || 0,
    lastFund: lastGift.fundDescription,
    firstGiftDate: firstGift.giftDate,
  };
}
```

### Ask Fund-Raise AI Integration

This is the killer feature. When a user asks Ask Fund-Raise a question like "show me lapsed donors over $500" and gets results, they should be able to assign actions directly from the AI response.

**Implementation approach:**

1. When the AI returns donor-related results (lists of donors, LYBUNT/SYBUNT analysis, etc.), the AI's response should include structured data that the frontend can parse to render "Assign Action" buttons next to each donor name.

2. Add a new tool to the Ask Fund-Raise AI tool definitions:

```javascript
{
  name: 'create_action',
  description: 'Create an action/task for a team member to follow up with a donor. Use this when the user explicitly asks to assign a task, create a follow-up, or delegate an action to someone on their team.',
  input_schema: {
    type: 'object',
    properties: {
      assignedToName: {
        type: 'string',
        description: 'The name of the team member to assign this to'
      },
      title: {
        type: 'string',
        description: 'Short title for the action'
      },
      description: {
        type: 'string', 
        description: 'Detailed instructions or context'
      },
      constituentName: {
        type: 'string',
        description: 'Name of the donor this action is about'
      },
      constituentId: {
        type: 'string',
        description: 'The constituent ID from the CRM data'
      },
      priority: {
        type: 'string',
        enum: ['normal', 'high', 'urgent'],
        description: 'Priority level'
      }
    },
    required: ['assignedToName', 'title']
  }
}
```

3. When the AI invokes this tool, the backend should:
   - Look up the assignedToName in the User model (fuzzy match on first name, last name, or nickname)
   - If a unique match is found, create the action
   - If multiple matches or no match, return an error asking for clarification
   - Build donorContext automatically if constituentId is provided
   - Return confirmation to the AI so it can tell the user "Done — I've assigned a follow-up with Margaret Chen to Chantal."

4. This enables conversational workflows like:
   - User: "Show me major donors who haven't given this year"
   - AI: [returns list of 12 donors]
   - User: "Assign Margaret Chen to Chantal — she's friends with our board chair, set up a lunch"
   - AI: [calls create_action tool] "Done — I've created a high-priority action for Chantal to follow up with Margaret Chen. She'll see it in her Action Centre."

**Important:** The `create_action` tool should only be available to users with `admin` or `uploader` roles. Viewers cannot assign actions.

---

## Work Stream 5: Notification System

### In-App Notifications

When an action is created or updated, the affected users should see it:

1. **Nav badge**: The Action Centre nav item shows a count of open actions assigned to the current user. Load this count on every page via middleware (add to `res.locals` so it's available in all EJS templates).

2. **Action Centre page**: New actions appear at the top of the "My Actions" list with a subtle "new" indicator (small indigo dot) that disappears after the user views the action detail page.

3. **Track "last viewed"**: Add a `lastViewedAt` column to the Action model. When the assignee views the action detail page, update this timestamp. Actions where `updatedAt > lastViewedAt` (or lastViewedAt is null) are considered "new" and show the indicator.

Do NOT build email notifications at this time. Keep everything in-app.

---

## Important Notes

1. **Do not break existing functionality.** The Action Centre is additive — it should not modify any existing models, routes, or views. It adds new models (Action, ActionComment), new routes, and new views.

2. **Multi-tenant isolation is critical.** Every query must filter by `tenantId`. A user must never see actions from another tenant.

3. **The AI tool integration (Work Stream 4) should be built last**, after the core Action Centre UI is working. Get the manual create/view/update/comment flow working first, then wire in the AI tool.

4. **Use the existing Post/PostComment pattern as reference** for how comments work in the codebase. The Action/ActionComment pattern should feel similar in implementation.

5. **The department weekly snapshot upload system is DEPRECATED.** Do not reference or integrate with `Snapshot`, `DepartmentSummary`, `excelParser.js`, or any files in the legacy snapshot upload flow.

6. **Performance consideration**: The nav badge count query runs on every page load. Make sure it's a simple COUNT query with proper indexes on `assignedToId`, `tenantId`, and `status`. Add an index: `Action.addIndex(['tenantId', 'assignedToId', 'status'])`.

7. **Build in this order:**
   - Work Stream 1 (models) — commit
   - Work Stream 2 (API routes) — commit
   - Work Stream 3 (Action Centre UI) — commit
   - Work Stream 5 (notification badge + new indicators) — commit
   - Work Stream 4 (donor profile integration + AI tool) — commit
