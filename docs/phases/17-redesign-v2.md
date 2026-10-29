# Phase 17: redesign v2 (Mac) + storage cap (Phase 16), build plan

Approved 2026-10-28 by the owner: "mocks approved. we must comply the same exact approved mocks/screens".
The **source of truth for every screen** is the canvas https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3.
A local copy is in `docs/design/redesign-v2/*.dc.html`. Build exactly what it shows: layout, copy,
sizes and states. The storage cap plan is `docs/phases/16-storage-cap.md` (approved, local stack risk
accepted).

## Defaults for the canvas questions (the owner approved the canvas with its recommendations)

- The name is **Projects**.
- Projects are Mac first. The API is generic, and the PWA gets Projects later.
- **Night** is the Mac default. Light / Match my Mac stay in Settings › Appearance.
  - Change the Mac default theme from Light to Dark in the appearance service. A saved choice still
    wins.
- The renames apply to both builds through `web/src/core/copy.ts`:
  - Library → Gallery;
  - People & pets → Faces;
  - Said → Speech;
  - Brand kit → Brand.

## Contract (the single source both sides build against)

### Storage
- `GET /api/storage` keeps its fields and adds:
  - `used_bytes: u64`: everything under the account's `users/{id}/` prefix in R2;
  - `cap_bytes: u64`;
  - `level: "ok" | "warn" | "high" | "full"`: warn ≥ 80%, high ≥ 95%, full when no room is left.
- The new error code `STORAGE_FULL` (HTTP 507) goes in `web/src/services/api/error-codes.json`.
  It is returned by:
  - upload start;
  - the proxy presign;
  - render, export, storyboard, cover and brand upload presign;
  - anything else that writes to R2 for the user.
- The cap value lives in server config: `[storage] account_cap_gb = 250`.

### Projects (migration `0010_projects.sql`)
- Tables:
  - `projects(id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT, updated_at TEXT)`;
  - `project_clips(project_id, clip_id, added_at, PK(project_id, clip_id))`, with cascade on project
    or clip delete.
- `color` is one of `orange | green | blue | purple | pink | grey`. Name rules: trimmed, 1–60 chars,
  unique per user (case-insensitive), else `VALIDATION_FAILED`.
- Endpoints:
  - `GET /api/projects` returns `[{project_id, name, color, clip_count, duration_s, size_bytes, created_at}]`,
    newest first.
  - `POST /api/projects {name, color, clip_ids?: string[]}` returns that project.
  - `PATCH /api/projects/{id} {name?, color?}` returns that project.
  - `DELETE /api/projects/{id}` returns 204. Clips are never touched.
  - `POST /api/projects/{id}/clips {clip_ids}` returns that project (idempotent).
  - `DELETE /api/projects/{id}/clips/{clip_id}` returns 204.
  - `GET /api/clips?project={id}` filters the clip list.
- Each clip list item gains `project_ids: string[]`, plus `speech_count` (transcript turns) and
  `face_count` (visible face tracks, hidden excluded) for the Has speech / Has faces chips and the
  Faces column.
- `size_bytes` on clip list items: the Gallery list view needs a size column. Add it if missing.

## Phases (local commits on `main`; no push or deploy until the owner says)

| Phase | Owner | Deliver |
| --- | --- | --- |
| 17.1 API | teammate `api-v2` | Storage cap per Phase 16 (pure allow/deny rule with tests, `BlobStore::used_bytes(prefix)` on the R2 adapter, usage row + refresh, `STORAGE_FULL` on every R2 write path, `GET /api/storage` fields). Projects (migration, domain rules + tests, use cases, routes, contracts, TS mirror in `types.ts`). Drop the stale S3 resting/frequent wording in the summary docs (keep the fields; they are part of the contract) |
| 17.2 Mac shell + Gallery | teammate `web-gallery` | Copy renames. Sidebar exactly as `Sidebar.dc.html` (teal active text + icon, no pill, Projects list + "+", Studio group, On this Mac meter, Settings ⌘,). Three-column shell. Gallery V1 grid (square tiles, availability badge, duration, selected ring) and V2 list (square 40 px thumbs, columns), toolbar (search ⌘K, chips, sort, grid/list switch, size slider), right column (preview, title/meta, availability line, Moments/Speech/Faces tabs, Make a short, offline switch, Add to project, Show in Finder, More), right-click menu + Add to project submenu, Project page V4 + New project sheet. Storage meter + warn/full states |
| 17.3 Player, Faces, Settings | teammate `web-player` | V3 player (all controls in the mock, keyboard keys, moment ticks + speech dots, hover preview, captions from Speech, in/out + "Make a short from this range", right column Speech following playback with "Use in short"/"Copy"). V5 Faces page + right column. V6 Settings window with 7 sections (Brand moves here from its sheet). Night default |
| 17.4 Close | lead | Merge, gates, a desktop-mock screenshot of each screen next to its canvas board, a Mac dev build for the owner, STATUS/LEARNING/MEMORY |

Order:
- 17.1 runs alongside 17.2 and 17.3.
- The web teammates build against mock fixtures (`dev:desktop-mock` :5176) that follow the contract
  above, then against the local API once 17.1 lands.
- `web-gallery` owns the shell, the sidebar and the right-column component (`ClipPanel`).
- `web-player` reuses `ClipPanel` after `web-gallery` commits it. Until then it starts with Settings
  and Faces.

## Gates

- api: `cargo fmt --check`, `clippy -D warnings`, `cargo test`.
- web: `npm run lint`, `npm test`, `npm run build`, `npm run build:desktop`.
- Unit tests only for pure rules and parsers (owner ruling R1).
- Mutation-check the cap rule.
