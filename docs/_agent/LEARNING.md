# LEARNING

Append-only. One entry per spike verdict, measured number or surprise. Newest at the bottom.
Format: `YYYY-MM-DD · area · finding · consequence`.

## Top lessons (read these first)

| # | Lesson | Do this |
| --- | --- | --- |
| 1 | The live SQLite file was corrupted by host-side `sqlite3` while the container ran (WAL across the Docker Desktop share) | Use the API, or stop the container first; back up with it stopped |
| 2 | Teammate reports crossed lead messages again and again (a stale "idle" copy arrives after the real one) | Check the pane or the file before acting on a report; restate open items in one message |
| 3 | Cross-package tests (PIPELINE_STEPS ↔ ingest steps, `--video-accent` ↔ `VIDEO_ACCENT`, logo SVG ↔ LogoMark) caught every web/api drift | When a fact lives in two packages, add a drift test the same day |
| 4 | Models copy ids and field names into owner-facing text | Every prompt with owner-facing output says "name shots by what they show, m:ss, no ids"; the UI humanizes as a guard |
| 5 | Commits once included failing teammate WIP | Chain commits on green: `cargo test … && npm test && git commit` |
| 6 | Re-ingest cascade-deleted shorts' picks | Upsert by id; never delete-and-reinsert rows that others reference |
| 7 | `DROP TABLE clips` in a migration would cascade-delete every child row | Rebuild tables with `-- no-transaction` + `PRAGMA foreign_keys=OFF` (migration 0006) and test that child rows survive |
| 8 | Background jobs (title, hash) once failed the whole clip when they gave up | Only an `ingest` job may mark a clip failed |
| 9 | AWS SSO token refresh needs a writable `~/.aws/sso/cache` | The local compose mounts that folder read-write |
| 10 | The dev server on :5173 proxied to :8080 (nothing there), so the app looked broken | It now proxies to Caddy; say which URL the owner should open |
| 11 | ort's bundled int8 image kernels are wrong on macOS | fp32 image + int8 text |
| 12 | Owner balked at $4.50/day EC2 | Quote live per-day prices first; tunnel for testing, t4g.large only for judging |

## Known before coding (from the Meta docs, 2026-10-27)

- 2026-10-27 · transcribe · Muse Voice Transcribe returns turn-level timestamps only, and accepts only
  WAV mono 16-bit PCM 16/24 kHz, ≤ 10 min, ≤ 32 MB · phrase-level captions; extract WAV not M4A.
- 2026-10-27 · sam · SAM 3.1 has no fps option and bills every frame (50-frame minimum) · send a 1 fps
  re-encode to SAM.
- 2026-10-27 · sam · model id is `sam-3.1` (the brief had `sam-3-1`).
- 2026-10-27 · spark · Spark video input is mp4 only; docs give no duration limit, token rate or
  timestamp grounding · we cut segments ourselves and send one snippet per segment.
- 2026-10-27 · deploy · App Runner has no persistent disk; SQLite + Tantivy would be wiped on every
  restart · one EC2 arm64 box with EBS instead.

## Spike verdicts (Phase 0)

| Spike | Verdict | Numbers | Notes |
| --- | --- | --- | --- |
| 0.1 Spark video | works (base64 inline mp4) | 7 s 360p snippet = 34 KB; 744 in / 958 out tokens (861 reasoning) ≈ $0.005; 8.6 s | default reasoning effort is HIGH — send `reasoning.effort: low` for segment facts; clean JSON in output_text |
| 0.2 SAM faces | works | 16-frame 1 fps input billed as 50 frames ($0.01 min/request); 8 s | line = `<Nf>ord<|box;x1;y1;x2;y2;w;h;c|><|mask;x;y;c;data=W,H,~…|>`; only frames with detections emitted; POV faces tiny (14×17 px @640) → use 1280 long edge, min-side rule not 4 % area |
| 0.3 Voice Transcribe | works (DIARIZATION) | 21 s audio: 4.6 s latency ≈ $0.001 | speaker labels are letters A/B; turn spans loose; Tagalog/English code-switch OK |
| 0.4 PE → ONNX → ort | works in Rust (ort 2.0.0-rc.15 + tokenizers 0.23.2); memory too high | dim 1024; image 28 ms, text 14 ms (M4 Pro, onnxruntime py); parity 2.9e-6 | Rust: drift ≤ 6e-4, image 72 ms, text 38 ms, load 3.5 s + 4.9 s; RSS 2.94 GB steady / 3.85 GB peak with both towers (text alone ~2.4 GB) — too big for t4g.medium; smaller text tower being evaluated, fallback t4g.large; tokenizer pad MUST be 0 (pooling at argmax = EOT) |
| 0.5 sqlite-vec in sqlx | works | 1024-d, 5k rows KNN 5.9 ms (2.6 ms w/ user partition) | sqlite-vec 0.1.9 via sqlite3_auto_extension; libsqlite3-sys must stay 0.37 (sqlx 0.9); vec0 is exact brute force, no ANN |
| 0.6 ffmpeg HEVC + rotation | works | proxy 3 s clip encodes in 131 ms | rotation in streams[].side_data_list[].rotation (-90); autorotate fixes pixels; use `select='gt(scene,0.3)',metadata=mode=print:file=-` (parse pts_time) |

