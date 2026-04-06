# Fund-Raise Brand Guidelines
### Claude Code Reference Guide

---

## Overview

Fund-Raise is an AI-powered philanthropy dashboard for nonprofit foundations. It provides a conversational interface over Raiser's Edge NXT databases, enabling fundraising staff to interact with complex donor data through natural language. The brand should feel **authoritative, modern, and trustworthy** — sophisticated enough to signal cutting-edge AI, approachable enough for nonprofit executives who aren't tech-forward.

---

## Logo

The logo is written as **FundRaise** (one word, camelCase) in the wordmark, paired with a geometric mark icon.

### Logo Variants
| Variant | Use Case |
|---------|----------|
| **Primary** | Default — websites, presentations, marketing materials |
| **Secondary** | Alternate color for when primary doesn't suit the background |
| **Tertiary** | Additional flexibility across different backgrounds |

### Logo Mark
The standalone mark (without wordmark) comes in primary, secondary, and tertiary color variants.

### Clear Space
Minimum clear space = **1/4 of the logo's total height** on all sides. No text, graphics, or other visual elements may enter this zone.

---

## Colors

### Primary Palette

| Name | HEX | Usage |
|------|-----|-------|
| **Snow** | `#EFF1F4` | Light backgrounds, cards, surfaces |
| **Navy** | `#1A223D` | Primary dark — backgrounds, text, headers |
| **Indigo** | `#3434D6` | Primary accent — CTAs, active states, key UI elements |
| **Blue** | `#1960F9` → `#0D8CFF` | Gradient — buttons, highlights, brand moments |
| **Cyan** | `#12DEFF` → `#29C8F9` | Gradient — secondary accents, data viz, AI indicators |

### Grayscale Palette

| Name | HEX | Token |
|------|-----|-------|
| **Cloud** | `#EDEFF7` | Lightest grey — subtle backgrounds |
| **Smoke** | `#D3D6E0` | Borders, dividers |
| **Steel** | `#BCBFCC` | Disabled states, placeholder text |
| **Space** | `#9DA2B3` | Secondary text, captions |
| **Graphite** | `#6E7180` | Body text (on light backgrounds) |
| **Arsenic** | `#40424D` | Strong body text |
| **Phantom** | `#1E1E24` | Near-black — headings on light backgrounds |
| **Black** | `#000000` | Pure black — use sparingly |

### CSS Variables (recommended)

```css
:root {
  /* Primary */
  --fr-snow: #EFF1F4;
  --fr-navy: #1A223D;
  --fr-indigo: #3434D6;
  --fr-blue-start: #1960F9;
  --fr-blue-end: #0D8CFF;
  --fr-cyan-start: #12DEFF;
  --fr-cyan-end: #29C8F9;

  /* Grayscale */
  --fr-cloud: #EDEFF7;
  --fr-smoke: #D3D6E0;
  --fr-steel: #BCBFCC;
  --fr-space: #9DA2B3;
  --fr-graphite: #6E7180;
  --fr-arsenic: #40424D;
  --fr-phantom: #1E1E24;
  --fr-black: #000000;

  /* Semantic aliases */
  --fr-bg-primary: var(--fr-navy);
  --fr-bg-surface: var(--fr-snow);
  --fr-text-primary: var(--fr-phantom);
  --fr-text-secondary: var(--fr-graphite);
  --fr-text-on-dark: #FFFFFF;
  --fr-accent: var(--fr-indigo);
  --fr-gradient-blue: linear-gradient(135deg, var(--fr-blue-start), var(--fr-blue-end));
  --fr-gradient-cyan: linear-gradient(135deg, var(--fr-cyan-start), var(--fr-cyan-end));
}
```

---

## Typography

### Font Family
**Manrope** — used across all brand communications.

Available via Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

```css
font-family: 'Manrope', sans-serif;
```

### Weights

| Weight | Name | CSS Value |
|--------|------|-----------|
| 300 | Light | `font-weight: 300` |
| 400 | Regular | `font-weight: 400` |
| 500 | Medium | `font-weight: 500` |
| 600 | SemiBold | `font-weight: 600` |
| 700 | Bold | `font-weight: 700` |
| 800 | ExtraBold | `font-weight: 800` |

### Type Scale

| Element | Size | Suggested Weight |
|---------|------|-----------------|
| **Heading 1** | 64px | Bold / ExtraBold |
| **Heading 2** | 48px | Bold |
| **Subheader 1** | 32px | SemiBold |
| **Subheader 2** | 24px | SemiBold |
| **Paragraph 1** | 18px | Regular / Medium |
| **Paragraph 2** | 16px | Regular |

### CSS Implementation

```css
h1 { font-size: 64px; font-weight: 700; }
h2 { font-size: 48px; font-weight: 700; }
h3 { font-size: 32px; font-weight: 600; }
h4 { font-size: 24px; font-weight: 600; }
p  { font-size: 18px; font-weight: 400; }
.small { font-size: 16px; font-weight: 400; }
```

---

## Brand Tone

- **Authoritative** — Fund-Raise knows nonprofit data and AI
- **Modern / Cutting-edge** — signals future-ready technology
- **Trustworthy** — reliability that legacy orgs need before adopting new tools
- **Approachable** — sophisticated but never intimidating

---

## Quick Reference for Claude Code

When building Fund-Raise UI components:

1. **Always use Manrope** as the font family
2. **Navy (`#1A223D`)** is the primary dark color — use for dark-mode backgrounds and key text
3. **Indigo (`#3434D6`)** is the primary accent — buttons, links, active indicators
4. **Blue-to-cyan gradients** for brand moments, hero sections, AI-related UI
5. **Snow (`#EFF1F4`)** for light surfaces, cards, input backgrounds
6. Maintain the **type scale hierarchy** — don't invent new sizes
7. Use **grayscale tokens by name** for consistent text/border treatment
8. Logo clear space is always **1/4 of logo height** — don't crowd it

---

*Fund-Raise © 2026 / All rights reserved*
