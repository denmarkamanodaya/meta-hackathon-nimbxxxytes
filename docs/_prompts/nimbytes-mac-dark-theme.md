# nimbytes for Mac — Dark theme ("Midnight")

Implementation brief and guidelines for coding agents. Source of truth for the visuals: the "Mac dark theme: Midnight" row on the nimbytes design canvas (D0–D5).

---

## Part 1 — Structured prompt (paste this to the coding agent)

```
ROLE
You are implementing the dark theme ("Midnight") for the nimbytes macOS app.

GOAL
Add a dark appearance to every Mac screen (Library, Shorts, Sync, First run,
Menu bar extra) that matches the approved mocks D0–D5. Dark is the default
look for a storage-first editing tool: the footage is the colour, the chrome
steps back.

SCOPE
- In: the macOS app only — main window, sidebar, cards, controls, badges,
  first-run window, menu bar extra.
- Out: the PWA / phone screens, the logo, layout or copy changes, new features.

CONSTRAINTS
1. Theme through semantic tokens only (Part 2). No hard-coded hex values in
   views or components. If a token is missing, add it to the token file;
   don't inline a colour.
2. Keep the existing light theme working. Both themes resolve the same token
   names. Default to following the system appearance; add an in-app override:
   System / Light / Dark.
3. Don't change spacing, layout, copy or behaviour, except for what this brief
   lists under "Component specs".
4. Keep the logo tile as is (#0B6E85 with a white cloud). Don't recolour it
   to the accent.
5. Don't mention any other product or company name in code, comments,
   commits or docs.

DELIVERABLES
- One token definition (colours, radii, type, elevation) with light and dark
  values.
- The components refactored to read tokens: Sidebar, NavItem, Card,
  StatCard, Button (primary/secondary/quiet), Badge, SearchField, TextField,
  ClipTile, ProgressBar, MenuBarMenu.
- A theme override setting stored in user preferences.
- Screenshots of each screen in dark mode next to the matching mock (D1–D5).

ACCEPTANCE
- Every screen visually matches its mock within normal rendering tolerance.
- All text meets WCAG AA (4.5:1 for body text, 3:1 for large text and UI
  boundaries). Run the contrast table in Part 2 §7 as a test.
- No raw hex values outside the token file (grep check).
- Switching appearance at runtime updates every window without a relaunch.
- Light theme screenshots are unchanged against the current baseline.

WORK ORDER
1) Tokens  2) Primitives (Button, Badge, fields)  3) Shell (window frame,
sidebar, content panel)  4) Screens D1→D5  5) Theme setting  6) QA checklist
(Part 2 §9). Open one PR per step, or group steps that are small.
```

---

## Part 2 — Guidelines

### 1. Principles

- **Layered, not bordered.** You tell surfaces apart by lightness steps, not by lines. Dark mode has almost no borders.
- **One accent.** The accent marks the primary action, the active page and live progress, and nothing else. Never use it as a large fill behind content.
- **Footage first.** Thumbnails and previews carry the colour. Chrome stays neutral.
- **Pill controls.** Buttons, the search field and badges are fully rounded.

### 2. Colour tokens

