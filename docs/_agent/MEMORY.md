# MEMORY — decision log

Append-only, dated. Every owner ruling and every design decision that someone might later question.
Rules themselves live in `CLAUDE.md`; this file records **why** and **when**.

| Date | Decision | Why | By |
| --- | --- | --- | --- |
| 2026-10-27 | Vanilla CSS + design tokens, not Tailwind | Owner's universal styling rule | owner |
| 2026-10-27 | Deploy to one EC2 t4g (arm64) box + EBS, no ECR; image built on the Mac, shipped with `docker save | ssh docker load`; destroyed after the event | Throwaway demo, keep it cheap; persistent disk for SQLite + Tantivy; arm64 matches the Mac so no slow cross-build | owner |
| 2026-10-27 | Phrase-level captions | Voice Transcribe has no word-level timestamps | owner |
| 2026-10-27 | Repo `~/Projects/nimbytes`, public GitHub `denmarkamanodaya/meta-hackathon-nimbytes`, commits straight to `main` | Hackathon needs a public repo and a clear dated history | owner |
| 2026-10-27 | Plan written into repo docs and reviewed before any code | Owner wants to review the phased plan first | owner |
| 2026-10-27 | dk-coding lite: hexagonal + typed errors + DRY; no `v<N>` units, no CI | Brief: speed first | lead (from brief) |
| 2026-10-27 | **Revised:** fast offline unit tests are required (pure rules, parsers on fixtures, use cases with fakes, handlers, web logic); long end-to-end suites are banned | Owner wants due diligence, but not the 1–2 hour e2e runs seen on earlier projects; owner does e2e by hand. Supersedes the brief's "no tests" | owner |
| 2026-10-27 | Drop the SAM object-labels step | SAM takes one concept per request; Spark `objects[]` already covers search | lead |
| 2026-10-27 | Spark gets one 360p snippet per segment, never asked for timestamps | Docs give no time grounding for video | lead |
| 2026-10-27 | SAM gets a 1 fps re-encode | SAM bills every frame and has no fps option | lead |
| 2026-10-27 | Auth = one demo account + passcode cookie | Brief: don't spend time on auth | lead (from brief) |
| 2026-10-27 | Track: Indie Developer · Theme: Build for Your World | Solo entry; POV creators are the real-world domain | lead (to confirm in Phase 9) |
| 2026-10-27 | GitHub repo is `denmarkamanodaya/meta-hackathon-nimbytes` (owner created). Only README.md published; CLAUDE.md, STATUS/LEARNING/MEMORY.md and docs/ git-ignored, local only. Local unpushed history rebuilt so docs never reached the remote | Owner wants a clean public repo judged on code written after kickoff | owner |
| 2026-10-27 | `ErrorCode` + `AppError` live in `core`; `contracts` depends on `core` and re-exports | `stack/rust.md` says contracts exports the code list; core must never import a wire crate | lead |
| 2026-10-27 | AWS: new org member account `nimbytes` (<aws-account>, root email <owner email>, tags project/lifetime), permission set `NimbytesAdmin` (AdministratorAccess, 8h), SSO profile `nimbytes` on the existing SSO session | Keep the public hackathon out of the business management account; same pattern as other side projects; clean teardown | owner |
| 2026-10-27 | Agentic editor must show its reasoning: `rationale` per version + `revision.changes[]` (what/why, citing the critique note) in the timeline JSON; trail UI shows them; new docs/positioning.md ("AI editing: typical = generate and lightly adjust; nimbytes = critiques and revises its own cut, reasoning shown") | Owner pointed out the differentiator was missing from the docs | owner |
| 2026-10-27 | Storage stack applied (owner yes): bucket <r2-bucket>-<aws-account>, IAM user nimbytes-app-local (no key). Local tfstate backed up to ~/Backups/nimbytes-storage.tfstate.bak | Phase 0 task 0.8 | owner |
| 2026-10-27 | Region = Sydney `ap-southeast-2` for all AWS (was ap-southeast-1 from the brief). Bucket renamed `<r2-bucket>-<account>-<region>` so the replace never waits on S3 name reuse; profile `nimbytes` region set to ap-southeast-2 | Owner ruling | owner |
| 2026-10-27 | Storage replaced into Sydney (owner yes): Singapore bucket destroyed (was empty), new bucket <r2-bucket>-<aws-account>-ap-southeast-2 | Region ruling | owner |
| 2026-10-27 | Stop pushing: commit locally on main, never `git push` until the owner reviews in VS Code and says push. Everything up to d6a86a4 was already pushed before this ruling | Owner wants to check code locally first | owner |
| 2026-10-27 | Spark call settings: strict json_schema output (server-enforced), `store: false` always, effort `low` for segment facts, `minimal` for rewrite/rerank; per-call `enum` on segment ids; revision changes carry `note_index`; rerank timeout 10 s (one 9.4 s outlier) | Prompt spike, $0.18, 39/39 schema-valid | lead |
| 2026-10-27 | PE ships as fp32 image + int8 text (int8 image broke retrieval in Rust) | 1.58 GB steady RSS; server size decided in Phase 8 | lead |
| 2026-10-27 | App server = c7g.xlarge (Graviton arm64, 4 vCPU, 8 GB, $0.189/h Sydney ≈ $4.53/day) instead of t4g.medium; one EC2 + EBS + same docker compose, Terraform-managed. Can be stopped between demos (EBS keeps data) | Owner wants compute-optimised for ffmpeg; arm64 keeps native Mac builds (c7i would need amd64 cross-build) | owner |
| 2026-10-27 | Rendering moves to Remotion (composition in new `render/` package, renderer container on the box, `@remotion/player` instant preview in the PWA); ffmpeg kept for ingest; Uppy rejected (own multipart already built + proven); no Remotion Lambda this week | Owner proposed Remotion/Player/Uppy; chose on-box renderer, kept our uploads | owner |
| 2026-10-27 | Agent loop = controller in core (plan → render_preview → critique_preview → revise ≤ 2) with real Spark tool calling (search_moments, get_segment) on the planner turn; tool definitions live in api/prompts/agent_tools.json | Predictable cost and cuts for the demo while keeping genuine tool use; free-form loop risked skipped critiques and resent-context cost | lead |

