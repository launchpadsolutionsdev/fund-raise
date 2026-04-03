# TBRHSF Brand Colors

Brand color palette for Thunder Bay Regional Health Sciences Foundation, extracted from [healthsciencesfoundation.ca](https://www.healthsciencesfoundation.ca).

---

## Primary Blues

| Swatch | Name | Hex | RGB | Usage |
|--------|------|-----|-----|-------|
| 🟦 | Dark Navy | `#023D65` | `rgb(2, 61, 101)` | Footer, nav background, dark headings |
| 🟦 | Mid Blue | `#2187C5` | `rgb(33, 135, 197)` | Wave backgrounds, links, section headers |
| 🟦 | Teal Blue | `#1C7BB6` | `rgb(28, 123, 182)` | Section headings, secondary links |
| 🟦 | Sky Blue | `#52A9DE` | `rgb(82, 169, 222)` | Wave accents, lighter backgrounds |

## Warm Accents

| Swatch | Name | Hex | RGB | Usage |
|--------|------|-----|-----|-------|
| 🟨 | Gold / Amber | `#D59D2C` | `rgb(213, 157, 44)` | Announcement bar text, logo accent |
| 🟥 | Coral Red | `#E55A57` | `rgb(229, 90, 87)` | Donate buttons, CTA highlights |

## Neutrals

| Swatch | Name | Hex | RGB | Usage |
|--------|------|-----|-----|-------|
| ⬜ | White | `#FFFFFF` | `rgb(255, 255, 255)` | Page background, card surfaces |
| ⬛ | Near Black | `#333333` | `rgb(51, 51, 51)` | Body text |

---

## CSS Variables

```css
:root {
  --tbrhsf-dark-navy: #023D65;
  --tbrhsf-mid-blue: #2187C5;
  --tbrhsf-teal-blue: #1C7BB6;
  --tbrhsf-sky-blue: #52A9DE;
  --tbrhsf-gold: #D59D2C;
  --tbrhsf-coral: #E55A57;
  --tbrhsf-white: #FFFFFF;
  --tbrhsf-text: #333333;
}
```

## Tailwind Config

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        tbrhsf: {
          'dark-navy': '#023D65',
          'mid-blue': '#2187C5',
          'teal-blue': '#1C7BB6',
          'sky-blue': '#52A9DE',
          'gold': '#D59D2C',
          'coral': '#E55A57',
        },
      },
    },
  },
};
```

---

> **Note:** These values were sampled from the live site and may differ slightly from the official brand guide. Confirm with the Foundation's brand assets if exact fidelity is required.
