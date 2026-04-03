# Fund-Raise Design System

Reference spec for Claude Code. Follow this document exactly when building Fund-Raise UI components.

---

## Philosophy

Fund-Raise is a SaaS dashboard for nonprofit foundations using Blackbaud Raiser's Edge. The design is **clean, flat, and institutional** — it should feel trustworthy and professional, not trendy. Think: a well-designed internal tool that a development officer actually wants to open every morning.

Key principles:
- **Flat surfaces, no decoration.** No gradients, drop shadows, glows, or noise textures. Ever.
- **White canvas, soft surface cards.** Content sits on a white background. Grouped data uses light gray surface cards.
- **Thin borders.** All borders are `0.5px solid` using the border color tokens below.
- **Generous whitespace.** Let the data breathe. Padding inside cards is always at least `14px`.
- **Data-forward.** Numbers are large and bold. Labels are small and muted. The hierarchy is always: number first, context second.

---

## Colors

### Brand palette (TBRHSF-derived)

```css
:root {
  --brand-dark-navy: #023D65;
  --brand-mid-blue: #2187C5;
  --brand-teal-blue: #1C7BB6;
  --brand-sky-blue: #52A9DE;
  --brand-gold: #D59D2C;
  --brand-coral: #E55A57;
}
```

### Usage rules