## 2026-10-27 — server cost
- Owner rejected c7g.xlarge (~$4.80/day). Box is t4g.large (~$2.30/day running, ~$0.28/day stopped), created only for judging (Mon 2 / Tue 3 Nov) and stopped when idle.
- Until then the phone uses a free Cloudflare quick tunnel to the Mac's local compose stack. S3 CORS allows `https://*.trycloudflare.com` (owner yes, applied 2026-10-27).
- Deploy SSH key: `~/.ssh/nimbytes_ed25519` (created 2026-10-27, not yet on AWS).

## 2026-10-27 — pitch + redesign
- Caching/storage pitch points recorded in `docs/positioning.md` ("Smart storage and caching"); demo script 2:20–2:40 updated. Safe claim: "Lives in the cloud, browses like it's on your phone". Never "offline" or "same as local". Measure iPhone first-frame and Safari cache reuse before recording.
- PWA redesign ("Mist" direction) mocked as 6 phone screens in a private design canvas: https://claude.ai/artifact/ChDqcftUKSR5yvrYBKQAS7. No code until owner approves (mock-first rule).
- Mist redesign built by web + api (uncommitted, 2026-10-27): 6 screens + Shorts list, light only, self-hosted fonts; new endpoints /api/storage, /api/people/overview (with hidden list), /api/shorts; clip titles via a text-only Spark step (5 backfilled, ~$0.007); rendered shorts accent #FFE58A (`--video-accent`), captions white with yellow active word. Gates: Rust 341, web 337, render 23. Local stack rebuilt; migration 0005 applied (DB backup ~/Backups/nimbytes-db-pre-0005-20261027-0953.sqlite). Awaiting owner browser review at https://localhost.

