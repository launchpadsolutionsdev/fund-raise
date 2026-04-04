# Ask Fund-Raise — Enhanced AI Assistant Build Prompt

> **Paste this entire prompt into Claude Code to begin implementation.**

---

## Context

I'm building **Fund-Raise**, a monolithic Node.js/Express internal philanthropy dashboard for nonprofit foundations. The first client is the Thunder Bay Regional Health Sciences Foundation (TBRHSF).

**Existing tech stack:**
- Node.js (v18+), Express, EJS (server-rendered, no SPA)
- Sequelize ORM, PostgreSQL (Render-hosted)
- Anthropic Claude API (`claude-sonnet-4-20250514`) for AI features
- Passport.js + Google OAuth 2.0
- Chart.js, Custom CSS (Poppins font, brand colors: #0072BB, #143D8D, #FFAA00)
- Multer for file uploads
- Hosted on Render.com

**Existing AI chat feature ("Ask Fund-Raise"):**
- There is already a working conversational AI assistant at `/api/ai/*`
- It uses SSE streaming to stream Claude responses to the browser
- It supports conversation CRUD (create, list, get, delete conversations)
- It has a `Conversation` data model in Sequelize
- The system prompt currently focuses on analyzing fundraising data from snapshots
- The frontend is an EJS-rendered chat interface

**Existing Blackbaud integration:**
- There is already a `BlackbaudToken` model for storing OAuth tokens
- There are existing routes at `/api/blackbaud/*` for OAuth flow and connection status
- The SKY API OAuth2 flow (authorization code grant) is already implemented
- Token refresh logic exists
- Environment variables for Blackbaud are already configured: `BLACKBAUD_CLIENT_ID`, `BLACKBAUD_CLIENT_SECRET`, `BLACKBAUD_REDIRECT_URI`, `BLACKBAUD_SUBSCRIPTION_KEY`

---

## What I Need You to Build

I want to upgrade Ask Fund-Raise from a simple data Q&A chatbot into a **unified AI assistant with three new capabilities**, all within the same chat interface. Users should be able to seamlessly move between capabilities in a single conversation — no separate tools or pages.

### Capability 1: RE NXT Screenshot Troubleshooting

**What it does:** Users upload a screenshot of their Raiser's Edge NXT screen (error messages, confusing UI, query builder, reports) and ask "help me with this" or "how do I fix this." The AI analyzes the image and provides step-by-step guidance.

**Implementation requirements:**

1. **Extend the existing chat to accept image uploads.** The chat input should have an image attachment button (paperclip or camera icon). When a user attaches an image:
   - Use Multer to handle the upload (you can store in memory buffer, no need to persist to disk)
   - Convert the image to base64
   - Send it to the Claude API as an image content block alongside the user's text message
   - The image should appear as a thumbnail preview in the chat message bubble

2. **The Claude API call should include the image.** Use the multi-modal message format:
   ```javascript
   messages: [
     {
       role: "user",
       content: [
         {
           type: "image",
           source: {
             type: "base64",
             media_type: "image/png", // or image/jpeg
             data: base64ImageData
           }
         },
         {
           type: "text",
           text: "How do I fix this error?"
         }
       ]
     }
   ]
   ```

3. **Frontend chat UI changes:**
   - Add an attachment button to the chat input area
   - Show image preview before sending (with ability to remove)
   - Display uploaded images inline in the chat message history
   - Support paste from clipboard (Ctrl+V / Cmd+V) for screenshots
   - Accept `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` formats
   - Max file size: 5MB

### Capability 2: RE NXT How-To & Query Building Guidance

**What it does:** Users ask natural language questions like "How do I pull all donors who gave over $1,000 last year?" or "How do I set up a recurring gift acknowledgment?" and the AI provides detailed, RE NXT-specific step-by-step instructions.

**Implementation requirements:**

1. **Build a comprehensive RE NXT knowledge base** as a text file or set of text files that get injected into the system prompt. This knowledge base should cover:

   - **Query building in RE NXT:** How to create queries, filter criteria, output fields, query types (constituent, gift, action, membership), using AND/OR logic, date range filters, gift amount filters
   - **Common report tasks:** Running built-in reports, customizing report parameters, exporting to Excel, scheduling reports
   - **Gift entry & batch processing:** Single gift entry, batch entry, recurring gifts, pledges, pledge payments, matching gifts, soft credits, tributes
   - **Constituent management:** Adding constituents, merging duplicates, constituent codes, relationships, addresses, communication preferences
   - **Acknowledgment & receipting:** Setting up acknowledgment templates, running acknowledgment processes, tax receipts (Canadian context — important for TBRHSF)
   - **Import/export:** Importing data, export definitions, using the Import module
   - **Common errors & fixes:** Typical error messages users encounter and how to resolve them
   - **Web view vs. database view:** What's available in each, when to use which
   - **Lists vs. Queries:** The distinction in RE NXT between smart lists (web view) and traditional queries (database view)

2. **Create the knowledge base file** at something like `data/renxt-knowledge-base.md`. Populate it with as much practical, step-by-step guidance as possible. This is the core value — the more specific and detailed, the better. Think of it as replacing a $10,000/year support contract. Use the structure below as a starting framework, but expand it significantly:

   ```markdown
   # Raiser's Edge NXT Knowledge Base

   ## Queries
   ### How to Create a New Query
   [Step-by-step with specific menu paths, e.g., "Go to Lists > Query > Add New"]

   ### Common Query Examples
   #### All donors who gave $1,000+ in current fiscal year
   [Specific filter criteria, output fields to select]

   ## Gift Entry
   ### Adding a Single Gift
   [Step-by-step]

   ... etc.
   ```

3. **This knowledge base should be injected CONDITIONALLY using keyword routing** — see the "Cost Optimization: Keyword Routing" section below for full details. Do NOT always include it.

### Capability 3: Live CRM Donor Lookup via SKY API

**What it does:** Users ask natural language questions like "Summarize Torin Gunnell's giving history" or "What was our biggest gift last month?" and the AI queries the Blackbaud SKY API in real-time to fetch and summarize the data.

**IMPORTANT: This capability is gated by role.** Only users with `admin` or `uploader` roles may use CRM lookup tools. Users with `viewer` role should receive a message like: "CRM lookups are available to team members with elevated access. Please ask your administrator if you need this capability." This protects donor-level data access.

**Implementation requirements:**

1. **Implement Claude tool-use (function calling)** in the Ask Fund-Raise AI. Define tools that the AI can invoke when it needs live CRM data. The tools should map to SKY API endpoints:

   **Tool: `search_constituent`**
   - Input: `{ search_text: string }` (name or lookup ID)
   - Calls: `GET https://api.sky.blackbaud.com/constituent/v1/constituents/search?search_text={search_text}`
   - Returns: Array of matching constituents with IDs, names, lookup IDs

   **Tool: `get_constituent`**
   - Input: `{ constituent_id: string }`
   - Calls: `GET https://api.sky.blackbaud.com/constituent/v1/constituents/{constituent_id}`
   - Returns: Full constituent record (name, address, email, phone, etc.)

   **Tool: `get_constituent_giving_summary`**
   - Input: `{ constituent_id: string }`
   - Calls: These SKY API endpoints:
     - `GET /gift/v1/constituents/{id}/gifts` — list of all gifts
     - `GET /gift/v1/constituents/{id}/gifts/first` — first gift
     - `GET /gift/v1/constituents/{id}/gifts/greatest` — largest gift
     - `GET /gift/v1/constituents/{id}/gifts/latest` — most recent gift
     - `GET /gift/v1/constituents/{id}/givingsummary/lifetimegiving` — lifetime totals
   - Returns: Compiled giving profile

   **Tool: `list_constituent_gifts`**
   - Input: `{ constituent_id: string, limit?: number }`
   - Calls: `GET https://api.sky.blackbaud.com/gift/v1/constituents/{constituent_id}/gifts`
   - Returns: Paginated list of gifts with dates, amounts, types, funds, campaigns

   **Tool: `get_gift_detail`**
   - Input: `{ gift_id: string }`
   - Calls: `GET https://api.sky.blackbaud.com/gift/v1/gifts/{gift_id}`
   - Returns: Full gift record including splits, soft credits, tributes

2. **Tool execution flow:**
   - User asks a question in the chat
   - Send the message to Claude with tool definitions
   - If Claude decides to use a tool, it returns a `tool_use` content block
   - Your server executes the corresponding SKY API call (using the stored Blackbaud OAuth token)
   - Send the tool result back to Claude as a `tool_result` message
   - Claude synthesizes the data into a natural language response
   - Stream the final response to the user via SSE
   - **Handle the case where Blackbaud is not connected** — if no valid token exists, the AI should tell the user to connect their Blackbaud account first (link to the existing OAuth setup page)

3. **SKY API helper service:**
   - Create a service file (e.g., `services/blackbaudApi.js`) that wraps all SKY API calls
   - Include automatic token refresh (tokens expire after 60 minutes)
   - Include the subscription key header: `Bb-Api-Subscription-Key: {BLACKBAUD_SUBSCRIPTION_KEY}`
   - Include proper error handling for rate limits (SKY API has daily call limits)
   - Include pagination handling for list endpoints (SKY API uses `next_link` for pagination)
   - **Implement a lightweight in-memory cache** (e.g., using `node-cache` or a simple Map with TTL) for SKY API responses. Cache constituent search results and giving summaries for 10 minutes. This prevents redundant API calls when a user asks follow-up questions about the same donor in the same session. Log cache hits so we can monitor effectiveness.

4. **Important SKY API details:**
   - Base URL: `https://api.sky.blackbaud.com`
   - Auth header: `Authorization: Bearer {access_token}`
   - Subscription header: `Bb-Api-Subscription-Key: {subscription_key}`
   - All responses are JSON
   - List endpoints return `{ count, next_link, value: [...] }`
   - Rate limit: ~1,000 calls/day on our current tier
   - At 5 SKY API calls per donor lookup, that gives us ~200 lookups/day — sufficient for a team of 5-10 but worth monitoring
   - **Add a daily call counter** (simple in-memory counter that resets at midnight) and log a warning when usage exceeds 80% of the daily limit. If the limit is hit, the AI should tell the user: "We've reached our daily CRM lookup limit. This resets overnight — in the meantime, I can still help with RE NXT questions and fundraising analytics."

---

## Cost Optimization: Keyword Routing for Knowledge Base Injection

**This is critical for keeping API costs reasonable.**

A single donor lookup with the base system prompt costs ~$0.02 USD. With the full RE NXT knowledge base loaded, it jumps to ~$0.05 USD. Over hundreds of daily messages across a team, this adds up. The knowledge base should only be injected when it's actually needed.

**Implement a keyword detection function** in a new file `services/knowledgeBaseRouter.js` that runs before building the Claude API request:

```javascript
function shouldInjectRENXTKnowledgeBase(message, conversation) {
  const renxtKeywords = [
    'raiser', 'raisers edge', 'renxt', 're nxt', 'nxt',
    'query', 'queries', 'report', 'export', 'import',
    'constituent', 'batch', 'gift entry', 'acknowledgment', 'acknowledgement',
    'receipt', 'tax receipt', 'merge', 'duplicate',
    'web view', 'database view', 'list', 'smart list',
    'blackbaud', 'error', 'help me with this', 'how do i',
    'troubleshoot', 'screenshot', 'stuck', 'confused',
    'campaign', 'fund', 'appeal', 'solicitor',
    'soft credit', 'tribute', 'pledge', 'recurring gift',
    'membership', 'relationship', 'spouse', 'organization'
  ];

  const lowerMessage = message.toLowerCase();

  // Check current message for RE NXT keywords
  if (renxtKeywords.some(kw => lowerMessage.includes(kw))) return true;

  // Check if conversation has been flagged as RE NXT help session
  if (conversation?.isRenxtSession) return true;

  // Check if message includes an image (likely a screenshot for troubleshooting)
  if (message.hasImage) return true;

  return false;
}
```

**Additional routing rules:**
- If the knowledge base is injected for any message in a conversation, set a **sticky flag** (`isRenxtSession: true`) on the Conversation model so subsequent messages in the same thread also get the knowledge base. This prevents the AI from "forgetting" RE NXT context mid-conversation.
- Add a boolean column `is_renxt_session` to the `Conversation` model. It will auto-sync via `sequelize.sync({ alter: true })`.
- When the knowledge base is NOT needed (e.g., "what are our year-to-date numbers?"), the system prompt stays lean — just the base identity, fundraising data context, and tool definitions.

---

## Cost Optimization: Anthropic Prompt Caching

**Implement prompt caching to cut input token costs by up to 90% on repeat messages.**

The system prompt, tool definitions, and RE NXT knowledge base are identical across every API call. Anthropic's prompt caching lets you pay full price once, then subsequent requests read from cache at 10% of the base input price. The cache TTL is 5 minutes — since your team will be sending multiple messages in quick succession, most calls will hit cache.

**Implementation:**

Add a `cache_control` field to the system prompt content block:

```javascript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  system: [
    {
      type: 'text',
      text: systemPromptText, // your full system prompt (base + optional knowledge base)
      cache_control: { type: 'ephemeral' }  // Enables automatic caching
    }
  ],
  tools: tools, // tool definitions — these also benefit from caching
  messages: conversationMessages
});
```

**Cost impact:**
- Without caching: 50 messages/day ≈ $1.05/day ≈ $32/month
- With caching: 50 messages/day ≈ $0.55/day ≈ $17/month (~50% savings)
- With caching + keyword routing: most non-RE-NXT messages cost ~$0.01 each

**Note:** The Anthropic Node SDK (`@anthropic-ai/sdk`) supports this natively. Check the existing `package.json` to see what version is installed and upgrade if needed.

---

## Cost Optimization: Token Usage Logging

**Log token usage on every API call so we can monitor actual costs.**

The Claude API response includes a `usage` object. Log this after every call:

```javascript
console.log(`[Ask Fund-Raise] Tokens — input: ${response.usage.input_tokens}, output: ${response.usage.output_tokens}, cache_read: ${response.usage.cache_read_input_tokens || 0}, cache_creation: ${response.usage.cache_creation_input_tokens || 0}`);
```

This lets us calculate actual monthly costs and validate that keyword routing and caching are working as expected.

---

## Unified System Prompt Architecture

The Ask Fund-Raise system prompt should establish the AI as a **unified fundraising assistant** that can:

1. **Analyze fundraising data** (existing capability — keep this working)
2. **Troubleshoot RE NXT** from screenshots and descriptions
3. **Guide users** through RE NXT tasks with step-by-step instructions
4. **Look up live donor data** from the CRM via tool-use

Here's the system prompt structure to use:

```
You are Ask Fund-Raise, the AI assistant for Fund-Raise — a philanthropy intelligence platform for nonprofit foundations. You serve fundraising professionals who use Blackbaud Raiser's Edge NXT (RE NXT) as their CRM.

You have three core capabilities:

1. FUNDRAISING ANALYTICS — You can analyze the foundation's fundraising data including department performance, gift trends, year-over-year comparisons, and projections. When users ask about "our numbers," goals, or performance, use the snapshot data provided in the conversation context.

2. RE NXT EXPERT — You are an expert in Blackbaud Raiser's Edge NXT. You can:
   - Analyze screenshots of the RE NXT interface and help users troubleshoot errors or navigate the system
   - Provide step-by-step instructions for any RE NXT task (queries, reports, gift entry, constituent management, imports/exports, acknowledgments, etc.)
   - Explain the difference between web view and database view features
   - Help users build queries with specific filter criteria and output fields
   Reference the RE NXT Knowledge Base below for detailed guidance.

3. LIVE CRM LOOKUP — When users ask about specific donors, gifts, or constituent records, you can search the CRM in real-time using the available tools. Use tools when users ask things like:
   - "Look up [donor name]"
   - "Summarize [person]'s giving history"
   - "What was [person]'s last gift?"
   - "Find donors named [name]"
   If the Blackbaud integration is not connected, let the user know they need to connect it first via Settings.
   If CRM tools are not available for this user's role, let them know CRM lookups require elevated access.

GUIDELINES:
- Be warm, professional, and concise
- Use Canadian English spelling (honour, favourite, centre, etc.)
- When providing RE NXT instructions, use specific menu paths and field names
- When summarizing donor data from the CRM, format currency as CAD and include key metrics (lifetime giving, first/last gift dates, largest gift, giving frequency)
- Never fabricate donor data — only report what the CRM returns
- If you're unsure about an RE NXT feature, say so rather than guessing
- When analyzing screenshots, describe what you see and provide actionable next steps
- Do NOT attempt bulk data queries that would exhaust our daily API limit (e.g., "list all donors who gave last month"). Instead, guide the user to run that query directly in RE NXT and offer to help them build it.
```

**The RE NXT knowledge base block is appended ONLY when keyword routing determines it's needed:**

```
[RE NXT KNOWLEDGE BASE]
{contents of data/renxt-knowledge-base.md — only injected when shouldInjectRENXTKnowledgeBase() returns true}
[/RE NXT KNOWLEDGE BASE]
```

**The CRM tool definitions are ONLY included when the user has the `admin` or `uploader` role AND Blackbaud is connected:**

```javascript
// In the AI route handler:
const tools = [];
if (user.role === 'admin' || user.role === 'uploader') {
  const bbToken = await BlackbaudToken.findOne({ where: { tenantId: user.tenantId } });
  if (bbToken) {
    tools.push(searchConstituentTool, getConstituentTool, getGivingSummaryTool, listGiftsTool, getGiftDetailTool);
  }
}
// If tools array is empty, Claude simply won't attempt CRM lookups
```

---

## File Structure

Here's where new files should go (fitting into the existing monolithic structure):

```
fund-raise/
├── data/
│   └── renxt-knowledge-base.md          # NEW — RE NXT knowledge base
├── services/
│   ├── blackbaudApi.js                  # NEW — SKY API wrapper service with caching
│   └── knowledgeBaseRouter.js           # NEW — keyword routing logic
├── routes/
│   └── api/
│       └── ai.js                        # MODIFY — add image support, tool-use, prompt caching, keyword routing
├── models/
│   └── Conversation.js                  # MODIFY — add is_renxt_session boolean column
├── views/
│   └── partials/
│       └── chat.ejs                     # MODIFY — add image upload UI
├── public/
│   └── js/
│       └── chat.js                      # MODIFY — add image handling + paste support
│   └── css/
│       └── chat.css                     # MODIFY — add image preview styles
```

---

## Implementation Order

Please build in this order:

1. **First:** Create `services/knowledgeBaseRouter.js` with the keyword detection function and conversation flagging logic
2. **Second:** Create `data/renxt-knowledge-base.md` with comprehensive RE NXT guidance
3. **Third:** Update the system prompt in the AI route to include the unified prompt structure, conditional knowledge base injection via the router, and Anthropic prompt caching (`cache_control: { type: 'ephemeral' }`)
4. **Fourth:** Add token usage logging on every Claude API call
5. **Fifth:** Add image upload support to the chat (frontend + backend + Claude API multi-modal)
6. **Sixth:** Create `services/blackbaudApi.js` with SKY API wrapper functions, in-memory response caching (10-minute TTL), and daily call counter with 80% warning threshold
7. **Seventh:** Implement Claude tool-use in the AI route with the CRM lookup tools, gated behind role-based access (admin/uploader only)
8. **Eighth:** Handle edge cases:
   - Blackbaud not connected → friendly message directing to Settings
   - Blackbaud token expired → auto-refresh, or prompt to re-authenticate if refresh fails
   - SKY API rate limit hit → friendly message explaining the daily limit resets overnight
   - No search results → "I couldn't find a constituent with that name. Try a different spelling or lookup ID."
   - User is a `viewer` trying CRM lookup → polite message about elevated access
   - Image upload fails or is too large → clear error message
   - Claude API errors → graceful fallback message

---

## Important Notes

- **Do NOT break existing functionality.** The current chat, conversation history, and data analysis features must continue to work.
- **Do NOT convert to a SPA or React.** Keep the EJS server-rendered architecture.
- **Match existing styling.** Use the existing CSS variables and design patterns (Poppins font, brand colors #0072BB, #143D8D, #FFAA00, existing card/panel styles).
- **The app uses `sequelize.sync({ alter: true })`** so any new model fields will auto-sync. No migration files needed.
- **Test with the existing Google OAuth flow** — all features should work for authenticated users only.
- **Start by reading the existing codebase** before making changes. Understand the current AI route, chat frontend, and Blackbaud integration code first.
- **Cost awareness:** Every design decision should consider API costs. The keyword routing + prompt caching combination should keep per-message costs under $0.03 USD for most interactions.

---

## Before You Start

**Read these files first to understand the existing codebase:**
1. The main AI route file (likely `routes/api/ai.js`)
2. The chat frontend (likely `views/partials/chat.ejs` or similar)
3. The chat JavaScript (likely `public/js/chat.js`)
4. The Blackbaud routes/service (likely `routes/api/blackbaud.js`)
5. The `BlackbaudToken` model
6. The `Conversation` model
7. The existing system prompt (wherever it's defined in the AI route)
8. The `package.json` to check the Anthropic SDK version (needs to support prompt caching and tool-use)

Then proceed with implementation in the order specified above.
