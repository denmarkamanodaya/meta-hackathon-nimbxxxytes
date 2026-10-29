# Phase 18: compact Short, Production and Productions pages, delete production, direct Upload (v2.0.1)

Approved 2026-10-28 by the owner: "approved all". Canvas https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3,
boards V7, V8, V9a, V9b, V10a and V10b. The local copy is in `docs/design/redesign-v2/`:
`ShortPage`, `ProductionPage`, `UploadPicker`, `Uploading` (Main with `uploading`), `ProductionsList` and
`ProductionDelete`. Build exactly what the boards show. Mac build; the PWA keeps working.

After the build: commit, push, deploy, tag v2.0.1, build the DMG and install it on the owner's Mac
(the owner pre-approved all of this).

| Part | Owner | Deliver |
| --- | --- | --- |
| 18.1 Native folder pick | lead | `pick_folder_and_upload` → `{queued}`. It opens the folder picker and queues every video found (`VIDEO_EXTENSIONS`, recursive, hidden files skipped) on the upload engine, the same way as `pick_and_upload` |
| 18.2 Studio pages | `web-studio` | V7: the Mac Short page in three columns. V8: the Mac Production page in compact rows, with coverage in the header, a selected-shot right column and ⋯. V10a/b: the compact Productions list with a ⋯ menu (Open, Open its short, Delete production… ⌘⌫), and a confirm dialog with "Also delete its short and renders" (off by default) using `DELETE /api/productions/{id}`, plus `DELETE /api/shorts/{id}` when ticked |
| 18.3 Direct Upload | `web-upload` | V9a/b: the Gallery's Upload split button. Upload calls `pick_and_upload`; ▾ "Upload a folder…" calls `pick_folder_and_upload`. No route to the Upload page. Uploading tiles (progress, Waiting, cancel ×) come first in the grid, and the header shows a pill "Uploading N clips · X of Y GB · about M min left", from the sync status transfers. The Mac sidebar and menus no longer link to the Upload page |
