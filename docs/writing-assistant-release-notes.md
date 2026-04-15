# Writing Assistant — What's New

A complete overhaul of the AI writing tools across Fund-Raise. Five generators now share a single, polished foundation that learns from your team and gets better the more you use it.

---

## In one sentence

Every generation your team produces is now grounded in real donor data, automatically saved to a searchable library, rated for quality, and quietly used to make the next generation a little more *yours*.

---

## What's new across all five writing tools

The same upgrades now apply to **Writing Assistant**, **Thank-You Letters**, **Impact Stories**, **Meeting Prep**, and **Weekly Digest**.

### 1. A shared library — every generation auto-saved

Every piece the AI writes for you is now kept in your library — no more losing a draft because you closed the tab. From any generator you can:

- **Browse history** in a side drawer (most-recent first)
- **Re-open** an earlier generation to copy or revise
- **Star (⭐ Save)** the ones you'd run again
- **Rate** any output (👍 helpful, neutral, 👎 not helpful) with optional notes
- **Hide** items you don't want cluttering history (the row stays for analytics, but you'll never see it)

### 2. Quick Start templates

Above each generator's form, a row of one-click presets — "Major Donor — Warm," "Sympathy Card," "Annual Report Narrative," "Board Briefing," and so on. Click one and the form fills in. Your team's saved patterns can also become tenant-specific templates (see the Brand Voice section below).

### 3. Polished, consistent UI

The donor-lookup field, feedback toolbar, history drawer, and Quick Start rail were all extracted into a shared module so every generator looks and behaves the same way. Switch between Thank-You and Impact Story and you're not learning a new tool.

### 4. Rate-limited and cost-aware

Each generator now has its own rate limit so a runaway script can't run up your AI bill. Behind the scenes, every generation is tracked alongside Ask Fund-Raise usage in the same accounting table, so admins see one true number for AI spend.

### 5. Faster + cheaper through prompt caching

Repeated generations from the same person now hit Anthropic's prompt cache, which means responses come back faster and cost about 10% of normal for the cached portion. Especially noticeable when you're iterating on the same letter.

---

## Thank-You Letters — special upgrades

Thank-Yous are the most-used writing feature, so they got extra polish:

### Donor Lookup

Type a donor's name into the new lookup field and the AI sees:
- Their lifetime giving total and gift count
- Date of their first and most recent gift
- Their typical gift size and designations they've supported
- Special notes (recurring donor, board member, etc. where applicable)

The letter the AI writes will reference real history rather than generic "thank you for your support." This is the single biggest quality jump in the whole release.

### Quick Start Templates

Five styles ready to go — Warm, Formal, Brief, Handwritten, Impact-focused — each with sensible defaults you can edit before generating.

---

## Brand Voice — make the AI sound like *your* Foundation

A new admin page at **Settings → Brand Voice** lets you configure how the AI writes for your entire organization:

- **Tone description** in your own words ("Warm and conversational — we speak to donors like neighbours, not clients")
- **Core values** you want every piece to reflect
- **Preferred vocabulary** ("use *partner* instead of *donor*")
- **Banned words and phrases** (we already excluded common ones; this is for your own pet peeves)
- **Signature block** used verbatim when a letter calls for one
- **Catch-all guidance** for anything else the AI should know

Once configured, every AI generation in your tenant — across all five tools — uses your voice without anyone having to remember to mention it in a prompt.

### Two switches at the top

- **Brand voice active** — kill switch to fall back to platform default without losing your config
- **Learn from saved examples** — see the next section

---

## The Learning Loop — how the tools get better the more you use them

This is the headline of the release. The Writing Assistant now genuinely improves with use, in three ways:

### 1. Saved generations become exemplars

When your team ⭐ Saves a generation, the platform automatically uses it as a style reference on future runs of the same feature. The AI sees up to three of your most recent saves (preferring ones rated helpful) and is told to match their voice, structure, and level of detail — without copying them verbatim.

In practice: save four warm thank-yous you love → every future thank-you for your tenant subtly drifts toward sounding like those four. No prompt-tweaking required.

You can turn this off from the Brand Voice settings page if you'd rather the AI stick to its defaults.

### 2. Repeated patterns become one-click templates

A new admin page at **Settings → Writing Templates** watches for patterns in what your team saves. When the same combination (e.g. "thank-you, formal style, gift over $1000") has been saved three or more times, it surfaces as a suggestion:

> *"Your team has saved this combination 4 times — make it a one-click template?"*

One click promotes it into the Quick Start rail for everyone in your Foundation. The suggestion disappears automatically once promoted, and you can archive any tenant template later.

### 3. Variant testing under the hood (admin-only)

Behind the scenes, the platform now runs prompt variants and tracks which version produces the best results on your team's actual ratings. A new admin page at **Settings → Writing Analytics** shows:

- Total generations per feature, per variant
- Helpful rate (👍 ratings ÷ total ratings)
- Save rate (⭐ saves ÷ total generations)
- Cache hit rate (cost efficiency)
- Average response time
- A "Winning" badge when one variant clearly outperforms others

When a winner emerges, the platform team can promote it for everyone — without you having to do anything.

---

## Cross-tenant Benchmarks — see where you stand

Inside the Writing Analytics dashboard, every rate now shows a small badge:

> Helpful rate: **78.3%** &nbsp; <span>+5.2 pp</span>

Green means you're above the platform average; red means below; grey means roughly the same. The "platform" side is pooled across every other Foundation using Fund-Raise — never your own numbers — so you get an honest comparison.

### Privacy

- Your tenant is **always excluded** from the platform pool ("you vs everyone else," not "you vs everyone including you")
- Benchmarks for any feature only appear once **at least 3 other Foundations** have contributed in the period — so no individual organization can ever be inferred
- We never expose any other Foundation's tenant ID, name, content, or per-tenant metrics — only pooled rates

---

## New Admin Pages

| Page | What it does |
|---|---|
| **Settings → Brand Voice** | Configure your tenant's writing voice, kill switches for voice and exemplars |
| **Settings → Writing Analytics** | Per-feature usage, variant comparison, vs-platform benchmarks, "Winning" badges |
| **Settings → Writing Templates** | Pattern suggestions ready to promote, plus your team's existing tenant templates |

All three are admin-only.

---

## What stayed the same

- Existing prompts and feature behaviour are backwards-compatible — anything that worked yesterday still works the same way
- No new login or permissions
- No additional cost per generation (caching actually reduces AI spend)
- Your existing ratings, favourites, and history (if any) carry forward

---

## Quick start checklist for your team

1. **Admins:** Visit **Settings → Brand Voice** and write a paragraph or two about how your Foundation sounds. Set a signature block. Save.
2. **Everyone:** Use any of the five writing tools as you normally would. Click ⭐ when you produce something you'd want to send again.
3. **Tip:** Try the new donor-lookup field on a Thank-You. Notice how the letter changes when the AI knows the donor's history.
4. **After ~20 saves across your team:** Admins should check **Settings → Writing Templates** to see what patterns have emerged and promote the useful ones.
5. **Periodically:** Admins can check **Settings → Writing Analytics** to see where your team's helpful rate sits relative to the platform.

---

## What's coming next

The plan we delivered closes the loop end-to-end, but a few natural extensions are on the radar:

- **Statistical significance testing** for variant comparison (current "Winning" badge is heuristic-based)
- **Embedding-based template clustering** (current clustering matches on identical settings — a v2 could group semantically similar saves)
- **Personal templates** (today templates are tenant-wide; user-personal scope is reserved in the schema for a future release)

None of these are blocking; the current release stands on its own.
