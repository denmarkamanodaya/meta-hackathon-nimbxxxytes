# STATUS

## LIVE (2026-10-30 05:10 AWST): v2.3.0 beta: new sign-in, passcode <judging passcode>, README
- Mac 2.3.0 installed (DMG sha256 10f1ac80…43d0, released as v2.3.0 with the DMG; the site's Download link points at it). PWA deployed; live DB backup data/backup-20261029-2056-pre-v2.3.0.
- ⚠️ REMAINING: DEMO_PASSCODE is <judging passcode> (server .env and local .env; backups .env.bak-20261030-pre-<judging passcode> in both places). Change it back, or stop the box, as soon as judging ends (owner ruling 2026-10-30).

## LIVE (2026-10-30 04:45 AWST): demo video final, video/ code pushed (8249d91)
- Final render: video/out/nimbytes-demo-finale.mp4 (1:57). Problem opener (57M memory | 3× storage, sources) on the calm track (starts 1:20 in), then the promo on the product track; aurora gradient backdrop; rolling iGuide uses; iRead reads aloud for small print. Media and renders stay local (video/public, video/out ignored).
- Demo data still in the live library: recipe clip + guide, sample bill.

## NOTES (for future use)
- Workflows (the 10 background jobs + iRecall): docs/notes/workflows.md

## BACKLOG (owner, 2026-10-29)
- **PWA look and feel = the Mac app.** The PWA (phone, and any browser at the live URL) must use the same theme as the Mac DMG build: Night colours, type scale, button sizes, the sidebar/Features structure where the screen is wide enough. Today the browser shows the phone-first PWA layout and its own theme; the Mac layout only exists inside the Mac app (desktop mode). Plan: one theme in `web/src/design/tokens.css` for both, a wide-screen browser layout that reuses the Mac pages, mock first.

## NOW (2026-10-30 02:30 AWST): promo video final cut pushed (57fcc5c)
- video/ Remotion code pushed to main (owner reversed the local-only ruling); video/out, video/public (personal footage, licensed music), video/work, node_modules stay ignored. Render: video/out/nimbytes-promo.mp4 (1:26, calm dissolves, no whip-pans/blur per owner's eye comfort; music at fixed 0.35).

## NOW (2026-10-30): Phase 30 promo v3 rendered: video/out/nimbytes-promo.mp4 (2:32, 16:9), owner review
- v3 (owner notes 1–5): stats open the film; Get Info shows Zero bytes on disk + the 3.4 GB clip playing with three jumps; search by scene, speech and face; recipe iGuide from 5 Pexels clips (alleksana, joined); iRead snapped bill + device-voice read-aloud line (say) in yellow captions. More demo data in the live library: clip "Preparing rosemary chicken" + its guide, cached test searches.
- Owner called v1 "0 out of 10". v2 is promo style: night teal glow, two-tone kinetic headlines, real 4K Mac captures in a window with camera moves and rings, word-by-word captions, British female VO (Kokoro bf_emma, local, scripts/make-vo.py, loudnorm), music = owner's Pixabay track (camila_noir serene soundscape), b-roll = owner's own library clips.
- Composition `NimbytesPromo`: src/timeline.ts (built from VO lengths), src/promo/*Scenes.tsx, src/components/{Window,Headline,Captions,Backdrop}.tsx.
- Demo data added to the LIVE library (delete after the demo): clip "Adjusting appearance settings", iGuide "Change Screen Appearance Settings", iRead "Sunvale Water bill" (SAMPLE).

## NOW (2026-10-29 23:00 AWST): Phase 30 demo video: Store, iRecall, iRead recorded from Mac 2.2.2; iGuide + b-roll + VO pending
- Recordings in video/public/recordings (screencapture of the Mac app, driven by AppleScript + a Swift click tool in the session scratchpad). iRecall typed (spoken via `say` did not reach the mic). A SAMPLE water bill (fictional Sunvale Water) is in the live iRead library: delete after the demo. iGuide waits on a task clip (owner films, or the Pexels laundry clip).
- `video/` (local only) renders out/nimbytes-demo.mp4: 5400 frames, 30 fps, 1920×1080, 180 s. 19 unit tests pass. Waiting on the b-roll, 4 recordings and the voice-over (docs/phases/30-demo-video.md, video/README.md). Drop the files into video/public/ and run `npm run render`.

## LIVE (2026-10-29 21:10 AWST): v2.2.2 released (Mac) + PWA parity deployed
- v2.2.2: main 7d564ea pushed, tag + GitHub release with nimbytes-for-mac-2.2.2-universal.dmg (sha256 04ab4fbe…feac), installed in /Applications. `.env` download link now points at v2.2.2 (ships with the next deploy).
- PWA parity ec59bc0 pushed: Night first + Night/Light/Auto theme on the phone, status bar colour follows the theme; a browser window >= 1100 px wide at load gets the Mac layout (sidebar, Gallery with sort/type/add-to-project, projects, Shorts, iGuide, iRead, Settings) with drive/Finder/Final Cut/offline hidden; Upload opens the web Upload page. Checked by hand in Chrome on dev:mock (wide + 390 px phone).
- DEPLOYED 2026-10-29 ~21:10 AWST: SSH rule set to <owner IP>/32 (targeted apply; a full plan wanted to REPLACE the instance, likely a new AMI: never run an untargeted apply on infra/stacks/app); live DB backup data/backup-20261029-1252-pre-v2.2.2; health ok, Night theme-color live, download link v2.2.2, no api errors. Mac DMG not rebuilt: the parity commit only changes browser paths.

## NOW (2026-10-29 20:10 AWST): 5 Mac UI refinements built on main (local, not pushed), owner testing
- 6e039c9 Shorts first under FEATURES; 56921c7 select bar "Add to project ▾" (projects + New project…), list view ticks in Select mode, Type column ("Video · MOV" from the file name), every list header sorts (click again flips; the toolbar menu keeps its 4 named orders, a header sort shows as "Size ↓"); 2b52693 Settings › Appearance › Text size 85–130% plus ⌘/Ctrl +, −, 0 (Tauri webview page zoom, permission core:webview:allow-set-webview-zoom).
- Owner ruled: build straight without the canvas mock for this batch.
- Gates ran: web lint, 1235 tests, build + build:desktop, desktop cargo build. Not run: the real Mac app (needs a DMG build); zoom + narrow-list kick-in traced only.

## LIVE (2026-10-29 17:20 AWST): v2.2.1 released, deployed, installed
- main = e9edbee (merge of test/iread + version 2.2.1), pushed; tag v2.2.1 + GitHub release with DMG (sha256 749c073b…ad31). Live DB backup /srv/nimbytes/data/backup-20261029-0905-pre-v2.2.1.
- Live: health ok, migrations 0015+0016 applied, pdftoppm present, near-copy backfill queued 25 clips, no warn/error logs. Mac 2.2.1 in /Applications.
- Not yet run on live: an iRead upload, the device voice in the signed app, near-copy links on the live library (review them after the backfill).

## NOW (2026-10-29 17:20 AWST): iRead upload fix merged (925bfee), owner testing
- Bug: Mac app document PUT to the presigned R2 URL was blocked by bucket CORS (origin tauri://localhost not allowed); the doc stayed "uploading" and the page said "Reading…" forever.
- Fix: PUT /api/documents/{id}/source (raw file through the API, ≤20 MB) on every platform; failed adds show the error and clean up; uploads stuck >2 min show "This upload didn't finish" with Try again / Delete.
- Gates: Rust 888, web 1216 + builds. Verified: a 2-page PDF through the new route → ready, read correctly.
- Owner's stuck doc 01a186a8… left in place to show the stuck state; delete it from the app.

## NOW (2026-10-29 16:50 AWST): Phase 29 near-copies built, tested end to end on test/iread (1d6feb0), owner testing
- Merged feat/similar-web + feat/similar-api + 1d6feb0 (a copy never links as a same moment). Gates: Rust 883, web 1206 + lint + builds.
- Migration 0016 applied locally (backup data/backup-local-20261029-1558-pre-similar). Backfill over the 6 real clips: 0 links (no false positives).
- E2E kit (scripts/similar-upload.py + similar-check.py): 9/9 PASS. reencode/resized/trimmed/reexport → near_copy of base (0.92–0.99); shuffled, same_time_other, other → none; angle_b → same_moment (0.94).
- Thresholds T_COPY 0.85, MEAN_COPY 0.90, T_SCENE 0.87, blank std < 12. Re-check T_SCENE on a real glasses+phone pair.
- Follow-ups: exact-duplicate SQL still ignores near_copy (a re-upload of a near-copy's file is marked a duplicate of it); the copy-status SQL fragment repeats in 13 places.
- Deploy only after the owner tests (owner ruling). test/iread also holds Phase 28 (iRead, iGuide, speech, device voice).

## NOW (2026-10-29 17:20): Phase 29 near-copies + same moments: mocks up, kit + calibration running
- Plan docs/phases/29-similar-footage.md (defaults taken: a near-copy skips the paid AI steps like a duplicate; label "2 angles").
- Mocks: canvas row "Phase 29" (V52–V54) + sticky with 3 decisions; owner approval pending.
- Teammate similar-spike: scripts/similar-kit.sh (8 test clips + EXPECTED.csv), PE calibration (thresholds), scripts/similar-check.py.
- test/iread still holds the unmerged Phase 28 work (iRead, iGuide rename, speech, device voice); owner to say merge/release.

## NOW (2026-10-29 16:40): device voice merged on test/iread (32ba4b4), owner testing
- Owner ruling: read-aloud uses the device voice (Web Speech API) app-wide; MMS-TTS is the fallback. CLAUDE.md rule 8 exception added.
- Also: e4d9c0e re-speaks stale summary voices on open (the owner had heard the old pre-fix summary WAV).
- Web 1153 + lint + builds; Rust 844. Chrome on the Mac picks Karen (en-AU); no en-GB natural female installed (download Serena/Kate in System Settings > Accessibility > Spoken Content to get UK).
- Not run: Tauri WKWebView speech, iPhone Safari (silent switch), iRecall card in a browser.

## NOW (2026-10-29 15:30): Phase 28 fixes merged on test/iread, owner testing
- feat/iread-ui (iRead uses iGuide classes; iRecall placeholder), feat/speech (speakable text: numbers/money/phones/dates/units/URLs as words, clause pauses, VOICE speak1) + 4f4ed77 (years in full, VOICE speak2) merged. Gates: Rust 843, web 1114 + builds.
- Root cause of the garbled voice: the MMS vocab has only a-z, 0-6, ' - ; 7-9 and every symbol were dropped.
- Verified: Voice Transcribe on the new answer audio reads "You owe $142.60. Please pay by the 14th of November. 2026" (before: "You old pozesty…"). Mic STT checked 3/3 OK (one doubled word once); DIARIZATION kept; ENDPOINTING is an option for voice notes.
- Disk cleanup: removed 9 merged worktrees + docker build cache + api/target (127 GB free).

## NOW (2026-10-29 14:10): Phase 28 iRead integrated on test/iread, owner testing (Mac dev app + phone via tunnel)
- test/iread = main 9edb145 + feat/iguide (2bba5a2) + feat/iread-web (3 commits) + feat/iread-api (8 commits, migration 0015, poppler).
- Gates: Rust 829, web 1111 + lint + both builds, desktop 64, render 112.
- Local DB backup data/backup-local-*-pre-iread; local stack rebuilt (0015 applied, pdftoppm in image).
- Real end-to-end (curl): bill photo uploaded, read ready (title, kind bill, summary exact, summary voice), ask "how do I pay this?" correct, 16.8 s voice in 4 s; intent "read my water bill…" → read_document with that doc.
- Not run: real camera/PDF pick in the apps, real mic, iOS autoplay. Mac native picker filter (28.5) not added; Mac uses the HTML file input.

## NOW (2026-10-29 13:15): Phase 28 iRead APPROVED, building on test/iread
- Owner approved mocks V46–V51 as drawn (iRead under Features; 24 px; Read it to me = summary first; Mac page preview).
- Teammates: iread-api (feat/iread-api: migration 0015 documents + read job, pdftoppm, Spark read/answer prompts, ask/speak voice, read_document intent, poppler in Dockerfile), iread-web (feat/iread-web: Mac + phone iRead pages, Ask box read_document + answer card, mock API). Contract: docs/phases/28-iread.md "Wire contract".

## (earlier) Phase 28: mocks on the canvas
- Plan + spike: docs/phases/28-iread.md. Owner rulings: photos + PDF (poppler in the api image), Mac + phone iRead page.
- Mocks: canvas row "Phase 28 · iRead" (V46–V51) + sticky with 4 decisions.
- Spike: Spark read a photographed bill and a 2-page PDF exactly; grounded answers; ~$0.05. Prompt fixes noted.
- iGuide rename DONE: 2bba5a2 (feat/iguide) merged into test/iread (5b117fe); web 1054 + Rust 765 green. API/web iRead teammates start after mock approval.

## LIVE (2026-10-29 12:35): v2.2.0 "stable build" released, deployed, installed
- main = 9edb145 (merge of test/ask + version 2.2.0), pushed; tag v2.2.0 + GitHub release with DMG (sha256 6805be0a…fbb3). Live health ok, /api/transcribe + /api/intents up, no warn/error logs. Live DB backup /srv/nimbytes/data/backup-20261029-0429-pre-v2.2.0. Mac 2.2.0 in /Applications.
- Owner first asked for "2.0.6"; it would go backwards from the live 2.1.0, owner chose 2.2.0.
- Not yet run on live: voice through the signed app, a real intent run.

## NOW (2026-10-29 12:05): Phase 27 Ask box on branch test/ask (main checkout), owner testing in the Mac dev app
- test/ask = main + feat/ask-api (028ce74, 4f0c735) + feat/ask-web (6 commits) + 200fd25 (native body_base64 for voice) + 96fad08 (quiet border, accent on focus, owner ask).
- Gates on test/ask: Rust 764, web 1054 + lint + both builds, desktop 64, render 112. Local api rebuilt from test/ask (/api/transcribe + /api/intents up). Intent spike 10/10 right.
- Not yet run: real voice through WKWebView + Transcribe; real intents against the local api in the app.
- Owner says "merge" to fold test/ask into main; revert = `git checkout main` + rebuild api.

## NOW (2026-10-29 11:45): Phase 27 Ask box APPROVED, building
- Owner rulings: box stays 96 px; plan card above the box; "2 working" queue; HOLD to talk; intents search, upload, make_short (clips/project/search), make_guide, add_to_project. Spec + wire contract: docs/phases/27-ask-box.md.
- Teammates: ask-api (feat/ask-api: POST /api/transcribe, POST /api/intents + intent prompt), ask-web (feat/ask-web: MacAskBox, plan card, queue, hold-to-talk, mock API). Lead: 2c2d80c mic usage text + audio-input entitlement (wry grants mic to the page by default).

## (earlier) Phase 27 Ask box: MOCKS on the canvas
- Plan: ~/.claude/plans (Phase 27). Canvas W3EF8HVDXBKnwAjcr96Vu3: "Phase 27 · Ask box" row, AskShell (clickable flow) + V39–V45b, sticky with 5 decisions.
- Also local only, not pushed: d7e4818 (search field always accent, strip meets sidebar foot, Shorts subtitle + Plan a production gone, Guides header button gone). Mac dev app running from main for the owner to test.
- Build only after the owner approves the mocks; spike mic in the Tauri webview + Spark intent first.

## LIVE (2026-10-29 10:55): v2.1.0 deployed + main pushed (ef31625)
- Live https://3-104-132-162.sslip.io runs main; health ok, /api/productions 404, /api/guides 401; MMS-TTS files on the box. Live DB backup: /srv/nimbytes/data/backup-20261029-0246-pre-v2.1.0.
- SSH rule <rule-id> changed by aws cli to <owner IP>/32 (owner yes). Terraform state still says <owner IP>/32, and `terraform plan` on infra/stacks/app wants to REPLACE the instance (AMI/user-data drift): never apply that stack without reading the plan.
- Mac 2.1.0 installed in /Applications (sha256 21fbd6d2…9c2b). Tag v2.1.0 + GitHub release DONE (owner ran them; DMG asset 13.1 MB).

## NOW (2026-10-29 10:32): test/myway MERGED into main (local, not pushed)
- main = 99f5902: merge 91c0505 (Guides, Productions removed, multi-clip shorts, Features nav, UI polish) + untrack of the api/models symlink that 9a5d386 committed by mistake.
- Incident: that tracked symlink made the merge replace the git-ignored api/models/ folder. Restored: mms-tts-eng copied from ml/out; PE re-exported (fp32 image + int8 text, --check passed 20/20).
- DB backup before switching: data/backup-local-20261029-1031-pre-myway. Main stack running from main; /api/health ok, /api/productions 404, /api/guides 401 (route exists).
- Guides made during testing live only in .worktrees/myway-test/data (the copy), not in main's DB.
- Teammates web-guides2, ux-pass, studio-cut sent shutdown. Live box and Mac release untouched (still v2.0.5).
- Owner rulings 10:40: "Features" (already so), "Not a face" removed (e86329b), "Blur hidden faces" (already so). Open: filter chip placement; deploy only on owner word.

## NOW (2026-10-29 06:40): MyWay on test branch, owner polish round, UI/UX pass running

- MyWay runs on branch **test/myway** (`.worktrees/myway-test`): merges of feat/guides-api + feat/guides-web, plus 30bcb28 (one shared ONNX Runtime environment: the voice failed to load next to PE), 9a5d386 (PATCH /api/guides/{id} rename) and 25a4d80 (owner changes: Make a short removed from the Gallery; Gallery keep actions in the player; MYWAY heading gone, Guides under Faces; Hear + Show me merged into ▶ Play; rename on Mac ⋯ / right-click and phone). Gates: Rust 773, web 1011, render 112, all green.
- The test stack runs from the worktree (`COMPOSE_PROJECT_NAME=nimbytes`, data = a COPY in `.worktrees/myway-test/data`; main's `data/` is untouched; main's stack is stopped). Laundry demo clip (Pexels) is uploaded there and made a 10-step guide with SAM circles on 6 steps. The Mac dev app runs from the worktree (`make desktop-dev`).
- Owner asked for a thorough UI/UX refine; teammate `ux-pass` is auditing every Mac (vite desktop-mock :5176) and phone (mock :5175) screen and fixing polish only (redesigns listed for mocks). Then: owner says merge or revert.
- 2026-10-29 07:30: DONE on test/myway: b0c0ea0 (api: Productions removed, tables kept, /api/productions 404), f78de2f (web: Productions removed; multi-clip shorts via Gallery Select + a pool of up to 20 moments, round-robin, best first; sidebar FEATURES = Guides + Shorts, phone tab "Features"; ux-pass polish: one sticky 53 px Mac header, phone step-1 Back, Faces naming, Gallery list hides Recorded/Size under 1200 px, Guides count + one accent button, phone clip sticky bar, "Suggest matching faces", "MyWay" gone from the UI). Gates: Rust 713, web 997 + lint + both builds, render 112. Owner decisions open: filter chip placement, Faces "Not a face", "Blur bystanders" vs "Blur hidden faces", FEATURES vs FEATURE. Follow-ups: unused productions rows and R2 objects, Finish page reachable only by URL, SHORT_POOL_MAX is a hand copy of MAX_SHOTS.

## LIVE FIX (2026-10-29 05:20): v2.0.5 released, Mac uploads

- Owner reported live uploads failing in the Mac app (19 picked files). Cause: every picked file uploaded at once, 4 parts each, so about 76 parallel 8 MB PUTs shared the home uplink. A lone test part crawled at 14 KB/s and was reset; parts hit the 600 s `PART_TIMEOUT`. The server and storage were fine (health 200, 3.8 of 250 GB).
- Fix bcf4ad9: at most 2 files at a time (a Semaphore in `ExportsService`, `FILES_AT_ONCE`), the rest show Waiting. Test mutation-checked. Gates: 61 tests, clippy, fmt.
- Pushed main (c0659de), tag v2.0.5, GitHub release with `nimbytes-for-mac-2.0.5-universal.dmg` (sha256 c07f8cb3…41ee). Installed on the owner's Mac and relaunched; the saved uploads resume. The live server was not redeployed, so the PWA "Download for Mac" link still points at an older DMG.
- Next: owner retests uploads; then merge MyWay (`.worktrees/guides-api` + `guides-web`, both done, uncommitted).

## NOW (2026-10-29 03:30): Phase 26 MyWay APPROVED, step 26.0 (notes + spikes)

- Plan: `docs/phases/26-myway.md` (pros/cons, D1–D11, wire contract, phases 26.0–26.8). Owner rulings: MMS-TTS (Meta) for narration, no Polly; QR guide links via a Cloudflare Worker + R2 public prefix; printable PDF via Cloudflare Browser Rendering; GPU spot worker only if the S2 trigger fires.
- Ideas parked for later: `docs/ideas/2026-10-29-remember.md` (Point to Remember, Last Seen, Voice Book; owner likes 1 and 2).
- S2 voice PASSED: MMS-TTS ONNX (eab0a2f), 0.26 s for 3.6 s of speech on the Mac; it played on the owner's iPhone in silent mode. The owner asked about a UK female voice (not possible with MMS) and ruled: stick with MMS-TTS.
- Mocks V33–V38 are on the redesign-v2 canvas (local copy `docs/design/redesign-v2/Mac*Guide*`, `Guide*.dc.html`); the Sidebar's reverted Safety section is replaced by MyWay › Guides. **Waiting for owner approval** plus the 5 canvas questions.
- 2026-10-29: owner approved mocks V33–V38 ("perfect go"; decisions 1, 2, 3, 5 yes; domain open, so workers.dev first). Build started: teammates `api-guides` (`.worktrees/guides-api`), `web-guides` (`.worktrees/guides-web`) and `share-guides` (`.worktrees/guides-share`: the Cloudflare Worker in `share/` plus `infra/stacks/share/`). Build contract = phase doc "Build contract additions". MMS model staged at `api/models/mms-tts-eng/` (git-ignored).
- Owner cut QR, share links and the domain. `share-guides` stood down. Demo footage downloaded (Pexels, `data/samples/myway/laundry-task.mp4`). **S1 Spark steps PASSED** (10 steps, 17 s, plain video). Next: merge api-guides + web-guides, then the first live run on the laundry clip (S3 SAM circles = part of it).

## NOW (2026-10-29 02:50): Phase 25 My Words REVERTED; main = c9de127 (v2.0.4 + SAM store:false + WORKERS)

- Owner tested My Words and ruled to revert: eye tracking inaccurate (Apple calibration), no speech on the phone, "the hiccups will make it harder for us to win… no awe-factor". All Phase 25 work is on local branch `parked/phase25` (10 commits incl. the README rewrite ce600c4, the still-photo crop fix 4892af5 and the Perth test). Local DB restored from `data/backup-local-20261029-0205-pre-phase25`; the Phase 25 DB is in `data/backup-local-*-phase25-final`. Phase 25 R2 tile photos (`users/{u}/words/`) were left in place (delete needs an owner yes). Next: new feature ideas with an awe factor.

## NOW (2026-10-29 00:00): REVERTED to v2.0.4 (c52b4ca), starting the public-good idea from scratch

- The owner tested Phase 23 "Ready, Respond, Recover" locally: "confusing… doesn't solve the problem… way too complicated for demo and judging". The owner ruled to revert.
- Local `main` was reset to c52b4ca, which equals origin/main and the live server (v2.0.4 content). Nothing was ever pushed.
- **All Phase 23 work is kept on local branch `parked/phase23`** (31 commits, ec9f448). Teammate worktrees are removed.
- Useful generic fixes on that branch, if wanted later: SAM `store:false` (d4672c0), which also protects Find this / Cut out / reframe from 413 on large clips; `WORKERS` env (6ac8310).
- Local DB restored from `data/backup-local-20261028-2129-pre-phase23` (migration 13). The Phase 23 DB is saved in `data/backup-local-*-phase23-final`.
- Tonight's 14 sample uploads were deleted via the API; the 5 original clips remain. The Phase 23 R2 leftovers were deleted too: `users/{u}/rrr/` (1,006 objects, 153 MB) and `users/{u}/plans/` (26 objects, 16 MB), both now 0. The other prefixes were untouched.
- Docs kept as a record: phases 21 (Field Survey), 22 (Access) and 23 (RRR), the investigation `docs/investigations/2026-10-28-latency.md`, the clip shortlist, and the samples in `data/samples` (4.7 GB, git-ignored).
- Next: problem-first restart (feedback memory "problem first, one visible outcome").
- 2026-10-29: the owner picked **Bystander Shield**. Brief + plan in `docs/phases/24-bystander-shield.md`, **waiting for owner review**. No code yet.
- 2026-10-29 (later): the owner found the niche: **My Words**, a talk board built from the person's own footage for people who can't speak (tap, Point to Talk with the phone camera, iPad's built-in Eye Tracking). Brief + plan in `docs/phases/25-my-words.md`; mocks V29–V32 on the redesign-v2 canvas (local copy `docs/design/redesign-v2/Words*.dc.html`). **Waiting for owner review** (decisions D1–D9, canvas orange note). No code yet. The glasses Wearables toolkit is NOT approved, so no live glasses camera.
- 2026-10-29: **owner APPROVED Phase 25 (brief, mocks V29–V32, D1–D9) and asked for a quick prototype.** Contract = phase doc Part C. main = c9de127 (cherry-picked 144d3db SAM store:false + c9de127 WORKERS). Teammates `api-words` (`.worktrees/words-api`, feat/words-api) and `web-words` (`.worktrees/words-web`, feat/words-web) building; lead reviews + merges. Nothing pushed.
- 2026-10-29: **Phase 25 prototype MERGED to local main** (api 5d462df, web 45a48f2, merges af1bb7f + 10b7399, Perth test 7592c60; README rewrite ce600c4). Gates on main: Rust 771 passed, web 1016 passed, lint + build OK. New: migration 0014 (rebuilds jobs, adds word_boards / word_tiles / word_tile_vectors), env `WORDS_UTC_OFFSET_MIN` (default 480), routes /api/words/*, PWA /words, /words/talk, /words/point (link on the Faces page). Not yet run: the local stack with 0014, a live discovery (Meta calls), camera, speech and Eye Tracking on real devices. Worktrees removed, teammates stood down. Nothing pushed. Deck rebuilt (12 statement slides, Archivo + Inter): https://claude.ai/artifact/WoMrRPmE6EkmFcQbjJypfQ


Updated: 2026-10-27 (Perth) · Latest release: **v1.0.1** (nimbytes for Mac), https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/tag/v1.0.1 · v1.0.0 = PWA release

## Start here (new agent or new session)

1. Read `CLAUDE.md`, all hard rules. Then this file, then `LEARNING.md` "Top lessons", then the
   newest rows of `MEMORY.md`.
2. Run the app locally:
   - `aws sso login --profile nimbytes`
   - `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build`
   - `cd web && npm run build`
   - open https://localhost or http://localhost:5173. The passcode is in `.env`.
3. Mock-only UI: `cd web && npm run dev:mock` and open http://localhost:5175.
4. Phone: run the cloudflared command in `CLAUDE.md` "Commands". The URL is random and changes on
   every restart.
5. Before any change, read the package's `CLAUDE.md` and `docs/contracts.md`. Never push without the
   owner's word. Never run `terraform apply` without an owner yes for that one action.

## What is done (all on `main`, tagged v1.0.0)

| Area | State | Where |
| --- | --- | --- |
| Upload | Resumable presigned multipart from the phone; checks for duplicates before upload | `web/src/services/upload/`, `POST /api/uploads*` |
| Ingest | Pipeline: probe (SHA-256 hash), proxy, derivatives, segments, transcribe, describe, title, faces, embed, index, ready. An exact copy stops at probe with no model calls | `api/crates/core/src/usecases/ingest/` |
| Understanding | Muse Spark facts per segment and clip title; SAM 3.1 faces (people **and pets**); Voice Transcribe turns and speakers; PE vectors | `api/prompts/`, `adapters/src/meta/` |
| Search | Spark rewrite → BM25 + PE KNN → RRF → Spark rerank with reasons; results report `took_ms` / `cached` / `cost_usd` and faces | `core/src/usecases/search.rs` |
| People & pets | Per-clip tracks; name / hide; overview with "Who's this?", named people, hidden list. Face matching is opt-in (Settings): PE proposes pairs, Spark confirms, the owner says yes | `GET /api/people/overview`, `/api/settings`, `POST /api/tracks/name` |
| Duplicates | Exact copies (hash) marked `duplicate`, left out of search, people, storage and the planner; "Remove copy" (`DELETE /api/clips/{id}`) | migration 0006 |
| Agentic editor | Plan (with search tools) → Remotion preview → Spark critique → revise up to 2 times; budgets 12 calls / 6 lookups / 240 s / $0.25; live step stream | `core/src/usecases/shorts/`, `render/` |
| Rendering | Remotion composition shared by the in-app Player and the renderer container; captions white with the spoken word in `#FFE58A`; end card with the logo | `render/src/composition/` |
| PWA (Mist redesign) | Library (storage card), Search, Clip, Make a short, People & pets, Shorts list, Upload; light only; self-hosted fonts; reload waits for `GET /api/session` | `web/src/`, mock `docs/design/mist/` |
| Logo | Teal tile, white cloud, 3×3 bytes (filled and outlined teal). One source: `render/src/composition/LogoMark.tsx` | `web/public/icons/` |
| Infra | S3 bucket in Sydney; CORS allows `https://localhost`, `:5173`, `*.trycloudflare.com` and `https://3-104-132-162.sslip.io`. **Judging server LIVE:** t4g.large `<instance-id>`, https://3-104-132-162.sslip.io (~$2.30/day running; stop it when idle with `aws ec2 stop-instances --profile nimbytes --instance-ids <instance-id>`). Deploy with `scripts/deploy.sh --ssh-key ~/.ssh/nimbytes_ed25519` | `infra/stacks/` |
| Tests | Rust 393, web 363, render 23 at v1.0.0; all offline. No e2e suites (owner rule) | `make gates-*` |

Measured: about $0.11 per clip end to end; about $0.05 per agent short; search 3.6 s cold and 0.04–0.06 s
cached; face-match check $0.0012 per pair.

## Current work: Phase 10, nimbytes for Mac

Plan in `docs/phases/10-mac-app.md`, **awaiting owner review before code**. Rulings: full app in the
window with local media; unit tests for risky logic; local server now, judging box at release; no
notarization for now.

## Current work: v1.1 (`docs/phases/11-v1.1-storage-search.md`)

- **2026-10-27 09:13 UTC: the judging server runs on Cloudflare R2** (phase 12.4 done; details in `docs/phases/12-r2-migration.md`). The same deploy shipped the v1.1 work: instant search, delete, and the one-status Sync page. **v1.0.2 released** (R2, instant search, delete, Mac 1.0.2). **12.6 done: S3 fully deleted.** The team was stood down so the next session starts fresh with the owner's bug list. The PWA "Download for Mac" link still points at v1.0.1 until the next deploy (`.env` already updated). The local `.env` now has `STORAGE_PROVIDER=r2`, so the local stack uses R2 after its next restart. The DB backup is in `/srv/nimbytes/backup-20261027-0903/`.

Approved 2026-10-27, in this order:
1. C, instant search.
2. D, Sync page mock.
3. A, File Provider spike.
4. A + B.
5. D build.

E (lighter proxies) is optional, owner's call.

## NEXT: Phase 20 rev 3, Muse Image first, then SAM 3.1 (waiting for owner review)

- Plan: `docs/phases/20-meta-depth.md`. No code yet.
- Track A (Muse Image, no SAM): cover titles, redraw with words, style picker, storyboards from footage, project/production art. It closes by Fri 30 Oct.
- Track B (SAM 3.1): the owner picks from B1–B6. The suggestion is B1 + B2 + B3, plus B5 if the mask spike passes.
- Dropped: Muse Wonder, Connectors, OAuth, MCP, the assistant API and voice Ask.
- 2026-10-28: **Track A building.** Mocks approved; spikes passed ($0.04). Teammates `api-image`, `render-still` and `web-image` work in worktrees; the lead merges. Wire contract: phase doc "Track A wire contract".
- **NOW: Phase 23 "Ready, Respond, Recover" building.** Teammates `api-rrr` and `render-rrr` (Piper inside the render image) work in worktrees. Mocks V23–V28 are on the canvas, waiting for owner approval before any UI code. Spec: phase doc §9c.
  - 2026-10-28 23:40: **local Helene run complete, ready for the owner's test.** 9 of 12 contributions done; 3 clips failed on local R2 upload timeouts (home uplink, 4 workers). 70 incidents (tiers 1/2/3 = 11/41/18), 12 "probably the same" groups. The overlapping cuts merged (Maria 2, Sam 4, Lee 3 joined). Area inferred for Chris from a street sign. Situation report and draft dispatch written. Ana's Ready plan done (81 s English audio, 4 cards, Tagalog text).
  - Fixed tonight:
    - `store:false` on SAM (d4672c0); detect now 25 s and succeeds.
    - The incident is stored before its window link (ec9f448); the in-memory store enforces the foreign key.
    - Sightings fold within 15 s, max 12 per clip (41a8c96).
    - `WORKERS` env (6ac8310).
  - Known: the board is noisy (fusion recall low, as spike R2 predicted). Tomorrow: the performance pass + fusion tuning.
  - **TOMORROW FIRST (29 Oct): the performance pass**, in the phase doc §9d; investigation `docs/investigations/2026-10-28-latency.md`. The main cause is our SAM request bug (inline base64 without store:false, 413 after ~2.5 min, retried 3×), not Meta model speed. SAM detect takes 110 s per call (1280 px, sequential concepts), and every step runs one call at a time. Plan P1–P6; Modal not used.
  - 2026-10-28 21:40: render + api merged on local main (f6a0b52; api 804 tests, render 134). Local stack rebuilt (DB backup `data/backup-local-*-pre-phase23`).
  - Helene event + 4 sample residents created. Uploading 12 clips (943308 cut into 4 overlapping pieces + 6 A1 + 2 negatives).
  - Fix in progress (api-rrr): contribute must accept clips still processing. web-rrr is aligning to the final shapes.
  - Sample clips downloaded 2026-10-28: 24 clips, 3.1 GB, about 45 min, in git-ignored `data/samples/` (dvids/, pexels/, with `SOURCES.csv`). 938842 had its audio removed (unlicensed music). Pixabay blocked downloads, so its one clip was dropped.
  - Quick-look mocks V23–V26 are on the redesign-v2 canvas.
  - Spikes R1–R5 done (≈ $0.25): SAM works on disaster footage with short nouns; Spark pair check has no false merges but low recall (two-level fusion); Piper runs on arm64 but has no Tagalog voice; the Ready plan is grounded; area from street signs works.
- **2026-10-28: Track B pushed to main (c52b4ca), deployed and installed; no tag or release (owner).** Live DB backup `/srv/nimbytes/backup-20261028-1000-pre-trackB/` (the owner ran the backup and the deploy). Live health ok; `blur_objects` served; renderer parser loaded. Mac 2.0.4 installed (DMG built locally, not released; the 2.0.3 copy is in the scratchpad).
- **2026-10-28: Track B merged on local main (dae85fd), not pushed.** Gates: api 707, web 944, render 104.
  - Proven live on the local stack: Find this ("purple car", 16.8 s, outline + hits) and Cut out ("dog", 9.9 s, PNG + sticker).
  - The lead fixed three seams:
    - the mock's crop_path had no source_aspect;
    - saving settings re-queued the face-matching job (now idempotent);
    - Find this listed unrelated clips (now needs at least 0.5 similarity).
  - Drift tests now read the renderer's own samples (both mutation-checked).
  - Local DB backed up to `data/backup-local-*-pre-trackB/`. The Mac dev app runs against the local stack.
  - Follow-ups: cut-out PNGs are not deleted with their clip; the Short page preview has no screen/plate blur.
- **2026-10-28: Track B building.** Mocks V18–V22 and the `@meta-sam/parser` dependency approved. Teammates `api-sam`, `render-sam` and `web-sam` work in worktrees. Spec: phase doc "Track B wire contract".
- **2026-10-28: Track B (SAM 3.1) picked: B1, B2, B3, B5.** Spikes passed (~$0.05; facts in docs/meta-api.md). Mocks V18–V22 are on the redesign-v2 canvas. Waiting for approval plus the dependency yes for `@meta-sam/parser@0.1.0`. No code yet.
- **2026-10-28: v2.0.3 "Muse Image Integration" RELEASED** (main 9653301, tag v2.0.3, release with the DMG). Deployed to the judging server after the live DB backup `/srv/nimbytes/backup-20261028-0735-pre-v2.0.3/`; health ok; new fields live. Mac 2.0.3 installed in /Applications (the 2.0.2 copy is in the scratchpad). Next: the owner picks the Track B SAM features.
- (earlier) v2.0.3 ready, not released. Main 9653301, plus production rename (PUT /api/productions/{id}). Gates: api 629, web 865, render 64.
  - DMG `nimbytes_2.0.3_universal.dmg`, sha256 ea664c8b…0f40, codesign ok.
  - Blocked: the live DB backup and the deploy (remote shell writes) need the owner. After the deploy: push, tag, release.
  - Follow-up: a rename made while the plan is still running is overwritten when the plan saves its title.
- **2026-10-28: Track A merged on local main (5e8037d..c5efea9), not pushed.** Gates: api 621, web 855, render 64, all green; clippy and lint clean.
  - The lead fixed two seams: Use as cover answers `{platforms}` (the web read `{started}`); Publish keeps polling until the titled cover is baked.
  - Cover still props are now checked against `render/fixtures/cover_still.sample.json`.
  - Follow-ups: on a busy short, the redraw and more-covers handlers answer "busy" before the ownership check; project art at 16:9 is untested on Muse Image.
  - Local DB backed up to `data/backup-local-*-pre-phase20/` before migration 0012.
- Renderer part merged on main (31032dc): CoverStill + `POST /still`; render 64 tests green.
- Follow-up for the owner (not fixed): the captions and end card ask for Geist 800, but only 400–600 is bundled, so they render at 600.
- 2026-10-28: Track A mocks V14–V17 are on the redesign-v2 canvas (https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3; local copy `docs/design/redesign-v2/`). Waiting for owner approval; no code before it.

## END OF DAY 2026-10-28: v2.0.2 released, deployed and installed

- Releases today: v2.0.0 (redesign v2 + 250 GB cap), v2.0.1 (compact Studio pages, direct Upload, render fixes) and v2.0.2 (universal search, compact Shorts and New production).
- Live: healthy. Backup before each deploy; the latest is `/srv/nimbytes/backup-20261027-2041-pre-v2.0.2/`.
- The owner's Mac runs 2.0.2. Every teammate worktree is removed. Gates: web 818, api 558, desktop 60, render 40.
- **Tomorrow (owner plan): focus on Meta AI, harnessing its powers.** Candidate from today: caption translation via Muse Spark (no speech dubbing, no video generation in the Meta API).
- Open items:
  1. A search query costs one Spark call per settled query (350 ms debounce). Consider a longer debounce or local-only results until ⏎.
  2. Speech grouping fetches clip details client-side. An API field `SearchResult.matched_turn` would remove that.
  3. A failed picked upload tile stays until restart.
  4. Not tried on the real Mac: native pickers, cancel, ⌘K in WKWebView, Final Cut handoff.
  5. Older open items: notarization, the 8 GB per-file limit plus a disk check, R2 CORS for Mac brand uploads, the face-box backfill, Density / Logo corner / blur-all / Not a face.

## RELEASED v2.0.0 "nimbytes UI/UX enhancements" (2026-10-28)

- The owner tested the Mac dev build: "perfect… exactly what's on my mind".
- Pushed main 709a798, tag v2.0.0, release with the Mac 2.0.0 DMG.
- Deployed to the judging server. Live DB backup is `/srv/nimbytes/backup-20261027-1831-pre-v2.0.0/`.
- Mac 2.0.0 is installed in /Applications (the 1.0.4 copy is in the scratchpad).
- Teammate worktrees are removed (branches kept).
- Open items:
  - Density / Logo corner / account-wide blur / "Not a face" have no backend yet;
  - R2's 7-day abort rule is unverified;
  - the earlier list (R2 CORS for Mac brand uploads, the face-box backfill, the render 404 retries,
    "Removed removed", Published marking).

## Redesign v2: build log (approved 2026-10-28)

- The owner approved the mocks and the storage cap (local stack risk accepted): "comply the same exact
  approved mocks/screens".
- Build plan `docs/phases/17-redesign-v2.md`. Teammates `api-v2` (17.1), `web-gallery` (17.2) and
  `web-player` (17.3) work in worktrees; the lead merges in 17.4.
- No push or deploy until the owner tests.
- **2026-10-28 merged on local main (d65f348):** api-v2 + web-gallery + web-player + the lead's desktop commands
  (`free_up_space`, `login_get/set`, the tray check follows Settings).
- Gates: web 720, api 558, render 37, desktop 58.
- Local stack rebuilt on v2 (DB backup `data/backup-local-*-pre-v2`). Verified there:
  - R2 usage 3.78 GB of 250 GB;
  - Projects CRUD, the duplicate/colour refusals, idempotent add and the clip filter;
  - with the cap temporarily at 4 GB: level warn, and a 1 GB upload start gets 507 STORAGE_FULL (restored to 250).
- Open: web-gallery is closing the project page gaps (Shorts made, Search in this project, Rename, no badge
  on project tiles, Quick look). Then the Mac dev build for the owner.
- Accepted deviations to report: "So far" cost, PNG/JPG logo, Density / Logo corner / Blur-all disabled,
  "Not a face" disabled, "of 250 GB" in the Gallery header.

### Earlier: mocks review

- Canvas https://claude.ai/artifact/W3EF8HVDXBKnwAjcr96Vu3 (local copy `docs/design/redesign-v2/`).
- Asks: Night Mac look, compact, teal active link (no pill), square grid + list, a right column (Moments /
  Speech / Faces + actions), full player controls, renames (Gallery, Faces, Speech, Brand), Projects,
  and a Settings window.
- No code until the owner approves. Open questions are on the canvas: Projects vs Folders, Projects on
  the PWA, Night only, renames on the PWA.
- Storage cap 250 GB (owner ruling): plan `docs/phases/16-storage-cap.md`, waiting for review.
- After approval: a phase doc in `docs/phases/17-redesign-v2.md`. Projects needs a backend (migration +
  endpoints).

## RELEASED v1.0.4 "Base Studio" (2026-10-27 23:10 Perth)

- Pushed main 4018f90, tag v1.0.4, release
  https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/tag/v1.0.4 (Mac 1.0.4 DMG).
- Deployed to the judging server; live DB backup is `/srv/nimbytes/backup-20261027-1508-pre-v1.0.4/`.
- The owner tests the Mac dev build and live later.
- All teammates stood down; their worktrees are removed (branches kept). The next session starts fresh.
- **Open:**
  1. Mac brand uploads need R2 CORS for the app origin (cloud config; owner).
  2. Live clips have no face boxes yet. `FACE_BOXES_BACKFILL=1` for one start is needed before blur works on old clips (ask first; $0 SAM).
  3. The drive retries render sizes that 404 every 30 s.
  4. "Removed removed" in the change list.
  5. No "Published" marking.
  6. The positioning doc rows on S3 tiering are stale.

## Local stack data (2026-10-27 22:48)

- Local DB + index = a copy of live (5 clips incl. the 60th birthday). The old local data is in
  `data/backup-local-20261027-2248/`.
- The owner tests the Mac **dev build** (`make desktop-dev`: https://localhost, `~/nimbytes-dev`) before any push or deploy.

## Working mode from 2026-10-27 evening (owner ruling)

**Local only.** No deploys and no pushes until the owner has tested each feature on the local stack.
Teammates commit on their worktree branches; the lead merges into local `main` after review and
gates, then hands the owner a local test checklist.

## Released: v1.0.3 "smart cache fix" (2026-10-27)

- Pushed and tagged at 3ce336f. Mac DMG 1.0.3 (sha256 ae6d2afc…bdaa) built.
- Release page published: https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/tag/v1.0.3
  (asset `nimbytes-for-mac-1.0.3-universal.dmg`).
- The PWA "Download for Mac" link (`VITE_MAC_DOWNLOAD_URL`) still points at v1.0.1 until the next
  deploy updates `.env`.

## In progress: Phase 14 Production Studio (owner ruled R1–R4, see the phase doc)

- 14.0a Muse Image spike done.
- 14.1 + 14.2 backend MERGED into local main (f4ff86d) and verified end to end on the local stack (4 shots, 4 boards, coverage 3/4). 14.3 story cut MERGED (942bc7b); a real local cut was ready in about 3 min; act order soft (owner).
  14.4 privacy blur MERGED (45b4301..c5cf7cf; api 510, render 32, web 571).
  - Real local check: the hidden dog's face is blurred in the preview.
  - The backfill flag is off by default.
  14.5 brand kit MERGED (a510c46; api 518).
  - Real local check: logo upload, `PUT /api/brand`, a branded plan with 4 anchored boards.
  - The test kit = the nimbytes logo + default teal + Bricolage, so the owner's look is unchanged.
  - Follow-up: the renderer loads no fonts (headless falls back to system fonts).
  14.6 publish MERGED (9ea2b4a; api 533, render 35).
  - Real local publish: one 1080x1920 vertical, per-platform captions and hashtags, 3 covers each, feed reuses the 4:5, about 1 min.
  - Follow-ups MERGED (0024014, 3f23560, 5c4c16f): renderer brand fonts, export cleanup on delete, designed covers (accent band, logo, 3 styles, no text; the model may restyle details such as number plates).
  Studio BACKEND COMPLETE (14.1–14.6).
  Studio SCREENS MERGED (10393c6..2c0fc1f, d67a3e0): Productions switch and list, New production, production page, acts strip + Director's notes, Finish, Publish, Brand kit sheet, New production in the + sheet. Web 641 tests.
  - Lead checked the real local stack in Chrome (localhost:5173): list, production page with storyboards and coverage, story page (acts strip with not-in-plan and missing), Publish with real covers.
  - Open:
    - Mac brand uploads PUT straight to R2 from the WebKit window, which needs R2 CORS for the app origin (a cloud config change: owner);
    - no "Published" marking on share;
    - the existing change list says "Removed removed…" (doubled word).
  REDESIGN 15.0–15.4 COMPLETE on local main (20ceda7; web 602 tests): On this Mac, Mac Library icons and filters, People cards, Upload, Clip detail, Studio grid + Mac inspector, the + create sheet. Follow-up: MAX_DRAFTS through the contract (studio-api).
- Redesign: the owner ruled (Productions hidden, Studio, Light Mac default, tier 1 agreed). Plan `docs/phases/15-ui-redesign.md` APPROVED. 15.0 + 15.1 MERGED into local main (1a62823..322b87e; web 571 tests, both builds). Not pushed; the owner tests locally.
  Follow-ups from redesign-web:
  - the Mac selection bar sits a tab-bar height up;
  - the `/50` score is still hard-coded in ShortScore and DraftScoreCard (use `SCORE_MAX`);
  - tiering comments remain in `services/api/types.ts` and `client.ts`;
  - the clip page says "Processing failed" instead of "Could not process".
  15.2+ waits for the owner's go.
- Studio screens wait for the approved redesign.

## Phase 14 plan

`docs/phases/14-production-studio.md`: analysis, drift against the brief, rule conflicts R1–R4, phases
14.0–14.7. No code until the owner rules on section 7.

## Current work: faster processing (2026-10-27 evening, local commits, NOT deployed)

- Owner asked why a 3.4 GB clip took about 16 min on the box (5.5 min of 83 Mbit/s HEVC 10-bit).
  - The software HEVC decode on 2 cores dominates: about 9.5 min for the proxy at about 0.6x real time.
  - Encoder settings make no difference (measured: decode alone takes the same time).
  - Mac hardware via `avconvert` makes the same proxy in 18 s.
- Built:
  - api 4c0d96b: `POST /api/uploads/{id}/proxy`. The ingest proxy step uses an uploaded proxy
    that matches, else encodes, with a limit of 8x the length (15 min to 4 h).
  - desktop 35de3cd: avconvert proxy, sent before completing.
  - desktop 896da38: played footage is freed after 3 min unread.
  - Gates: api 448 tests; desktop 58.
- **DEPLOYED 2026-10-27 12:00 UTC** (proxy, scaled limit, face fixes, migration 0008); health 200.
  - Faces backfill: 5 jobs done, all SAM calls cache hits ($0.00).
  - The birthday clip went from 7 tracks to 35; the dog clip still has 1.
  - Mac app 35de3cd installed; the drive mounts.
- Owner said yes to the deploy and the Mac swap.
  - First deploy stopped before load; redeployed with face fixes 3237c90.
  - DB backup: `/srv/nimbytes/backup-20261027-1154/nimbytes.db` (integrity ok, 5 clips, 18 jobs).
  - Migration 0008 adds job kind `faces`. The worker backfills one faces job per ready clip at
    start (SAM cache, $0).
- Speech search already exists: transcripts are in the search index (`SegmentDoc.transcript`).
- Faces: teammate face-check found that SAM is fine and our grouping was wrong (see LEARNING).
  Fixed in 3237c90: runs split at cuts, and face-shaped boxes only. Not built: SAM chunking
  (fix 3), and a false positive from a banner photo.

## Current work: Phase 13, zero bytes on disk (`docs/phases/13-zero-bytes-drive.md`)

- **Owner priority, 2026-10-27:** "Zero bytes on disk" is a headline feature and it is NOT built.
  The Mac app is still a mirror: every proxy, auto originals and every render download into
  `~/nimbytes` (183 MB measured). The NFS drive spike (`desktop/drive-spike/`, untracked) proved
  it works, but it was never wired in. Phases D1–D6 are in the phase doc.
- **Built 2026-10-27 (local commits 9bae6c8, ad6d916, 8ab21b7, not pushed; Rust gates green, 53 tests):**
  - The drive is wired in and the mirror is gone. `~/nimbytes` is an NFS mount served by the app:
    `Library/` originals and `Shorts/` renders (render size probed with a 1-byte Range, no API
    change), `Projects/` FCPXML, and `Exports/` backed by `Application Support/nimbytes/exports`.
  - The chunk cache stores one file per 1 MiB chunk, because APFS fills sparse gaps.
  - The smart cache has a 5 GB cap that shrinks below 15% free disk. The owner's Mac is at 17% free.
  - The window streams from the cloud (`media_lookup` always returns null).
  - First launch moves the real `~/nimbytes` to `~/nimbytes (old copies)`.
  - **Live check passed (scratch harness on the drive code, scratch mount, no app):**
    - Finder's on-disk value is 0 before playback and after a preview read;
    - a full read is byte-identical and caches only what was read;
    - Exports writes land in staging, and Library is read-only;
    - quit unmounts; a crash leaves a soft mount that errors in about 7 s, and relaunch recovers
      with the cache kept.
    See LEARNING.
  - **Mac 1.1.0 DMG** built locally. Install waits for the owner's upload to finish (the
    installed app is uploading). Not pushed or released.
  - **Not done:** Desktop alias icon (D6).
  - **Left out:** segment prefetch for shorts, and a "Free up space" button (web, mock first).
- **Done before this (local commits, not pushed):** "On this Mac" showed 0 bytes (a77cd86). The
  native side never sent `cache_bytes`; it now walks the folder. That walk must change to the
  cache directory in D2. Search shows a spinner until the final answer. The Mac Library is the
  search (4ef806c). Mac 1.0.3 DMG built locally (a9fb591).
- **Midnight dark theme merged** (c4d967e, cherry-picked from the teammate's worktree branch; web
  gates: lint passes, 555 tests pass, both builds pass).
  - Dark is for the Mac build only, through `data-theme`; the PWA stays light.
  - The System / Light / Dark setting sits at the bottom of the Sync page.
  - Open owner questions:
    1. Is the Sync page the right place for the setting?
    2. Dark danger colour `#FF7A6B`?
    3. A Geist 700 alias?
    4. A 2px focus ring everywhere?
    5. The "Original" badge uses the accent fill on every linked row?
    6. Is a dark-only warning colour OK?
  - Native window background and the menu-bar menu still follow the system.
- **Teammate `mac-midnight`** (done): builds the Mac dark theme "Midnight" in a worktree
  (`web/` only, brief `~/Downloads/nimbytes-mac-dark-theme.md`, mocks D0–D5).

## Mac app status (2026-10-27)

- **Released as v1.0.1** (tag `v1.0.1`, commit 9d1d4e0):
  https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/tag/v1.0.1, with the asset
  `nimbytes-for-mac-1.0.1-universal.dmg` (sha256 cc695bb4…9d8d).
- Signed with the Developer ID, not notarized (first open: right-click → Open).
- The server is fixed per build: release uses https://3-104-132-162.sslip.io and `~/nimbytes`; dev
  uses https://localhost and `~/nimbytes-dev`.
- The bundle's internal version string is still 1.0.0. Bump `desktop/src-tauri/tauri.conf.json`
  next time.
- Rebuild: `NIMBYTES_SERVER_URL=https://3-104-132-162.sslip.io make desktop-dmg`.
- The PWA on the server shows "nimbytes for Mac · Download" in Settings on desktop browsers.
  `VITE_MAC_DOWNLOAD_URL` in `.env` is baked in by `scripts/deploy.sh`.
- Owner end-to-end test of the Mac app is in progress: menu bar, Resolve import, Exports round trip.

## Remaining items (in order)

| # | Item | Owner | Notes |
| --- | --- | --- | --- |
| 1 | Owner checks v1.0.0 in the browser and on the iPhone (tunnel). The dog copy was deleted 2026-10-27 (DELETE 204, its 9 S3 objects went to 0). Face matching switched on once live (setting saved; the library has only 1 visible face, so no pairs yet) and back off | owner | Delete is permanent; S3 versioning is off. The real PE embed and different-face Spark calls are not yet seen live |
| 2 | 5–10 demo clips with real faces and speech | owner | Needed for face-match calibration and the demo |
| 3 | Calibrate face matching: `PROPOSE_MIN` 0.70 and Spark confidence 0.7 on same-person and different-person pairs; record in `LEARNING.md` | api | Only tested so far on an identical copy |
| 4 | Measure "browses like local" on the iPhone: first-frame time, whether Safari reuses cached video; adjust the pitch | lead | `docs/positioning.md` "Smart storage and caching" |
| 5 | Judging server: `terraform plan` for the app stack (t4g.large), owner yes, `scripts/deploy.sh`, `RENDER_CONCURRENCY=2`, add the sslip.io origin to S3 CORS (owner yes) | lead | About $2.30/day running; stop when idle |
| 6 | Seed the demo library on the box; check a fresh export (yellow captions, logo end card) | lead | Not yet seen in an MP4 |
| 7 | Demo video ≤ 3:00 | owner + lead | `docs/demo-video.md` |
| 8 | Phase 9 README: built-during-event commit list, third-party (re-check the Remotion licence), quality, setup; `cargo deny` and license-checker once | lead | `docs/phases/09-submit.md` |
| 9 | Submit (track Indie Developer, theme Build for Your World); confirm the deadline time zone | owner | Q4 below |
| 10 | Later, optional: near-duplicate detection (re-encoded or trimmed copies) with PE segment vectors plus a Spark confirm | api | Plan A6 |
| 11 | After judging: `terraform destroy` app, then storage (owner yes each); delete the old Docker images | owner + lead | |

## Owner inputs

| # | Input | Status |
| --- | --- | --- |
| 1 | `MODEL_API_KEY` in `.env` | ✅ |
| 2 | AWS SSO profile `nimbytes` (account <aws-account>). The token lasts hours: run `aws sso login --profile nimbytes` when the API logs "SSO token has expired" | ✅ (re-login as needed) |
| 3 | Demo clips with faces and speech | ⬜ by Tue 3 Nov |
| 4 | Yes for each terraform apply or destroy | storage ✅; app ⬜ |

## Open questions

| # | Issue | Impact | Resolution |
| --- | --- | --- | --- |
| Q4 | Exact submission deadline time zone on Nov 4 | Could lose the last day | Owner checks the submission page |
| Q5 | Domain (nimbytes.app / .io, about $12–15/yr) for a branded link | Tunnel and sslip links are random | Parked by owner 2026-10-27 |

## Event teardown (after judging)

`terraform destroy` in `infra/stacks/app`, then `infra/stacks/storage`, owner yes for each. The state
files are backed up in `~/Backups/`.
