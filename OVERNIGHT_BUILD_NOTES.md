# Overnight Build Notes

Built: 2026-04-04
Branch: `claude/add-conversational-ai-oP0KM`

---

## Feature 1: Staff Profiles

### What was built
- **Profile fields** added directly to the existing `users` table (nickname, jobTitle, bio, localAvatarPath) rather than creating a separate staff_profiles table. Reasoning: the fields are 1:1 with users and adding columns avoids JOINs everywhere. The `updatedAt` column was also enabled on the User model (previously it was `false`).
- **Avatar uploads** via Multer, stored in `public/uploads/avatars/` with filename `<userId>.<ext>`. Max 5 MB, image types only.
- **My Profile page** (`/profile`) with live preview card and edit form
- **Staff Directory page** (`/directory`) with card grid showing all active team members
- Helper methods on User model: `displayName()` (nickname > name > email) and `avatarSrc()` (local upload > Google avatar)

### Files created/modified
- `src/models/user.js` — added profile columns, `displayName()`, `avatarSrc()`
- `src/routes/profile.js` — new: GET /profile, GET /directory, GET /api/profile/:userId, PUT /api/profile, POST /api/profile/avatar, GET /api/staff
- `views/profile/edit.ejs` — My Profile page with live preview
- `views/profile/directory.ejs` — Staff Directory card grid
- `public/uploads/avatars/` — directory for uploaded avatar files
- `public/css/style.css` — profile and directory CSS
- `views/partials/header.ejs` — added sidebar nav items + profile edit icon in user section

### Decisions made
- Added columns to `users` table instead of a separate `staff_profiles` table (simpler, fewer JOINs)
- Local avatar takes priority over Google avatar (user can override their Google photo)
- Profile edit icon (pencil) placed next to user info at bottom of sidebar for quick access

### Things to test
- Upload a profile photo and verify it appears in the directory and sidebar
- Set a nickname and verify it appears across the app
- Check that `sync({ alter: true })` correctly adds the new columns on startup

---

## Feature 2: Message Board

### What was built
- **Post and PostComment models** with full CRUD
- **Message Board feed** (`/board`) with category filters, pagination, and "New Post" modal
- **Post detail page** (`/board/post/:id`) with comment thread, inline commenting
- **Categories**: Announcement, Question, Idea, General, Shout-Out — each with distinct color badges
- **Pinning**: admins can pin/unpin posts; pinned posts sort to top with gold left border and pin badge
- **Permissions**: any user can create posts/comments, users can only edit/delete their own, admins can delete anything and pin/unpin

### Files created/modified
- `src/models/post.js` — Post model
- `src/models/postComment.js` — PostComment model
- `src/models/index.js` — registered models and associations
- `src/routes/board.js` — all board routes and API endpoints
- `views/board/feed.ejs` — message board feed page
- `views/board/post.ejs` — individual post detail page
- `public/css/style.css` — board styles, modal styles, category badges

### Decisions made
- Used integer auto-increment IDs for posts/comments (consistent with other models like User)
- Comment counts are batch-loaded via SQL GROUP BY for the feed (avoids N+1)
- Post body is plain text with `white-space: pre-wrap` (no rich text editor — keeps it simple)
- Category filter uses client-side pill buttons that refetch from the API
- "Load More" button for pagination instead of infinite scroll

### Things to test
- Create a post in each category, verify badges display correctly
- Pin a post as admin, verify it appears at top
- Comment on a post, verify comment count updates in feed
- Try to delete someone else's post as a non-admin (should fail)

---

## Feature 3: Writing Assistant

### What was built
- **Writing Assistant page** (`/writing-assistant`) with split layout: input form on left, streamed output on right
- **Three writing modes**: Draft from scratch, Polish/edit my draft, Reply to a message
- **Six content types**: Thank you letter, Sympathy/condolence card, Donor email, Event invitation, Follow-up email, General correspondence
- **Four tones**: Warm & personal, Professional & formal, Celebratory, Empathetic
- **SSE streaming**: response streams in real-time to a textarea
- **Editable output**: after generation, the textarea becomes editable so users can tweak before copying
- **Copy to clipboard**: one-click copy of the final text
- **System prompt**: establishes the AI as a hospital foundation communications writer, uses Canadian English, mode-specific instructions

### Files created/modified
- `src/routes/writing.js` — page route + SSE streaming API endpoint
- `views/writing/assistant.ejs` — full writing assistant UI
- `public/css/style.css` — writing assistant layout and option pill styles

### Decisions made
- Used SSE streaming (same pattern as Ask Fund-Raise chat) for real-time output
- Context label and placeholder change dynamically based on selected mode
- System prompt references TBRHSF specifically and instructs Canadian English spelling
- Output is plain text in a textarea (not rich text) — simpler and more practical for copy/paste into email clients
- Used `claude-sonnet-4-20250514` model (same as Ask Fund-Raise) with 2048 max tokens

### Things to test
- Generate a thank you letter and verify streaming works
- Switch to "Polish my draft" mode and paste some text
- Copy the output and verify it pastes cleanly
- Check that it uses Canadian English spelling (honour, centre, etc.)

---

## Sidebar Navigation Changes

Added to sidebar (in order):
1. **Team** section: Staff Directory, Message Board
2. **Tools** section: Writing Assistant
3. Profile edit icon (pencil) next to user name at bottom

---

## General Notes

- All new routes use `ensureAuth` middleware for authentication
- All new pages follow the existing `<%- include('../partials/header') %>` / `<%- include('../partials/footer') %>` pattern
- CSS follows the existing design system (Poppins font, brand blue/navy/gold, same radius/spacing variables)
- All new database tables will be auto-created by `sequelize.sync({ alter: true })` on startup
- No new npm dependencies were needed (Multer was already installed for upload routes)
- The `public/uploads/avatars/` directory was created but should be added to `.gitignore` if you don't want uploaded files in the repo