| Token | Dark | Light (current) | Use |
|---|---|---|---|
| `bg.frame` | `#000000` | `#F3F5F4` | Window background behind the panels |
| `bg.panel` | `#121212` | `#F3F5F4` / `#FFFFFF` sidebar | Sidebar and main content panels |
| `bg.card` | `#181818` | `#FFFFFF` | Cards, stat tiles, clip cards |
| `bg.raised` | `#242424` | `#F3F5F4` | Inputs, search field, active nav, hovered/selected rows |
| `bg.hover` | `#2E2E2E` | `#EEF2F2` | Hover on raised items, neutral badges |
| `bg.menu` | `#282828` | `#FFFFFF` | Menus and popovers |
| `text.primary` | `#FFFFFF` | `#0D1B1E` | Headings, body |
| `text.muted` | `#A7A7A7` | `#52646A` | Secondary text, captions, shortcut keys |
| `text.onAccent` | `#000000` | `#FFFFFF` | Text and icons on accent fills |
| `border.subtle` | `#3E3E3E` | `#DCE3E2` | Menu outline, separators (decorative only) |
| `border.control` | `#7C7C7C` | `#7B8898` | Secondary button outline, input outline (must be ≥3:1) |
| `accent` | `#1ED2DC` | `#0B6E85` | Primary action, active indicator, progress, key numbers |
| `accent.hover` | `#4FDDE5` | `#08566A` | Hover/pressed on accent |
| `success` | `#3DDC84` | `#0F7A4F` | Status dots, "Up to date" mark |
| `success.text` | `#5BE39A` | `#0B5F3C` | Success text on dark |
| `success.tint` | `rgba(61,220,132,.16)` | `#E3F3EA` | Success badge background |
| `warning` | `#FFA94D` | — | Reserved for budget/space warnings |
| `overlay.scrim` | `rgba(0,0,0,.55)` | `rgba(13,27,30,.45)` | Over thumbnails (uploading state) |
| `overlay.chip` | `rgba(0,0,0,.70)` | `rgba(0,0,0,.58)` | Duration chips, badges on thumbnails |
| `brand.tile` | `#0B6E85` | `#0B6E85` | Logo tile only. Same in both themes |

Accent alternatives that passed review (keep them as a config option, not shipped UI): green `#1ED760`, blue `#7C9CFF`. All three keep black text at ≥8:1.

> Note: the mock's text-field outline uses `#3E3E3E`, which fails the 3:1 boundary rule on `#242424`. Use `border.control` (`#7C7C7C`) for input outlines instead.

### 3. Shell layout (dark only)

- Window: `bg.frame` with **8 px padding** and an **8 px gap** between the sidebar and main panels.
- Sidebar and main: `bg.panel`, **10 px radius**. This "floating panels" frame is dark only; light keeps the current flush layout.
- Sidebar width 232 px, unchanged.
- Main panel padding: 28/32 px (Library, Shorts) and 40/48 px (Sync), unchanged.

### 4. Typography

No changes to families or sizes: Bricolage Grotesque 700 for display, Geist for UI, Geist Mono for timecodes, durations and paths. Changes in dark:

- Button labels, nav labels, badge text and card titles go up to **weight 700** (600 for nav), because thin weights look weak on black.
- Page titles: 30 px (was 28). Card headings: 19 px (was 17–18).
- Muted text is always `text.muted`. Never lower its opacity.

### 5. Radii and elevation

| Token | Value | Use |
|---|---|---|
| `radius.panel` | 10 | Sidebar, main panel |
| `radius.card` | 12 (14 for the Sync hero card) | Cards, clip cards |
| `radius.tile` | 10 | Thumbnails |
| `radius.field` | 8 | Text fields (first run) |
| `radius.pill` | 999 | Buttons, search field, badges, progress |
| `shadow.tile` | `0 8px 24px rgba(0,0,0,.5)` | Thumbnails |
| `shadow.preview` | `0 12px 32px rgba(0,0,0,.6)` | Short preview |
| `shadow.menu` | `0 16px 40px rgba(0,0,0,.6)` | Menu bar menu |

### 6. Component specs

**Button**
- Primary: `accent` fill, `text.onAccent`, weight 700, pill, height 44 (48 in the Library header, 52 on first run), horizontal padding 22–24. Hover: `accent.hover`.
- Secondary: transparent, 1 px `border.control`, `text.primary`, weight 700, pill.
- Quiet: transparent, `text.muted`, turns `text.primary` on hover.

**NavItem (sidebar)**
- Default: `text.muted`, weight 600, height 40, radius 8.
- Active: `bg.raised` with `text.primary`, plus a **4×18 px accent bar** at the left edge (−6 px offset).
- Hover: `bg.raised` at 60%, with `text.primary`.

