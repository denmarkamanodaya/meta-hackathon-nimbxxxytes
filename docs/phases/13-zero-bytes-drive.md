# Phase 13: zero bytes on disk (the nimbytes drive + smart cache)

Owner, 2026-10-27, after testing Mac 1.0.3: "where is our zero bytes on disk now? that is one of
best feature for this build". This phase builds the approved A2 drive and A3 smart cache from
`11-v1.1-storage-search.md`, which were skipped when the team stood down after the R2 migration.

## Findings (read-only investigation, 2026-10-27)

### What exists
- Rulings (MEMORY.md):
  - File Provider dropped, because it needs a System Settings switch on every Mac.
  - Zero bytes comes from an **NFS v3 loopback drive** served by the app at `~/nimbytes`
    (crate `nfsserve` approved).
  - Smart-aware cache approved: 5 GB, eviction by meaning, segment prefetch.
- `desktop/drive-spike/` (671 lines, **untracked, never committed**) proved:
  - non-root mount;
  - Get Info "Zero bytes on disk" (Finder reads NFS `used`; `stat` st_blocks ignores it);
  - previews and Quick Look pass through without caching;
  - a 1 MiB chunk sparse cache with 4-chunk read-ahead, from HTTP Range on the presigned original;
  - a Desktop alias with the logo.
- `desktop/fileprovider/` (untracked): the File Provider spike. Kept for the record only.
- Upload is already multipart: 8 MiB parts (16 MiB over 1 GiB), presigned, resumable, 4 parallel on
  the Mac and 3 in the PWA. The owner is happy with it: no change.

### Why the Mac stores whole files today
- The shipping sync engine is a **mirror**:
  - `core/sync_plan.rs` downloads every ready clip's proxy into `Library/`;
  - it downloads whole originals into `Originals/` (pinned, or auto for FCPXML, `core/cache.rs`);
  - it downloads every short render into `Shorts/`.
- Measured: 183 MB in `~/nimbytes` for a handful of clips.
- Shipped from phase 11: C (instant search) and D (one-line Sync page).
- Not shipped: A2 (drive), A3 (smart cache), B (no proxy mirror).

### Spike gaps to close
| # | Gap | Fix in |
|---|---|---|
| 1 | The tree is built once at start; new clips never appear | D1 |
| 2 | Cache opened with `truncate(true)` and the bitmap kept in memory: every launch drops the cache | D1 |
| 3 | No cap or eviction | D5 |
| 4 | Per-clip lock held across the network fetch serialises parallel NLE reads | D1 |
| 5 | Read-only: Exports can't be written | D4 |
| 6 | `Shorts/` empty: the manifest has `render_url` but no size | D3 |
| 7 | `Projects/` has one spike FCPXML | D3 |
| 8 | No mount/unmount code; a crash leaves a hung NFS mount | D1 |
| 9 | No migration of the real `~/nimbytes` folder | D2 |
| 10 | The 1.0.3 `cache_bytes` walks `~/nimbytes`, which would report full logical sizes once mounted | D2 |

Ruled out: plain APFS sparse files show 0 bytes on disk but return zeros, with no on-demand fetch.

## Phases

- **D1, drive in the app (Library, read-only).**
  - Move the spike into `desktop/src-tauri`:
    - pure rules in `core/drive/` (chunks, promotion, names, tree, range plan);
    - ports `RangeSource` and `ChunkStore`;
    - adapters `nfs_drive`, `range_http` and `chunk_file` (sparse file + JSON bitmap, no truncate);
    - `services/drive.rs`, which binds 127.0.0.1 on a free port.
  - Mount with
    `mount_nfs -o vers=3,tcp,port=P,mountport=P,nolocks,locallocks,soft,intr,timeo=10 127.0.0.1:/nimbytes ~/nimbytes`.
  - `umount -f` a stale mount at start; unmount at quit.
  - Rebuild the tree on every manifest poll.
  - A per-chunk in-flight map, so readers of one chunk share a fetch.
- **D2, stop the mirror.**
  - No proxy or original downloads.
  - The window plays from the cloud.
  - Pin = protected prefetch of every chunk.
  - Rename the real `~/nimbytes` to `~/nimbytes (old copies)` before the first mount; never delete
    it without a yes.
  - `cache_bytes` = cache directory total.
- **D3, Shorts and Projects.**
  - `render_size_bytes` on `SyncShort` (api contract plus a deploy).
  - Renders streamed through the cache.
  - Per-short FCPXML generated in memory, pointing at drive paths.
- **D4, writable Exports** (owner ruling 2026-10-27).
  - Only `Exports/` accepts create, write, setattr, remove and rename.
  - Writes are staged in `Application Support/nimbytes/exports-staging/`.
  - When the size is stable, the existing exports service runs: duplicate check, then the
    multipart upload. Then the staged file is removed.
- **D5, smart-aware cache.**
  - 5 GB cap; it shrinks below 15% free disk.
  - Eviction tiers:
    1. never: pinned clips and chunks in use;
    2. last: segments used in shorts or projects;
    3. middle: watched or search-matched;
    4. first: untouched raw footage.
    Ties go oldest access first.
  - Per-clip eviction.
  - Prefetch moov plus the used segments when a short is ready.
  - "Free up space" clears every non-protected clip.
- **D6, finish.** Desktop alias, "Show in Finder" opens the mount, version 1.1.0, DMG, brain
  update.

## Acceptance (owner, on the real Mac)

1. Get Info on `~/nimbytes/Library/<clip>` shows "Zero bytes on disk".
2. QuickTime plays it; Get Info then shows only the cached part.
3. A new phone clip appears within 30 s.
4. Resolve imports a Projects FCPXML.
5. A cut dragged into Exports uploads.
6. Quit unmounts; relaunch keeps the cache.
7. "Space used" matches the cache.

## In parallel

Teammate `mac-midnight` builds the Mac dark theme "Midnight" (brief
`~/Downloads/nimbytes-mac-dark-theme.md`, mocks D0–D5) in its own worktree, `web/` only.