| Token | When to use |
|---|---|
| `--brand-mid-blue` (#2187C5) | Primary action buttons, active nav items, chart bar fills, send buttons, icon backgrounds |
| `--brand-dark-navy` (#023D65) | Headings when on light backgrounds (use sparingly — most headings use the neutral text color) |
| `--brand-gold` (#D59D2C) | Highlighted chart bars (e.g. peak months), secondary accent, announcement badges |
| `--brand-coral` (#E55A57) | Destructive actions only (delete, urgent alerts). Do NOT use for primary CTAs |
| `--brand-sky-blue` (#52A9DE) | Hover states on blue elements, lighter accent backgrounds |
| `--brand-teal-blue` (#1C7BB6) | Links, secondary interactive elements |

### Semantic colors (light mode)

```css
:root {
  /* Backgrounds */
  --bg-primary: #FFFFFF;           /* Page background, card surfaces */
  --bg-secondary: #F5F5F4;        /* Metric cards, surface areas, chart containers */
  --bg-success: #EAF3DE;          /* Success badges, positive alerts */
  --bg-warning: #FAEEDA;          /* Warning alerts, attention items */
  --bg-danger: #FCEBEB;           /* Error alerts, urgent items */
  --bg-info: #E6F1FB;             /* Info alerts, blue badges */

  /* Text */
  --text-primary: #1a1a1a;        /* Headings, numbers, primary content */
  --text-secondary: #737373;      /* Labels, descriptions, secondary content */
  --text-tertiary: #a3a3a3;       /* Timestamps, hints, placeholders */
  --text-success: #3B6D11;        /* Positive change indicators (+31% YoY) */
  --text-warning: #854F0B;        /* Warning text, caution indicators */
  --text-danger: #A32D2D;         /* Negative change indicators, error text */
  --text-info: #185FA5;           /* Links, info badge text */

  /* Borders */
  --border-light: rgba(0,0,0,0.08);   /* Card borders, dividers, table rows */
  --border-medium: rgba(0,0,0,0.15);  /* Hover states, input borders */
  --border-success: #97C459;
  --border-warning: #EF9F27;
  --border-danger: #F09595;
  --border-info: #85B7EB;
}
```

### Dark mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1a1a;
    --bg-secondary: #262626;
    --bg-success: #1a2e0a;
    --bg-warning: #2e2106;
    --bg-danger: #2e1313;
    --bg-info: #0a1e2e;

    --text-primary: #f5f5f5;
    --text-secondary: #a3a3a3;
    --text-tertiary: #737373;
    --text-success: #97C459;
    --text-warning: #EF9F27;
    --text-danger: #F09595;
    --text-info: #85B7EB;

    --border-light: rgba(255,255,255,0.08);
    --border-medium: rgba(255,255,255,0.15);
  }
}
```

---

## Typography

Use the system font stack. No custom fonts — this is an internal tool, not a marketing site.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

### Scale

| Element | Size | Weight | Color | Line-height |
|---|---|---|---|---|
| Page greeting ("Good evening, Torin") | 18px | 500 | `--text-primary` | 1.3 |
| Section headers ("Revenue by month") | 14px | 500 | `--text-primary` | 1.3 |
| KPI numbers ($4.2M) | 22px | 500 | `--text-primary` | 1.2 |
| KPI labels ("Total raised YTD") | 12px | 400 | `--text-secondary` | 1.4 |
| KPI change indicators (+31% YoY) | 12px | 400 | `--text-success` / `--text-warning` / `--text-danger` | 1.4 |
| Nav items | 13px | 400 | `--text-secondary` (inactive), `--text-info` + weight 500 (active) | 1 |
| Alert titles | 13px | 500 | semantic color (warning/info/danger) | 1.3 |
| Alert descriptions | 12px | 400 | `--text-secondary` | 1.4 |
| Activity feed names | 13px | 400 | `--text-primary` | 1.3 |
| Activity feed details | 12px | 400 | `--text-secondary` | 1.4 |
| Timestamps | 11px | 400 | `--text-tertiary` | 1 |
| Input placeholders | 12px | 400 | `--text-tertiary` | 1 |
| Suggestion chips | 12px | 400 | `--text-secondary` | 1.4 |
| Status badges ("RE connected") | 12px | 400 | semantic text color on semantic bg | 1 |
| Subheading ("FY 2025-26 · Q4 · synced...") | 13px | 400 | `--text-secondary` | 1.4 |

### Rules

- **Two weights only: 400 (regular) and 500 (medium).** Never use 600 or 700 — they look too heavy.
- **No bold mid-sentence.** Bold is for headings and standalone labels only.
- **Sentence case everywhere.** Never Title Case, never ALL CAPS.
- **No underlines on links.** Use color (`--text-info`) to indicate interactivity.

---

## Spacing

```
Page padding:          20px
Card internal padding: 14px (metric cards), 16px (content cards), 12px (alert cards)
Grid gap:              12px (metric card row), 16px (two-column layouts)
Section margin-bottom: 20px
Between section header and content: 12px
```

---

## Components

### 1. Top nav bar

```
Height:              ~52px
Background:          --bg-primary
Bottom border:       0.5px solid --border-light
Padding:             12px 20px
Layout:              flexbox, space-between, align-center

Left:                Logo icon (28x28px rounded square, --brand-mid-blue bg, white icon) + app name (15px, weight 500)
Center:              Nav items (13px, --text-secondary, 20px gap between items)
Right:               User avatar (28x28px circle, --bg-info bg, initials in --text-info, 11px weight 500)

Active nav item:     --text-info color, weight 500
Inactive nav item:   --text-secondary color, weight 400
```

### 2. Greeting bar

```
Layout:              flexbox, space-between, align-baseline
Margin-bottom:       16px

Left side:           Greeting (18px/500) on first line
                     Subtext (13px/400, --text-secondary) on second line, margin-top 2px

Right side:          Status badge — 12px, padding 4px 10px, border-radius 8px
                     Use semantic bg + text colors (e.g. --bg-success + --text-success for "RE connected")
```

### 3. Metric cards (KPI row)

```
Grid:                4 columns, repeat(4, minmax(0, 1fr)), gap 12px
Card background:     --bg-secondary
Border:              NONE (surface cards have no border)
Border-radius:       8px
Padding:             14px

Internal layout (top to bottom):
  Label:             12px, --text-secondary
  Number:            22px, weight 500, --text-primary, margin-top 4px
  Change indicator:  12px, semantic color, margin-top 4px
                     Prefix with + or - sign
                     Use --text-success for positive, --text-warning for slight negative, --text-danger for bad
```

### 4. Chart container

```
Background:          --bg-secondary
Border-radius:       8px
Padding:             16px
Height:              160px (adjust to content)

Bar chart bars:
  Background:        --brand-mid-blue (default), --brand-gold (highlighted/peak months)
  Border-radius:     3px 3px 0 0 (rounded top only)
  Opacity:           Scale from 0.5 (smallest) to 1.0 (largest) based on value
  Gap between bars:  6px
  Layout:            flexbox, align-items flex-end

Axis labels:         11px, --text-tertiary, centered below each bar
```

### 5. AI assistant panel ("Ask Fund-Raise")

```
Background:          --bg-secondary
Border-radius:       8px
Padding:             16px

Suggestion chips:
  Background:        --bg-primary
  Border:            0.5px solid --border-light
  Border-radius:     8px
  Padding:           6px 10px
  Font:              12px, --text-secondary
  Layout:            vertical stack, 6px gap

Input row:
  Layout:            flexbox, 8px gap
  Input:             flex 1, 12px font, 6px 10px padding, 28px height
  Send button:       28x28px, --brand-mid-blue bg, border-radius 8px, white arrow icon (14x14px)
```

### 6. Alert cards ("Needs attention")

```
Layout:              vertical stack, 8px gap

Each alert:
  Padding:           12px
  Background:        semantic bg color (--bg-warning, --bg-info, --bg-danger)
  Border-radius:     0 (NOT rounded — the left accent border replaces rounding)
  Border-left:       3px solid semantic border color
  
  Title:             13px, weight 500, semantic text color
  Description:       12px, --text-secondary, margin-top 2px
```

### 7. Activity feed

```
Each row:
  Padding:           10px 0
  Border-bottom:     0.5px solid --border-light (omit on last row)
  Layout:            flexbox, space-between, align-center

  Left side:
    Name:            13px, --text-primary
    Details:         12px, --text-secondary (amount · fund name)

  Right side:
    Timestamp:       11px, --text-tertiary
```

### 8. Status badges

```
Padding:             4px 10px
Border-radius:       8px
Font:                12px, weight 400
Background + text:   Use matching semantic pair (e.g. --bg-success + --text-success)
```

---

## Layout

### Page structure

```
Full page → white background (--bg-primary)
  └─ Top nav bar (full width, bordered bottom)
  └─ Content area (padding: 20px)
       └─ Greeting bar
       └─ KPI metric cards (4-col grid)
       └─ Middle section (2-col grid: chart 1fr + AI panel 280px)
       └─ Bottom section (2-col grid: alerts 1fr + activity feed 1fr)
```

### Grid rules

- Use `minmax(0, 1fr)` instead of bare `1fr` to prevent content overflow.
- The AI panel has a fixed width of `280px` on desktop.
- Below 768px, collapse all grids to single column.
- Gap is always `12px` for metric cards, `16px` for section grids.

---

## Interactions

### Hover states
- Nav items: color transition to `--text-primary`
- Suggestion chips: border color to `--border-medium`, slight bg darken
- Activity feed rows: background to `--bg-secondary`
- All transitions: `150ms ease`

### Click behavior
- Metric cards: navigate to detailed breakdown page
- Alert cards: open action modal or navigate to relevant donor list
- Activity feed rows: open donor profile
- Suggestion chips: populate the AI input with that text
- Chart bars: show tooltip with exact amount, or filter dashboard by that month

---

## Iconography

Use simple inline SVGs only. No icon libraries, no emoji, no image files.

```
Logo mark:       Star/spark shape, white on --brand-mid-blue rounded square (28x28, radius 6px)
Send arrow:      Right-pointing arrow, white, 14x14px, 1.5px stroke, round linecap
Nav search:      Magnifying glass SVG if needed
User avatar:     Initials circle (no image) — 28x28, --bg-info bg, --text-info text, 11px
```

---

## What NOT to do

- No gradients anywhere
- No box shadows or drop shadows
- No blur or glow effects
- No rounded corners on alert cards with left borders
- No font weights above 500
- No ALL CAPS text
- No emoji in the UI
- No decorative elements (dots, patterns, illustrations)
- No colored backgrounds on the page itself (always white/--bg-primary)
- No nested scroll areas
- No more than 4 metric cards in a row
- No chart legends inside the chart canvas — put them above or below as HTML

---

## File structure recommendation

```
src/
  components/
    layout/
      TopNav.jsx
      PageLayout.jsx
    dashboard/
      GreetingBar.jsx
      MetricCard.jsx
      MetricCardRow.jsx
      RevenueChart.jsx
      AskPanel.jsx
      AlertCard.jsx
      AlertList.jsx
      ActivityFeed.jsx
      ActivityRow.jsx
    shared/
      StatusBadge.jsx
      SuggestionChip.jsx
  styles/
    tokens.css          /* All CSS variables defined here */
    global.css          /* Reset, base typography, body styles */
  pages/
    Dashboard.jsx       /* Composes all dashboard components */
```

---

## Quick reference: building a new page

When creating any new page in Fund-Raise, follow this pattern:

1. Start with `<PageLayout>` (provides nav + padding)
2. Add a `<GreetingBar>` or page header (18px/500 title + 13px/400 subtitle)
3. Use `<MetricCardRow>` for top-level KPIs (max 4 cards)
4. Use 2-column grid (`1fr 280px` or `1fr 1fr`) for content sections
5. Section headers are always 14px/500 with 12px margin-bottom
6. Use `--bg-secondary` surface cards to group related data
7. Use semantic alert cards for actionable items
8. Use activity feed pattern for chronological lists

Every page should answer: "What are the key numbers, what needs attention, and what just happened?"