## Measured costs and latencies

| Metric | Value | Measured on |
| --- | --- | --- |
| Cost per clip-minute (ingest) | measured $0.089 on a 21 s clip ($0.0318 total: Spark 3 × ~$0.007, SAM $0.01 minimum, transcribe $0.001); longer clips amortise the SAM minimum (~$0.05–0.06/min) | real run 2026-10-27 |
| Cost per short (agent) | – | – |
| Search p50 latency | ~3.6 s cold (rewrite + BM25 + PE KNN + rerank), ~0.06 s repeated (cache hits); ~$0.002–0.003 per new search | real run 2026-10-27, 1 clip |

## Gotchas

- 2026-10-27 · infra · S3 lifecycle filters match a key prefix from the START of the key only, so `originals/` never matches `users/{id}/originals/…` · lifecycle uses tag `nimbytes-class=original|preview`; the API must send `x-amz-tagging` on CreateMultipartUpload / preview writes, and IAM needs `s3:PutObjectTagging`.
- 2026-10-27 · tooling · Homebrew core ffmpeg 9 has no libass (no `ass`/`subtitles` filters) · swapped to the `homebrew-ffmpeg/ffmpeg` tap build. Debian ffmpeg in the image has libass.
- 2026-10-27 · tooling · Homebrew rustup is keg-only: cargo lives in `/opt/homebrew/opt/rustup/bin` · Makefile exports PATH.
- 2026-10-27 · agents · `effort` on spawn did not apply in teammate panes (showed high) · type `/effort medium` in each pane.
- 2026-10-27 · footage · real Ray-Ban captures are 3:4 portrait (1312×1744, 1248×1664), H.264 60 fps .mov; one sample is a screen showing a username path — keep personal screens out of the demo library.
- 2026-10-27 · tooling · `grep` on this Mac is ugrep and respects .gitignore; use /usr/bin/grep to search ignored files (docs, .env).
- 2026-10-27 · pe · int8 IMAGE tower passes the Python onnxruntime retrieval gate (20/20) but BREAKS retrieval in Rust `ort` (scores collapse to ~0.05–0.1, coffee wins every caption); fp32 image + int8 text is correct in both (drift ≤ 0.017), 1.58 GB steady RSS in Rust · ship fp32 image + int8 text; cause FOUND: the ONNX Runtime binary bundled by the `ort` crate (download-binaries, macOS arm64) computes int8 kernels wrongly; the same files are correct with `ort/load-dynamic` + the official wheel's libonnxruntime 1.31. Linux aarch64 bundled binary untested — server may need t4g.large (8 GB), decide in Phase 8.
- 2026-10-27 · ingest · first real ingest (21 s portrait clip): 3 segments, 1 turn, transcribe $0.001076, all derived files in S3, SSE ready/done. Clip had no creation_time (falls back to upload time) and VFR 48 fps.
- 2026-10-27 · docker · `ort` links ONNX Runtime statically and needs libstdc++ at link time (`ld: cannot find -lstdc++`) · g++ in the builder stage. Bundled ORT on linux aarch64 ranks correctly with fp32 image + int8 text (verified in the builder image).
- 2026-10-27 · meta · send video to Spark/SAM inline as base64, not presigned URLs: presigned URLs change per call and would break the response cache (re-runs must cost $0; verified live — transcribe re-run was a cache hit).
- 2026-10-27 · remotion · renderMedia works in Docker linux/arm64 (node:22-bookworm-slim + Chrome deps, remotion 4.0.538): 15 s 30 fps final 1080×1350 in 11.1 s, preview in 10.6 s on 4 vCPU (no video decode yet); h264 needs even dimensions → preview 544×680 (4:5) / 540×540; remotion pulls an old zod (npm audit high) — left as is.
- 2026-10-27 · remotion · real render with OffthreadVideo over HTTP range (4 vCPU, 8 GB, arm64): 14.5 s short → preview 544×680 in 14.6 s, final 1080×1350 in 23.7 s; renderMedia `scale` gives non-integer heights → render at the output size instead.
- 2026-10-27 · search · Spark rerank can return [] even when BM25 found the spoken words ("what city") · empty rerank falls back to fused order (reason null, reranked=false).
- 2026-10-27 · search · clips without creation_time get upload time as recorded_at, so date filters ("last week") follow upload day.
- 2026-10-27 · tests · flaky `an_index_on_disk_survives_reopening`: Tantivy writer flock released late when other tests spawn child processes in-process → reopening a WRITER right after drop hit LockBusy (~4% under load). Test now verifies durability with a read-only `Index::open_in_dir`; 30/30 full runs green.
- 2026-10-27 · full loop · first real short: 4 moments from 3 clips → Spark plan ($0.006, 2094 of 2539 output tokens reasoning at low effort) → preview 544×680 13 s in 36 s total → final 1080×1350 from .mov originals in 79 s on the Mac (Remotion decoded .mov fine). Plan rationale: "Opens on kangaroo hook, cruises past supercars, lands soft on sleepy dog".
- 2026-10-27 · agent · first live self-critique run: v1 25/50 (4 timestamped notes: jarring repeat cut, no hook in first 2 s, irrelevant captions, repeated supercar shot) → v2 43/50 accepted, every change citing its note; 94 s end to end; $0.046 per short (2 plans + 2 critiques).
- 2026-10-27 · process · lead committed teammate WIP twice with a failing test because the commit wasn't chained on the test result · always `cargo test … && git commit`.
- 2026-10-27 · data · re-ingest deleted + re-inserted segments; `short_segments` ON DELETE CASCADE silently removed shorts' picks → GET short 500. Fixed with upsert-by-id and placeholders for truly missing moments.
- 2026-10-27 · prompts · models copy whatever ids they see into user-facing text (revision details, critique fixes) · every prompt that produces owner-facing text says "name shots by what they show, times as m:ss, no ids", and the UI humanizes as a guard.
- 2026-10-27 · deploy · full docker compose rehearsal (caddy + api + renderer, arm64) via https://localhost: upload→ready 34 s, search 7 s, agent short 97 s (v1 32 → v3 35, planner used search_moments live), final 1:1 render 12 s; ~$0.11 per clip end to end. Images: api 814 MB, renderer 1.07 GB. Caddy flush_interval -1 keeps SSE live.
- 2026-10-27 · deploy · on Linux, bind mounts keep host uids → ./data must be owned by 10001 (api user); Docker Desktop hides this. Server .env must not carry AWS_PROFILE (instance role).