## 2026-10-27 — duplicates, face matching, pets, logo, v1.0.0
- Cause of the double dog face: the same video was uploaded twice (same name, size, length); faces are tracked per clip. Plan approved: exact duplicates by SHA-256 at probe (stops ingest, no model spend), pre-upload check, "Remove copy".
- Owner ruling: opt-in face match suggestions (off by default; PE proposes, Muse Spark confirms; suggest only; off deletes vectors). Replaces "no face embeddings, no matching across clips".
- Owner ruling: People & pets (keep SAM "face", which also finds animals).
- Owner: Meta models are the main priority wherever AI is used.
- Logo: cloud + 3×3 byte grid, 3 options on the design canvas (Logo options artboard), awaiting the owner's pick.
- Owner: once done, deploy to the Cloudflare tunnel, push, tag and release v1.0.0 (explicit approval for push, tag and release).
- 2026-10-27 logo FINAL (owner "perfect"): teal #0B6E85 rounded tile (rx 14), white cloud shifted (-2.5, 4), 3×3 bytes shifted a further (+1.5, 0); filled bytes teal, empty bytes teal outline. No dark colours. Source of truth: render/src/composition/LogoMark.tsx (web imports it via @nimbytes/logo).

## Index of later decisions (2026-10-27, after the table above)