**SearchField**: pill, height 48, `bg.raised`, a white search icon, `text.muted` placeholder. Focus: 1 px `accent` ring.

**TextField (first run)**: height 48, radius 8, `bg.raised`, 1 px `border.control`. Focus: `accent` border plus a 1 px `accent` outer ring.

**Card / StatCard**: `bg.card`, no border, radius 12. Stat value: Bricolage 26 px. The hero number ("0 bytes") uses `accent`.

**ClipTile**
- Wrapper card: `bg.card`, padding 12, radius 12. On hover the wrapper changes to `bg.raised`, and a **40 px round accent play button** appears at the bottom-right of the thumbnail (black glyph, `shadow.tile`).
- Duration chip: `overlay.chip`, Geist Mono 11.
- "On Mac" badge: `overlay.chip` background, `success.text`.
- Uploading: `overlay.scrim` over the thumbnail, a white label and a 4 px progress bar (track `rgba(255,255,255,.25)`, fill `accent`). The caption line shows "40% · 4.1 of 10 MB".

**Badge**: pill, height 22–24, weight 700. Variants: neutral (`bg.hover` / `text.primary`), success (`success.tint` / `success.text`), accent (`accent` / `text.onAccent`, used only for "Original" on the selected timeline row).

**Timeline row (Shorts)**: the selected row gets `bg.raised` and an `accent` timecode. Other rows are transparent with a muted timecode.

**Status block (Sync)**: a 48 px `success` circle with a black check, the title "Up to date" in Bricolage 24, and a space-used row on `bg.raised`.

**MenuBarMenu**: `bg.menu`, 1 px `border.subtle`, radius 12, `shadow.menu`. The highlighted item uses an `accent` fill with black text. Separators are `border.subtle`. The template icon is white on dark. Use the system menu-bar template-image behaviour if the menu is native.

### 7. Contrast (verified — keep as a unit test)

| Foreground | Background | Ratio | Need |
|---|---|---|---|
| `#A7A7A7` muted | `#121212` | 7.79 | 4.5 ✅ |
| `#A7A7A7` muted | `#242424` | 6.45 | 4.5 ✅ |
| `#A7A7A7` muted | `#282828` | 6.13 | 4.5 ✅ |
| `#1ED2DC` accent text | `#121212` | 10.09 | 4.5 ✅ |
| `#000000` on accent | `#1ED2DC` | 11.31 | 4.5 ✅ |
| `#000000` on success | `#3DDC84` | 11.77 | 4.5 ✅ |
| `#5BE39A` success text | `#121212` | 11.51 | 4.5 ✅ |
| `#FFA94D` warning | `#121212` | 9.84 | 4.5 ✅ |
| `#7C7C7C` control border | `#121212` | 4.49 | 3.0 ✅ |
| `#3E3E3E` subtle border | `#242424` | 1.45 | decorative only ⚠️ |

### 8. Don'ts

- Don't use pure white surfaces or large accent-coloured fills in dark mode.
- Don't use drop shadows on cards. Shadows are only for thumbnails, the preview and menus.
- Don't add borders to separate cards. Use the layer steps.
- Don't put white text on the accent colour.
- Don't recolour the thumbnails. Don't add gradients or glows.

### 9. QA checklist

- [ ] D1 Library, D2 Shorts, D3 Sync, D4 First run and D5 Menu bar each match their mock.
- [ ] Switching System → Dark → Light live updates every open window and the menu bar extra.
- [ ] The override persists across relaunch.
- [ ] Hover, focus and pressed states exist for: nav, buttons, clip tile, search field, text fields, menu items.
- [ ] A keyboard focus ring (`accent`, 2 px) is visible on every interactive element.
- [ ] Contrast test (§7) passes.
- [ ] `grep` finds no hex colours outside the token file.
- [ ] Light-mode screenshot baseline is unchanged.
- [ ] Increase Contrast (macOS accessibility setting) raises `border.subtle` to `#7C7C7C` and `text.muted` to `#C8C8C8`.
