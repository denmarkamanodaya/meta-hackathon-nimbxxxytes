# Phase 15: UI/UX redesign (PWA + Mac), phased plan for owner review

Source: mocks by teammate `ux-redesign`, https://claude.ai/artifact/K5MEntZULmBio64LD3hLin (local copy
`docs/design/redesign/nimbytes-redesign.html`): a 25-row audit, 6 phone screens (P1–P6), 4 Mac
screens (M1–M4) and 3 token changes. **No code until the owner approves this plan.**

## Owner rulings (2026-10-27)

| # | Question | Ruling |
| --- | --- | --- |
| 1 | Productions before Phase 14 works | **Hidden** until it works (no "Soon" entry) |
| 2 | Tab name | **Studio** |
| 3 | "Asked before · free" in search results | **Keep** (pitch point) |
| 4 | Mac default theme | **Light** by default. System / Light / Dark stays as a setting |
| 5 | Tier 1 before 4 Nov | **Agreed** (the five tier 1 rows) |
| 6 | Approved screens on the design canvas | **Agreed**: a new "Redesign" row (rule 11) |

## Rules that apply
- Mock-first is satisfied for the screens on the canvas row. Build exactly what was approved.
- Tokens only. Light is the PWA look; the Mac follows its setting with Light as the default.
- The 3 token changes go in `web/src/design/tokens.css` and must pass the existing contrast and
  no-raw-colour tests.
- Unit tests for pure rules only (owner ruling R1, Phase 14). Web gates: `npm run lint`,
  `npm test`, `npm run build`, `npm run build:desktop`. Desktop gates when Rust changes.
- Local commits; no push or deploy without the owner's word. Each phase ends with a mock-mode
  check (`dev:mock` :5175, `dev:desktop-mock` :5176) and screenshots against the canvas row.
- Phase 14 (Studio backend) runs in parallel. Its screens are built after 15.1 on the new Studio
  shell.

## Phases

| Phase | Deliver | Fixes (audit) | Effort | Depends on |
| --- | --- | --- | --- | --- |
| **15.0 Canvas + groundwork** | Approved screens added to the design canvas as "Redesign" (teammate). The 3 token changes (warning colour light + subtle, `--state-cloud/cached/kept` aliases, `--font-size-tab` 12 px). Mac default theme = Light. One shared copy list (`web/src/core/copy.ts`, a single home for user-facing strings both builds share) | C1, A1 (tokens) | S | — |
| **15.1 Tier 1: true claims and clarity** | (a) Storage copy fix on PWA and Mac: no tiering words; one drive path `~/nimbytes`. (b) Three-step processing labels (Uploading → Understanding → Ready) on tiles and the upload queue: a pure mapping from pipeline step to label, with a test. (c) P2 Search: Select button, labelled 44 px checkboxes, persistent bar "N moments · 0:15 · Make a short", plain badges, "Refined by Muse Spark · 2.5 s" and "Asked before · free". (d) Shorts → **Studio** rename (tab, Mac sidebar group), "New short", status words ("Paused at draft 1 · Resume", "Editor score 44/50"). Productions hidden | H2, S3 (part), S1, S2 (part), Q1, Q2, N1, F1, S6 | S×4 | — |
| **15.2 Tier 1: Mac "On this Mac" (M3)** | Desktop: add per-clip drive state to the native status (cached bytes, last read, pinned), exposing what the chunk cache already knows; additive fields, optional in the web parser. Web: the M3 page replaces Sync (big number, before/during/after strip, 3-minute countdown, Kept offline list, Settings moved out). The sidebar shows the "On this Mac" meter | S3, S5, N3 | M | Desktop status fields |
| **15.3 Tier 2** | M1/M2 Mac Library: sidebar regrouped (Library, People & pets, Studio, On this Mac meter, Settings ⌘,), availability icon on every tile and a legend, filter chips. P1 Library reorder (ask field first, one storage line, one "getting ready" card). P6 Upload (warning banner, picker on top, time left). P4 People face cards + inline "Suggest matches" switch | S4, H1, A2, U1, S7, P1, P2 | M + S + S + M | 15.2 (drive state) |
| **15.4 Tier 3** | P3 Clip detail (Moments / People / Said switch, scrubber markers, sticky action). M4 Mac Studio › Shorts grid + inspector (score, editor note, Final Cut / Reveal). P5 Shorts 4:5 grid. "+" create sheet (New production row waits for Phase 14) | A3, H3, N2 | M + M + S | — |

Order before 4 Nov: 15.0 → 15.1 → 15.2 (tier 1). 15.3 and 15.4 if time allows, after the demo
video is recorded on tier 1.

## Parallel work (dk-agents)
- `ux-redesign`: 15.0 canvas row now (mock work, approved).
- A web teammate builds 15.1 (a)–(d). Small and independent; one commit per item.
- The lead does 15.2's desktop status fields (Rust), then a web teammate builds the M3 page.
- Phase 14 `studio-api` keeps going on the backend.

## Checks per phase (owner, by hand)
- 15.1: no "tier" or "cheaper" wording anywhere; tiles show 3 steps; Search Select → bar → Make a
  short works; the tab says Studio; Productions is not visible.
- 15.2: "On this Mac" shows the real bytes; play a clip and see it rise, then fall after about 3 min;
  a pinned clip stays under "Kept offline".
- 15.3–15.4: screens match the canvas row.

## Open items
- The teammate did not check the rendered mock page; People & pets (P4) may be cut off. The canvas
  row check covers this.
- Changing the Mac theme default to Light affects users who never chose. Their saved choice wins
  once set.