## 2026-10-27 — never open the live SQLite file from the Mac while the api container runs
- Symptom: `data/nimbytes.db` became "file is not a database"; its first 3 pages were zeroed, after a restart while host `sqlite3` queries had run against it all day.
- Cause: WAL mode uses a shared-memory index (`-shm`) and file locks, and neither works across the Docker Desktop VM file share. A host process and the container process each believed they were alone, so checkpoints overwrote each other.
- Recovery: restored `~/Backups/nimbytes-db-pre-0006-20261027-1057.sqlite`, which passed integrity_check. The damaged file is kept at `~/Backups/nimbytes-db-corrupt-20261027-1100.sqlite`.
- Rule: read live data only through the API, or stop the api container first. Take backups with the container stopped.

## 2026-10-27 — later findings
- 2026-10-27 · spark · image input verified: `{"type":"input_image","image_url":"<url or base64 data URL>"}`, up to 50 images, jpeg/png/gif/webp; two 256 px crops = 447 in / 156 out tokens, $0.0012 · face-match confirm uses it. Identical-copy test only; different-face accuracy still to calibrate.
- 2026-10-27 · sam · the `"face"` concept also finds animal faces (a dog) · owner kept it: People & pets.
- 2026-10-27 · titles · text-only Spark title from segment descriptions: $0.0014 per clip, 2–4 words.
- 2026-10-27 · dupes · the same file uploaded twice doubled model spend and gave two titles for one video · SHA-256 at probe now stops a copy before any model call.
- 2026-10-27 · desktop spikes (Tauri 2.12.5, WKWebView, against https://localhost):
  - S1 passes: invoke transport with the Keychain cookie survives a restart, and SSE works over a
    Tauri Channel.
  - S2 passes: an asset-protocol mp4 plays and seeks 27 s in 109 ms, and Range returns 206, so no
    custom scheme is needed.
  - S4 passes: reqwest trusts the Caddy root through `tls_certs_merge` (NIMBYTES_DEV_CA, dev only).
- 2026-10-27 · desktop spikes S3, S5:
  - S3: the Remotion Player (4.0.538) with OffthreadVideo plays and seeks on `asset://` URLs in
    WKWebView.
  - S5: `cargo tauri build --target universal-apple-darwin` with APPLE_SIGNING_IDENTITY builds a
    signed universal app and DMG, not notarized. `codesign --verify --deep --strict` passes.
  - Local file names use the last 8 characters of the id. The first 8 of a UUID v7 are a timestamp
    that repeats for about 65 s, so they collide.
- 2026-10-27 · desktop · gotchas:
  - zsh expands an unquoted `=2.12.4` as a command path, so `cargo install --version =x` fails
    silently in a pipe. Quote it: `--version '=2.12.4'`.
  - Tauri commands use camelCase args by default. Every desktop command sets
    `rename_all = "snake_case"`, so the bridge args match docs/contracts.md literally.
  - The proxy is a constant 30 fps with a 1280 px long edge. FCPXML that links a proxy must use
    those, not the original's fps and size.
  - Agents can't screenshot the Mac app (`screencapture` has no screen-recording permission).
    UI checks are the owner's.
- 2026-10-27 · desktop · Dev builds wrote `server_url: https://localhost` into the same Application Support folder the release app reads, so the installed release app failed with a raw reqwest error. Rules now: dev and release builds never share app data, Keychain service or sync folder (`core/profile.rs`); release builds take the server from the build only; native transport errors reach the UI only as "Can't reach <origin>".
- 2026-10-27 · infra · An apply interrupted by the owner still created part of the stack (EIP, disk, SG, IAM, key). After any interrupted apply, run `terraform state list` and report what exists; never say "nothing was created" without checking.
- 2026-10-27 · infra · XFS labels are at most 12 characters, so the first-boot script died. macOS openrsync has no `--chmod`.
- 2026-10-27 · agents · desktop and web each built a different SyncStatus shape after crossed messages. The contract now names one owner per shape (desktop owns SyncStatus), and the lead waits for the owner's answer before restating it.
- 2026-10-27 · file provider spike:
  - An NSFileProviderReplicatedExtension appex in a Developer ID–signed, unnotarized app registers
    a domain. No provisioning profile is needed; the team-prefixed App Group is accepted.
  - A new domain starts **user-disabled** (FP -2011) until the user turns it on in System Settings
    › General › Login Items & Extensions › File Providers. No API can do it, so the app must guide
    the user once.
  - After each rebuild, re-register the bundle (`lsregister -f` + `pluginkit -a`), or the host
    can't find the extension (-2001).
- 2026-10-27 · drive spike:
  - An NFS v3 loopback mount works without root.
  - Finder Get Info uses the server's `used` bytes (NSURL fileAllocatedSize), but `stat` st_blocks
    ignores it.
  - Finder's preview and Quick Look read the start, the `moov` box and a poster frame. Pass those
    reads through without caching, or Get Info shows about 12 MB "on disk".
  - `.VolumeIcon.icns` is ignored on the mount. A Finder alias on ~/Desktop with a custom icon
    shows the logo; the owner confirmed it.
- 2026-10-27 · r2 billing: R2 **Infrequent Access** operations have no free tier and are billed per
  million units. A few IA test operations on the owner's account cost $9.00 (Class A) + $0.90
  (Class B) this cycle, while Standard usage stayed inside the free tier. The dashboard's "projected"
  figure ($21.97) just extrapolates. Rule: nimbytes uses R2 Standard only, never IA.

## 2026-10-27: hand mutation checks can leave a stale cargo build

A mutation helper that backs a file up, writes the mutant, runs `cargo test`, then moves the backup
back restores the file with the backup's OLDER mtime. Cargo then keeps the mutant's build as fresh,
so the next `cargo test` runs mutated code against the real source on disk. Symptom: a test fails
for a line that is plainly in the file (`deleting_a_short…` failed 20/20 on the lead's run). Fix:
touch every restored file (`os.utime(path, None)`), or `cargo clean -p <crate>` after a mutation
pass.
- 2026-10-27 · tests: a hand-rolled mutation helper restored files with their old mtime, so cargo
  kept the mutant build and the lead's gate run failed against correct source. When you restore
  a file after a mutation, touch it. Before a commit you're unsure of, `cargo clean -p <crates>`
  and rerun.
- 2026-10-27 · seam: the Mac "On this Mac" tile read `cache_bytes` from the native status, but the
  native `SyncStatus` never had that field (it was planned for the unbuilt smart cache). The web
  parser treats a missing field as 0, so the tile said "0 bytes" with 49 MB of originals on disk,
  and both halves' tests were green. Fix: the native side sums the sync folder; the Rust JSON
  test now pins `cache_bytes`. When a parser makes a field optional, check the sender sends it.
- 2026-10-27 · process: an approved, spiked feature (the zero-bytes drive) was silently dropped
  when the team stood down after the R2 migration. The spike stayed untracked in
  `desktop/drive-spike/`, and STATUS listed the order but nobody ticked what shipped. Rule: when
  standing a team down, write every unshipped approved item into STATUS "Remaining", and commit
  or name every spike folder.
- 2026-10-27 · drive: once `~/nimbytes` is the NFS mount, any folder walk of it stats NFS
  attributes and sees full logical sizes, and on a slow or dead server it can hang. "Space used"
  must sum the cache directory in Application Support, never the mount.
- 2026-10-27 · drive cache: APFS allocates the gaps of a file sized with `set_len` (a 3 MiB file
  with 1 MiB written took 3 MiB), so a single sparse cache file per clip would take far more disk
  than the bytes read. The cache stores one file per 1 MiB chunk instead (`adapters/chunk_cache.rs`).
- 2026-10-27 · drive live check (scratch harness on the real drive code, 25 MB fixture, a
  scratch mount, no app):
  - non-root `mount_nfs` works;
  - Finder's `fileAllocatedSize` is 0 before any read and still 0 after a 300 KB head read;
  - a full read returns byte-identical data (sha256 match) and caches 17 MB, because the first
    ~8 MB pass through before promotion;
  - Exports writes land in staging, and Library answers "Read-only file system";
  - clean quit unmounts;
  - after `kill -9`, `ls` on the dead mount fails in about 7 s (soft mount) instead of hanging,
    and relaunch force-unmounts the stale mount, remounts and keeps the cache.
- 2026-10-27 · upload: a 3.4 GB picked upload stopped at 139/203 parts. Part links live 15 min
  (`PRESIGN_TTL`), and the Mac app signed every part at the start, so every PUT after minute 15
  got 403, and a picked file was never retried. The PWA already re-signed on 403
  (`upload-file.ts`). Fixed in 38409dd: sign 16 parts at a time, treat 403 as `URL_EXPIRED`
  and re-sign, retry picked uploads with back-off, and resume unfinished picked uploads at start.
  The upload id is a UUID v7: its first 12 hex digits are the creation time, which dated the
  stall without server logs. The api logs no upload requests.
- 2026-10-27 · tokio: the installed 1.1.0 never mounted the drive although the scratch harness
  did. `start()` spawned the NFS server task, then ran a blocking `mount_nfs` on the same
  worker. A freshly spawned task sits in that worker's LIFO slot, which other workers never
  steal, so the server never ran: the kernel queued the connections (Recv-Q 68) and `mount_nfs`
  hung. The harness called `start()` from `block_on`, which is not a worker, so it passed.
  Fixed in 9e47e8f with `spawn_blocking`. Rule: never block inside an async task that has just
  spawned work it depends on, and make a harness call code the way the app does (from a spawned
  task).
- 2026-10-27 · faces (teammate face-check, read-only, on the 60th-birthday clip: an edited event
  video with hard cuts, 327 s):
  - SAM 3.1 finds faces fine: 254 of 317 boxes are face-shaped.
  - Our `faces.rs` `tracks` treats SAM's ordinal as one person. Only 16 ordinals (0-15) appeared,
    all by second 28, and ordinal 14 held 6+ different guests across cuts.
  - The best-frame score rewards area, so wide multi-face strips (aspect up to 10.9) became the
    crops: 6 of 7 crops are group shots.
  - One face on a printed banner photo was picked up as a person.
  - Fixes, ranked: split ordinals into runs (time gap, position jump, size change); drop
    non-face-shaped boxes (aspect outside 0.5-1.6); chunk long clips to SAM at about 50 s on
    scene cuts.
  - The SAM answer is cached, so re-running the faces step costs $0.
- 2026-10-27 · muse image spike: `muse-image-1.0` is $0.01 per image and takes about 15 s per
  image. A data-URL reference works for anchored edits. Output size follows the aspect, not exact
  pixels (1080x1350 asked, 1408x1760 returned). PNG output is about 4 MB, so store JPEG/WebP.
  Details in docs/meta-api.md.
- 2026-10-27 · studio 14.1-14.2 local end-to-end (real models, local stack): a 20 s "short" brief
  gave 4 shots in act order (Spark strict schema accepted), 4 WebP storyboards (about 395 KB each,
  4 x $0.01 in the costs screen), and coverage 3/4 with sensible reasons. "Bus pulls in" was
  correctly missing. Status `shooting`, `can_cut` true, no errors.
- 2026-10-27 · studio 14.3 local real cut: production → story short ready in about 3 min (3 drafts),
  production status went to `ready`.
  - The agent did NOT keep the planned acts exactly. It kept the hook first, used the hook moment
    twice, dropped one planned story shot, and added one moment from its own search that was not
    in the plan.
  - This is the expected cost of R3 ("ask only"): the order is in the prompt, not enforced. The
    acts strip must show "not in plan" moments.
- 2026-10-27 · studio 14.4 local check with real data:
  - `FACE_BOXES_BACKFILL=1`, passed only through a scratch compose override and never in `.env`,
    refilled boxes for 4 clips at $0.
  - Hiding the dog's track and making a short put `blur` entries in every draft's props.
  - The rendered preview blurs the dog's face.
  - Blurred-copy method kept: Mac final render +28%. `backdrop-filter` drew dark discs.
  - The phone Player plays a second `<video>` per blurred face; its smoothness is unchecked.
- 2026-10-27 · WRONG CLAIM CORRECTED: I told the owner one bucket was safe because user ids are
  random per install. The local DB is a copy of live, so it has the same user id (`01a1795f…`), the
  same clip ids and the same R2 keys. Any local delete (clip, short, production board) hits live
  objects. Found when a local brand upload landed under the live user prefix. Check the data, not
  the design, before saying "safe".
- 2026-10-27 · studio 14.6 local publish (real): about 1 min for 4 platforms. The vertical is
  1080x1920 and 11 s. Captions came back in platform tone with emoji, and the Shorts title is 43
  chars. Covers anchored on the hook frame came back almost identical to the frame: the cover
  prompt needs design direction.

## 2026-10-28: every live render failed: Remotion concurrency above the core count
- **Symptom:** Publish showed "Render failed" on TikTok, Reels and Shorts, and Feed stuck on "Rendering".
- **Cause:** the renderer ran with `RENDER_CONCURRENCY=3`, a value measured on a 4 vCPU box. The live box has 2 vCPU, and Remotion refuses a concurrency above `os.cpus().length` ("Maximum for --concurrency is 2"). Local renders on the Mac have many cores and passed.
- **Fix:** `renderConcurrency(requested, cores)` caps the value, and the start-up log prints the value used.
- **Second bug:** the Feed export reads the short's final render. When that render job gave up, Feed showed "Rendering" forever. Now Feed fails when the final render job failed.
- **Lesson:** a value tuned on one machine must be checked against what the target machine has. Look at the jobs table (`last_error`) first, because the renderer's 500 is only logged there.
- Quitting the Mac app: use `osascript -e 'tell application id "dev.denmarkamanodaya.nimbytes" to quit'`. A Cmd-Q keystroke after "set frontmost" can fail silently and quit whichever app is in front.
- 2026-10-28 · sam · Inline base64 video without `store:false` makes `/v1/responses` return **HTTP 413 after processing** ("request too large (~41 MB) to persist with store=true; use the Files API file_id or store=false"). It cost 106 min of waits plus retries in one run · Every SAM body sends `store:false`; large media goes by `file_id`. Investigation: `docs/investigations/2026-10-28-latency.md`.