| Decision | By |
| --- | --- |
| **Supersedes c7g.xlarge row:** server = t4g.large, created only for judging; phone testing goes through a Cloudflare quick tunnel to the Mac | owner |
| Rendered shorts accent = `#FFE58A` (`--video-accent`), from the approved mock's caption highlight; end-card caption ink for contrast | lead (from the mock) |
| Mist redesign approved and built exactly (light only, self-hosted fonts) | owner |
| Duplicates: SHA-256 at probe, the newer copy is marked `duplicate`, removal only on the owner's tap | owner (plan approved) |
| Face matching: opt-in, suggest-only, PE proposes and Spark confirms; replaces "no face embeddings" | owner |
| People & pets (SAM `face` keeps finding animals) | owner |
| Meta models are the main priority wherever AI is used (CLAUDE.md rule 8) | owner |
| Logo: teal tile + white cloud + 3×3 teal bytes, no dark colours | owner |
| v1.0.0: push, tag and GitHub release approved | owner |
| Branded domain parked | owner |
- 2026-10-27 · v1.0.0 pushed, tagged and released (07bc7a5). Live checks: duplicates and pre-upload check correct on real data; face-matching switch saves; migration 0007 applied on the restored DB (backup ~/Backups/nimbytes-db-pre-0007-20261027-1134.sqlite).
- 2026-10-27 Mac app (Phase 10) rulings: full app in the Tauri window with local media (overrides the brief's small window and "no web changes"); unit tests for risky logic (overrides "no tests"); local server for dev, judging box at release; **no notarization for now**; the real dog copy deleted (owner yes).
- 2026-10-27 Mac mocks M1–M6 APPROVED by the owner (canvas https://claude.ai/artifact/ChDqcftUKSR5yvrYBKQAS7; copies in docs/design/mac/). Build exactly.
- 2026-10-27 judging server LIVE (owner yes): EC2 t4g.large <instance-id>, Elastic IP 3.104.132.162, https://3-104-132-162.sslip.io (Let's Encrypt via Caddy). The owner's library (4 clips, DB + index) was copied with the local api stopped. RENDER_CONCURRENCY=2 on the box. S3 CORS adds that origin (owner yes). The app stack was partly applied at 08:40 by the interrupted c7g apply (EIP, disk, SG, IAM, key); the "nothing was created" report at the time was wrong. User-data failed on the XFS label (13 > 12 chars): the disk was finished by hand and the template fixed, so the next plan will offer to replace the instance (the data disk survives). The test clip and the dog copy were deleted (owner yes).
- 2026-10-27 Mac app commits pushed (08e9bb0); the DMG is NOT released (owner: test locally first).
- 2026-10-27 owner ruling: Mac app server and folder are STATIC (release: https://3-104-132-162.sslip.io + ~/nimbytes; dev: https://localhost + ~/nimbytes-dev, separate app data and Keychain). Sign-in = passcode only. Folder Change… removed. Overrides mock M4's server/folder fields and M3's Change…
- 2026-10-27 final Mac DMG (sha256 cc695bb4…, 13:50) installed in /Applications on the owner's Mac. The server was redeployed with the latest web build (index-C0r3-P2D.js). The owner is testing end to end; the DMG is not released yet.
- 2026-10-27 **v1.0.1 released** (owner: "tag/release this as v1.0.1"): nimbytes for Mac DMG attached as nimbytes-for-mac-1.0.1-universal.dmg; the PWA download link is live on the server. Next: enhancements.
- 2026-10-27 v1.1 plan approved (owner): File Provider so Finder shows 'Zero bytes on disk', no proxy mirror (streaming + 2 GB cache), instant two-stage search (local results first, Spark rerank streamed), Sync page reduced to one status line. Optional E: proxy bitrate cap.
- 2026-10-27 owner ruling: skip File Provider (needs a System Settings switch). Zero bytes on disk via an app-served NFS v3 loopback drive at ~/nimbytes with a Desktop drive icon (crate nfsserve approved). Old mirror folder renamed, never deleted without a yes.
- 2026-10-27 owner APPROVED v1.1 mocks V1 (Mac Sync: one status line, space used, Show in Finder) and V2 (search: instant local results, skeleton reasons, then refined). Copies in docs/design/mac/.
- 2026-10-27 owner approved the 'smart-aware cache' (their name): eviction by meaning (shorts/projects last, untouched raw footage first) plus prefetch of the segments a short uses; 5 GB default, shrinks below 15% free disk.
- 2026-10-27 owner APPROVED delete mocks V3 (clip confirm sheet) and V4 (⋯ menus on clip and short, Mac right-click and multi-select, no delete from the Finder drive). Copies in docs/design/mac/.
- 2026-10-27 storage provider: stay on S3 for the hackathon (measured 3.5 MB/s single and ~4.6 MB/s with 4 parallel ranges from the owner's Mac; their connection is the ceiling). Consider Cloudflare R2 after the event for zero egress (1 TB streamed ≈ $110 on S3 vs $0 on R2); R2 lifecycle has no tag filters, so the tier and preview-expiry design would need rework.
- 2026-10-27 owner ruling: plan to replace S3 with Cloudflare R2 (latency for distant viewers + zero streaming egress). Plan in docs/phases/12-r2-migration.md, awaiting approval. Supersedes the earlier 'stay on S3' recommendation.
- 2026-10-27 owner APPROVED the R2 migration plan. After R2 is verified, empty and destroy the S3 bucket, its IAM user and the role policy, so S3 stops billing (final destroy plan shown before running).
- 2026-10-27 R2: Standard storage class only (never IA, which billed the owner $9.90 for a handful of test operations). Older R2 tokens from other projects revoked; nimbytes-server remains.
- 2026-10-27: owner said "switch to R2!". Cutover done 09:03–09:13 UTC with all 52 objects verified. S3 stays until the owner confirms 12.5, then 12.6 deletes it on the owner's yes.
- 2026-10-27: owner asked for v1.0.2 ('switch storage from S3 to R2'). Pushed, tagged and released with DMG 1.0.2. The S3 bucket empty is the owner's step, then 'go' for the targeted app apply plus the storage destroy.
- 2026-10-27 owner ruling (after testing Mac 1.0.2): the Mac Library is the search. "Search" left the Mac sidebar; the Library bar runs the query in place (`/?q=`) and old `/search?q=` links redirect there. Search shows a spinner until the final Muse Spark answer, never the unfiltered first pass (PWA too, shared hook). Built without a new mock: no new visuals (existing bar, cards, Spinner). Mac app 1.0.3, local commits only.
- 2026-10-27 owner: "Zero bytes on disk" is a headline feature of this build and must ship. Build the approved NFS drive (A2) and smart-aware cache (A3) as phase 13 (`docs/phases/13-zero-bytes-drive.md`). Exports in the drive are writable (owner chose this over the Upload page alone). Upload stays as it is (multipart, 8 MiB parts, resumable).
- 2026-10-27 owner asked for a teammate to build the Mac dark theme "Midnight" from `~/Downloads/nimbytes-mac-dark-theme.md` (mocks D0–D5 on the canvas). It is Mac-only; the PWA stays light.
- 2026-10-27 lead merged the teammate's Midnight dark theme (c4d967e) and built the zero-bytes drive (9bae6c8, ad6d916, 8ab21b7). Mac 1.1.0 DMG built locally. Install waits for the owner's upload to finish. Nothing pushed.
- 2026-10-27 owner yes: deploy the Mac-made proxy plus the scaled encode limit, swap in the new Mac app, and face fixes 1+2 (split SAM objects into runs; face-shaped boxes only). Fix 3 (SAM chunking) not asked for yet. Owner asked whether "On this Mac" was hardcoded to 0: no. It reads the drive cache's real total; the smart cache (5 GB cap, tiers, 15% free-disk shrink) still runs, plus a 3-minute idle release.
- 2026-10-27 v1.0.3 "smart cache fix" pushed and tagged (3ce336f), Mac 1.0.3 DMG sha256 ae6d2afc…bdaa built. The GitHub release page creation was blocked by the permission check; the owner runs `gh release create` themselves.
- 2026-10-27 Production Studio rulings (owner):
  - R1: unit tests for core rules and parsers only.
  - R2: backend first; screens wait for the approved redesign mocks.
  - R3: act order is asked in the prompt only; the agent stays unchanged.
  - R4: coverage = local hybrid search + 1 batched Spark call.
  - Muse Image spike passed ($0.02).
  - Teammate ux-redesign is making redesign mocks for the PWA and Mac (mock only, owner approval before code).
- 2026-10-27 ux-redesign mocks ready for owner review: https://claude.ai/artifact/K5MEntZULmBio64LD3hLin (local copy docs/design/redesign/nimbytes-redesign.html).
  - 25-row audit; the top issue is that the storage copy still claims tiering, which R2 no longer does.
  - Suggested tier 1: copy fixes, 3-step status labels, search select mode, Studio rename, Mac "On this Mac" page.
  - 7 open questions are waiting on the owner. Nothing is implemented until approved.
- 2026-10-27 redesign rulings (owner):
  - Productions stays hidden until it works.
  - The tab is named "Studio".
  - Keep "Asked before · free" in search results.
  - The Mac default theme is Light.
  - Tier 1 is agreed, and the approved screens go on the design canvas as a "Redesign" row.
  - Phases are in docs/phases/15-ui-redesign.md (15.0 canvas + tokens, 15.1 tier 1 copy/labels/search/Studio, 15.2 Mac "On this Mac" page, 15.3 and 15.4 later tiers). Waiting for owner review before code.
- 2026-10-27 the design canvas has the "NEW · Redesign (approved 27 Oct)" row: version 26, P1–P6 and M1–M4, no Productions, Light Mac first. It is the source of truth for Phase 15; the review page K5ME… is superseded.
- 2026-10-27 owner ruling: **no deployments for now, everything local first.** The owner tests each feature thoroughly on the local stack (docker compose local + local web/Mac dev builds) before anything is pushed to the repo or deployed. Main hackathon development (Phase 14 Studio + Phase 15 redesign) starts now.
- 2026-10-27 owner ruling: **one R2 bucket for everything** (local stack and live server share it). No dev or second bucket. CORRECTION 2026-10-27: the local DB is a COPY of live: same user id `01a1795f…`, same clip ids, same keys. A local delete WOULD delete live media. Needs a local guard (owner decision pending). The single-bucket ruling stands.
- 2026-10-27 owner ruling (after the real local cut): story-cut act order stays **soft**; the agent is unchanged. The acts strip labels moments that are not in the plan and planned shots that are missing.
- 2026-10-27 owner ruling: **accept the risk** of the local stack being a copy of live (shared ids and keys in one bucket). No delete guard and no fresh local DB; the owner avoids deleting things locally. The local preview cleanup at start can also remove live previews older than 7 days (same rule as live).
- 2026-10-27 owner: "I already approved the redesign": the whole Phase 15 plan (15.0–15.4) is approved. Build it through without asking per phase; still verify and report.
- 2026-10-27 22:48 owner asked to sync live data into the local stack / dev build.
  - The local DB and search index are now a fresh copy of live (5 clips incl. the 60th birthday).
  - The previous local data (test productions and shorts) is in `data/backup-local-20261027-2248/`.
  - Local and live still share ids and keys in one bucket (risk accepted).
- 2026-10-27 owner: push + deploy + tag **v1.0.4 "Base Studio"**, stand the agents down, start fresh. Done: release with the Mac 1.0.4 DMG, live DB backed up before deploy, worktrees removed. The owner tests later.
- 2026-10-27 23:2x Mac 1.0.4 installed in /Applications (the 1.0.3 app is backed up in the scratchpad). It mounts `~/nimbytes` with the 5 live clips. The dev build (`~/nimbytes-dev`, local stack) is still running too.
- 2026-10-27 clean-up (owner):
  - the dev web servers (5173/5175) are stopped and the dev Mac app is stopped;
  - moved to the Trash: `~/nimbytes (old copies)`, `~/nimbytes-dev`, the nimbytes-dev Application Support folder, and the spike folders `desktop/drive-spike` and `desktop/fileprovider` (owner: trash, no archive);
  - `cargo clean --profile dev` freed 22.8 GB (release build files kept).
  - The repo is clean at v1.0.4. Only the installed Mac 1.0.4 and the local Docker stack are running.
- 2026-10-28 owner: redesign v2 for the Mac.
  - Rulings: **Night is the Mac look** (replaces "Light by default"); compact; the active link is teal text and icon with no pill; square thumbs in the grid and the list; a third right column; full player controls.
  - Renames: Library → Gallery, People & pets → Faces, Said → Speech.
  - Projects (folders) in Gallery. Settings redesign.
  - Mocks at https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3. Waiting for review; no code yet.
- 2026-10-28 owner ruling (clarified): **the demo account is capped at 250 GB**, so it cannot be abused.
  - The API enforces it (`STORAGE_FULL`); the PWA and the Mac app show it and pre-check.
  - Everything stops at the cap; warnings at 80% and 95%.
  - R2 has no native cap. Plan in `docs/phases/16-storage-cap.md` (waiting for review); it ships with the redesign v2 backend work.
- 2026-10-28 the owner approved the redesign v2 mocks and the 250 GB cap.
  - Rule: implement **exactly** the approved screens.
  - Canvas defaults taken: Projects, Mac first; Night default with Light/Match kept; renames on both builds.
  - Teammates `api-v2`, `web-gallery`, `web-player` are building. Plan: `docs/phases/17-redesign-v2.md`.
- 2026-10-28 redesign v2 + storage cap merged on local main (e3981ae).
  - Gates: web 724, api 558, desktop 58, render 37.
  - Local stack runs v2. The Mac dev build is running against it (installed 1.0.4 quit for the test; relaunch it after). The dev app needs the owner's passcode sign-in because its data was trashed.
  - Nothing is pushed or deployed.
- 2026-10-28 **v2.0.0 "nimbytes UI/UX enhancements" released and deployed.**
  - Live: migration 11, storage measured at 3.78 GB.
  - Mac 2.0.0 installed and mounted. The 1.0.4 backup is in the scratchpad.
- Found risks, offered to the owner (waiting for a yes):
  1. **Server disk:** 15 GB free, but ingest downloads the whole original, so a file over ~14 GB fills the disk. Proposal: an 8 GB per-file limit plus a disk check.
  2. **Release notes:** "right-click Open" is wrong on macOS 15+; it should be System Settings › Open Anyway.
  3. **Notarization:** needs the owner's yes for each Apple submission.
- 2026-10-28 Productions test on live: every render failed (concurrency 3 on 2 vCPU).
  - Fixed and deployed (owner yes): the render concurrency cap, Feed failing when its render gave up, full-picture covers (owner chose no band), and the Publish "Try again" button.
  - Mac 2.0.1 built locally and installed (no GitHub release; the DMG step hit hdiutil busy, the app is fine).
  - Local commits 61965d1..2.0.1 are **not pushed** (waiting for the owner's word).
- 2026-10-28 owner asked for compact mocks of the Short page, the Production page and Upload. Upload opens the Mac picker directly, with no Upload page.
  - Added V7–V9b to the redesign v2 canvas (Main got an `uploading` prop and a split Upload ▾ button).
  - Waiting for approval; no code. Note: the Tauri picker can do files OR a folder, not both, hence the split button.
- 2026-10-28 added V10a/b (Productions list compact + Delete production with an optional 'also delete its short'). The backend delete exists; this is UI only. Waiting for approval.
- 2026-10-28 **v2.0.1 released** (push, tag, release DMG, deploy, live DB backup `backup-20261027-2007-pre-v2.0.1`); Mac 2.0.1 installed; teammate worktrees removed.
- Next owner ask (mock first): compact Shorts list (drop the top-right New short), compact New production, a universal search bar at the bottom of the main column on every Mac screen, and a Studio visual audit.
- 2026-10-28 v2.2 mocks on the canvas: V11a/b Shorts compact (no New short), V12 New production compact, V13 + SearchBar universal search at the bottom of the middle column, and an audit note. Waiting for approval.
- 2026-10-28 end of day: **v2.0.2 released, deployed, installed.** Tomorrow the owner focuses on Meta AI capabilities. Open items are in the STATUS "END OF DAY" section.
- 2026-10-28 owner re-scoped Phase 20 (Meta depth) to **SAM 3.1 + Muse Image only**.
  - Dropped: Muse Wonder ("incredibly difficult"), Meta AI Connectors, OAuth, MCP, the assistant API and voice Ask.
  - Plan approved: `docs/phases/20-meta-depth.md`. Covers composite the real SAM cutout over a Muse Image background (Muse Image redraws anchored people as lookalikes).
  - Work starts Thu 29 Oct with the spikes; mocks before any UI.
- 2026-10-28 owner: do Muse Image first as a quick, closable track; SAM 3.1 features wait for the owner's pick. Phase doc rev 3.
- 2026-10-28 owner approved mocks V14–V17 and said go. Defaults taken: a separate short title (≤ 32), key art drawn automatically once, footage storyboards drawn automatically when a shot is covered.
- 2026-10-28 owner asked to add Rename production, then push and release **v2.0.3 "Muse Image Integration"**. Released and deployed (the owner allowed the server writes for the backup and deploy).
- 2026-10-28 owner picked SAM Track B: B1 (screens and number plates), B2 (keep subject in frame), B3 (Find this), B5 (cut-outs and real-person covers). Mocks V18–V22 posted.
- 2026-10-28 owner approved mocks V18–V22 and the dependency `@meta-sam/parser@0.1.0` (renderer only), and said go. Defaults taken: Find this includes faces when matching is on; Keep subject in frame on for every 9:16 export; the cutout cover background defaults to a Muse Image scene.
- 2026-10-28 owner: push Track B to main with no tag or release; deploy (the owner ran the backup and deploy commands); install Mac 2.0.4 locally to test.
- 2026-10-28 owner: GPS is parked for Field Survey. A place is the plan section; merges and revisits use section + time + PE similarity. Ingest stays unchanged.
- 2026-10-28 owner: a real public-good problem is the priority (not a shorts tool). Tools may be combined where Meta has no capability (for example speech output). Picked the "described video" direction, so nimbytes Access is drafted in `docs/phases/22-access.md`. Waiting on: Access instead of Field Survey, the hard rule 8 amendment, and the TTS choice.
- 2026-10-28 owner: Piper is the text-to-speech tool (speech output only; Meta does the understanding and writing). Third-party, labelled in the README.
- 2026-10-28 owner picked "Ready, Respond, Recover" (disaster safety for older people, community, global). The owner lives solo, so the tests use sample clips from DVIDS and Pexels/Pixabay. Study doc: `docs/phases/23-ready-respond-recover.md`.
- 2026-10-28 owner approved Phase 23 "Ready, Respond, Recover" as the public-good mode (Phases 21 and 22 parked). Mac + PWA compact, Contribute PWA-first. Clip shortlist pending.
- 2026-10-28 owner: licensed sample footage (DVIDS public domain, Pexels) is OK for the Respond/Recover demo, with credits, the no-endorsement line and blur. The self-imposed "only our footage" stance is updated in `docs/hackathon-rules.md`. Open item: the owner checks the official rules on third-party media.
- 2026-10-28 owner: Piper confirmed, no Tagalog voice is fine, go. Building Phase 23 (backend and renderer first; UI after mock approval).
- 2026-10-28 owner: English voice only (Piper `en_US-ljspeech`, public domain); other languages are shown as text. Mocks V23–V28 approved. The owner wants a ping when it is ready to test.
- 2026-10-28 23:00 owner: performance pass deferred to 29 Oct (phase 23 doc §9d). Measured: CPU idle; SAM detect at 110 s per call is the bottleneck; a bigger EC2 helps only 1.3–2×; Modal not used.
- 2026-10-28 owner asked for evidence that the slowness comes from Meta models. The investigation shows the main cause is our SAM request bug (413 too large, no store:false, retries); Meta per-call latency is secondary. Recorded honestly.
- 2026-10-28 23:50 owner tested Phase 23 locally: "confusing… I dont know what it does and what it wanted to be. It doesnt solve the problem to begin with." Building stopped; rethink tomorrow before more code.
- 2026-10-29 00:00 owner: revert to v2.0.4 (c52b4ca) and start the public-good idea from scratch. Done locally: Phase 23 kept on branch `parked/phase23`; DB restored to the pre-phase23 backup; tonight's sample clips deleted.
- 2026-10-29 owner picked Bystander Shield (privacy layer for glasses footage) from the idea list; brief + plan written to docs/phases/24-bystander-shield.md for review.
- 2026-10-29 owner: "I think I found my niche": My Words (a talk board from the person's own footage for people who can't speak; it speaks for them, it never acts). The glasses Wearables toolkit is not approved, so Point to Talk uses the phone camera and gaze uses iPad's built-in Eye Tracking (we build no tracking). Owner confirmed the scope ("THIS IS PERFECT"). Brief + plan docs/phases/25-my-words.md; mocks V29–V32 on the redesign-v2 canvas; waiting for review.
- 2026-10-29 owner approved Phase 25 My Words (brief, mocks V29–V32, decisions D1–D9): "prototype this build quick and fast so we can test its functionalities". Prototype uses browser speech and PE-only Point to Talk first.
- 2026-10-29 owner: rebuild ALL slides as punchy statements ("cluttered"), then: different font, sources at the bottom, real figures, reword slide 2. Deck now Archivo + Inter, 12 slides.
- 2026-10-29 02:50 owner: revert My Words ("hiccups… no awe-factor") and propose new features. Parked on parked/phase25; main reset to c9de127; local DB restored.
- 2026-10-29 owner: MMS-TTS voice played in silent mode on the iPhone; asked for a UK female voice, then ruled to stick with MMS-TTS. Asked for MyWay mocks next.
- 2026-10-29 owner: cancel QR codes and the domain (share track dropped); asked me to download demo videos instead of filming (Pexels laundry clips).
- 2026-10-29 05:20 owner: "fix it test, push commit and release it as 2.0.5" + "install the build into my machine": done (upload limit 2 files). Merge MyWay after the fix.
- 2026-10-29 06:40 owner MyWay test round: remove Make a short from Gallery; Gallery keep-actions format in player; drop MYWAY heading (Guides top-level); merge Hear+Show me into Play; rename guides. All done on test/myway. Then: "thoroughly refine all our UI/UX", ping when done.
- 2026-10-29 owner: fully remove Productions ("incredibly confusing"); Shorts can pick multiple footages; remove STUDIO heading; new sidebar section FEATURE with Guides + Shorts. Teammate studio-cut building on test/myway (tables kept, no destructive migration).
| 2026-10-29 | Phase 27 Ask box approved: 96 px box, plan card above it, "2 working" queue, hold to talk, intents search/upload/make_short/make_guide/add_to_project; goal = control every shipped feature by text or voice | spec docs/phases/27-ask-box.md | owner |
| 2026-10-29 | v2.2.0 "stable build" (Ask box + delete fix) pushed, deployed, released; version 2.2.0 chosen over 2.0.6 (2.1.0 already live) | | owner |
| 2026-10-29 | Guides renamed iGuide (copy only); iRead approved: photos + PDF (poppler OK), Mac + phone page under Features, 24 px answers, Read it to me = summary first | docs/phases/28-iread.md | owner |
| 2026-10-29 | Read-aloud switches to the device voice (Web Speech API: Mac/iPhone voices, natural, UK female if present); non-Meta allowed for this one; MMS-TTS kept as fallback | MMS sounded robotic/gibberish to the owner even after the speakable fix | owner |
| 2026-10-29 | v2.2.1 released ("minimal version jump"): iRead, iGuide/iRecall names, device voice, near-copies | live + DMG | owner |
