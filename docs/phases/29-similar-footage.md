# Phase 29: near-copies and same-moment footage (plan)

## Context
- Owner question (2026-10-29): "do we detect multiple video footage?"
- Today only **exact** copies are caught:
  - a name+size check before upload (`usecases/uploads.rs:286`);
  - a SHA-256 match during ingest (`usecases/ingest/duplicates.rs`), where the newer copy is marked `duplicate`, skips the AI steps, and leaves search.
- Missed today:
  - **near-copies**: the same video re-encoded, trimmed, resized, or exported again (from the phone, from Meta AI, from an editor);
  - **the same moment from two devices** (glasses and phone).
- We already store everything needed:
  - a 1024-d Perception Encoder vector per 5–10 s moment (`segment_vectors`, sqlite-vec, cosine, user-partitioned, `adapters/src/sqlite/vectors.rs:70 nearest`);
  - each clip's `recorded_at` (`domain/clip.rs:151`).
- No new model and no Meta cost.

## What the person sees (mock first, canvas row "Phase 29")
| Case | Gallery | Clip right column |
|---|---|---|
| Near-copy of an older clip | Tile badge **"Near-copy"** (like Duplicate) | "Looks like a copy of *Beach walk* (94% the same)". Actions: **Remove this copy**, **Keep both** |
| Same moment, other device | Tile badge **"2 angles"** | "Also filmed on another device", with thumbs of the linked clips that open them |
| Toolbar | A new chip **"Copies"** lists exact duplicates + near-copies, for clearing space | – |

- A near-copy is treated like an exact duplicate: it stops before the paid AI steps (no transcribe, describe or faces), stays out of search and is not counted.
- "Keep both" turns it into a normal clip and runs the rest of ingest.
- Same-moment clips are processed fully and only linked.

## Rules (pure domain `api/crates/core/src/domain/similar.rs`, unit-tested)
Inputs:
- the new clip's moments (vector, start, end);
- for each moment, its k=5 nearest moments in the owner's library (other clips only, ready or near-copy-pending);
- each candidate clip's duration and `recorded_at`.

| Verdict | When |
|---|---|
| `near_copy` of B | **All** of: ≥ 80% of the shorter clip's moments match B at similarity ≥ T_copy, the matches keep their order in time (monotonic), and the durations are within 25% OR the new clip is inside B (a trim) |
| `same_moment` with B | Both have a real `recorded_at` (not the upload time) within 10 minutes; ≥ 1 moment matches at similarity ≥ T_scene; not a near-copy |
| none | otherwise (time alone or one look-alike frame never links) |

- T_copy (≈ 0.94) and T_scene (≈ 0.85) are set by the calibration spike below, not guessed.
- The oldest matching clip is the original; ties go to the earliest `created_at`, as with exact duplicates.

## Build
| # | Deliver | Notes |
|---|---|---|
| 29.0 | **Test kit + calibration spike** (below) | sets T_copy and T_scene from data |
| 29.1 | Mocks on the canvas: badges, right-column sections, the Copies chip. **Owner approval** | mock-first rule |
| 29.2 | API: migration 0016 `clip_links (user_id, clip_id, other_id, kind, score, created_at)`; `domain/similar.rs`; ingest moves `embed` before `transcribe` (it needs only the thumbnails from `segments`) and adds `similar` after it; a near-copy stops there like a duplicate; `POST /api/clips/{id}/keep` (Keep both: clears the mark, resumes ingest); clip detail `links[]`; the list item `near_copy_of`; a one-off backfill over the existing library (worker backfill like titles) | handler + use-case tests; sqlite-vec adapter test on a temp DB |
| 29.3 | Web: badges, right-column sections, Keep both / Remove, the Copies chip; mock API data | lint/test/build |
| 29.4 | Owner test with the kit on the local stack, then on the real library | see "How we test it" |

## How we test it
**1. Unit tests (offline, fast).**
- Synthetic vectors cover: identical, noise ±0.02, trimmed subset, shuffled order (must NOT be a copy), unrelated, same time but unrelated (must NOT link), same scene at a time 2 hours apart (must NOT be same-moment).
- A sqlite-vec test on a temp DB for the k-nearest query across clips.
- Mutation checks: drop the order rule and the shuffled case fails; drop the time rule and the 2-hour case fails.

**2. A generated test kit** (`scripts/similar-kit.sh`, ffmpeg only, from the Pexels samples already in `data/samples/`).
- It writes `data/samples/similar/` plus `EXPECTED.csv`. Base: one 30 s clip, `base.mp4`.

| File | Made by | Expected |
|---|---|---|
| `reencode.mp4` | `-crf 32`, a different bitrate | near_copy of base |
| `resized.mp4` | 720p → 480p, 5% crop, slight colour shift | near_copy of base |
| `trimmed.mp4` | the middle 18 s of base | near_copy of base (inside) |
| `reexport.mp4` | base + a 2 s title card at the start | near_copy of base |
| `shuffled.mp4` | base cut in 3 and reordered | not a copy (order rule) |
| `angle_b.mp4` | a different crop window of the same source (left 65% vs right 65%), offset 1.5 s, `creation_time` = base + 40 s | same_moment with base |
| `same_time_other.mp4` | an unrelated Pexels clip with `creation_time` = base + 2 min | none (time alone) |
| `other.mp4` | an unrelated clip | none |

**3. Calibration spike, before any thresholds go in code.**
- Run the real PE ONNX (`api/models/pe`) on the kit's moment thumbnails and on the owner's 25 real clips.
- Print the similarity histograms: true pairs (kit rows above) vs every unrelated pair in the real library.
- Pick T_copy and T_scene with a clear gap: zero false links across the real library is the bar.
- Commit the numbers in `docs/phases/29-similar-footage.md`.

**4. End-to-end on the local stack.**
- Upload the kit through the Mac app.
- `scripts/similar-check.py` signs in with the demo passcode, reads each clip's `links` from the API, and diffs them against `EXPECTED.csv`, printing pass/fail per row.
- Then run the backfill on the owner's real library and list every link it made, so the owner reviews them by eye.
- **Cost:** the near-copies stop before the paid steps. The unrelated clips go through normal ingest (cents).

**5. Owner check.**
- In the Gallery: the badges and the Copies chip.
- Remove a near-copy; Keep both on another, which then becomes searchable.

## Risks
- **Static scenes** (a wall, a dark room) look alike everywhere. The order rule, the ≥ 80% coverage and the time window guard against false links, and the calibration is measured on the owner's real footage.
- **The `recorded_at` fallback:** clips with no real recording time never get same-moment links (we never use the upload time).
- **Changing the ingest order** (embed before transcribe) must not break resume. Covered by the ingest resume tests.

## Open decisions for the owner
1. Should a near-copy stop before the paid AI steps, like a duplicate (recommended, it saves cost), or be fully processed and just badged?
2. Is "2 angles" the right label for same-moment clips, or "Same moment"?

## Owner approval (2026-10-29)
Mocks V52–V54 approved as drawn: "Near-copy" / "Duplicate" / "2 angles" badges; "Looks like a copy" with the % shown; Remove this copy / Keep both; the Copies chip with "Remove all copies…". A near-copy skips the paid AI steps like a duplicate. Deploy after the owner tests the feature.

## Wire contract
- `ClipStatus` gains `near_copy` (like `duplicate`: not searched, not counted, no AI after `similar`).
- Clip list item gains `near_copy_of: {clip_id, title, score}|null` and `angles: number` (count of same-moment links).
- Clip detail gains `links: [{clip_id, title, kind: "near_copy_of"|"copied_by"|"same_moment", score, recorded_at|null, thumb_url|null, duration_s|null}]`.
- `POST /api/clips/{id}/keep` → 202: a near-copy becomes a normal clip and its ingest resumes from `transcribe`; 409-style VALIDATION_FAILED when it is not a near-copy.
- Delete stays `DELETE /api/clips/{id}`; "Remove all copies…" deletes each duplicate and near-copy (web loops, or `POST /api/clips/remove-copies` → `{removed}` if simpler; api teammate decides and tells web).
- Gallery filter "Copies" = status duplicate or near_copy (web-side filter).

## 29.0 Calibration results
Run 2026-10-29. Spike: `docs/phases/29-spikes/calibrate.py` (`ml/.venv/bin/python docs/phases/29-spikes/calibrate.py`). Full output: `data/similar-spike/report.txt`. Kit: `scripts/similar-kit.sh`.

**Method.**
- Moments match ingest exactly: the same scene filter (`gt(scene,0.3)`), a port of `segmenting::windows` (5–10 s), one thumbnail at each window's middle with `args::thumbnail` (`scale=640:-2 -q:v 3`). Embeddings: `api/models/pe/image.onnx` with the `meta.json` preprocessing.
- Check that the spike behaves like ingest: the owner's real "Doing laundry" clip, ingest thumbs (from the API) vs spike thumbs of `myway/laundry-task-720.mp4`: per-moment similarity 0.993–0.998.
- Similarity of a pair = for each moment of the shorter clip, its best match in the other clip. Coverage = share of moments with best ≥ T. Ordered = share whose matches keep time order (longest increasing run).
- Unrelated set: the owner's real library on the local stack (only **6 clips, 66 moments**, not 25) + 22 distinct sample videos (DVIDS storm debris, Pexels) + the kit's unrelated rows: 588 clip pairs, 2433 moment best-matches.

**Kit (base = `up720/A1_940064.mp4` 20–50 s, left 65% window, creation_time 2026-10-20T10:00:00Z).**

| File | Duration | Size | creation_time | Expected |
|---|---|---|---|---|
| base | 30.0 s | 1280x720 | 10:00:00 | original |
| reencode | 30.0 s | 1280x720 | 10:00:00 | near_copy |
| resized | 30.0 s | 854x480 | 10:00:00 | near_copy |
| trimmed | 18.0 s | 1280x720 | 10:00:00 | near_copy |
| reexport | 32.0 s | 1280x720 | 2026-10-22 18:30 | near_copy |
| shuffled | 30.0 s (thirds C, A, B) | 1280x720 | 2026-10-21 09:00 | none |
| angle_b | 30.0 s (right 65% window, +1.5 s) | 1280x720 | 10:00:40 | same_moment |
| same_time_other | 19.1 s (Pexels 6646681) | 1280x720 | 10:02:00 | none |
| other | 30.0 s (Pexels 14109231) | 720x1280 | 2026-09-14 | none |

**(a) Kit rows vs base.** Cell = coverage / ordered.

| row | n | min best | mean best | 0.80 | 0.85 | 0.88 | 0.90 | 0.94 |
|---|---|---|---|---|---|---|---|---|
| reencode | 4 | 0.984 | 0.987 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| resized | 4 | 0.957 | 0.965 | 100/100 | 100/100 | 100/100 | 100/100 | 100/100 |
| trimmed | 3 | 0.878 | 0.919 | 100/100 | 100/100 | 67/67 | 67/67 | 33/33 |
| reexport | 4 | 0.883 | 0.930 | 100/100 | 100/100 | 100/100 | 75/75 | 50/50 |
| shuffled | 4 | 0.645 | 0.854 | 75/50 | 75/50 | 75/50 | 50/25 | 25/25 |
| angle_b | 4 | 0.812 | 0.879 | 100/100 | 75/75 | 75/75 | 25/25 | 0/0 |
| same_time_other | 3 | 0.411 | 0.429 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |
| other | 4 | 0.401 | 0.469 | 0/0 | 0/0 | 0/0 | 0/0 | 0/0 |

Per-moment best vs base: trimmed 0.917 0.878 0.962; reexport 0.910 0.883 0.962 0.965; angle_b 0.884 0.812 0.880 0.938; shuffled 0.950 0.885 0.935 0.645.

**(b) Histogram, moment best-matches.**

| sim | near-copy moments | angle_b moments | unrelated moments | unrelated pair max |
|---|---|---|---|---|
| < 0.80 | 0 | 0 | 2397 | 569 |
| 0.80–0.85 | 0 | 1 | 31 | 14 |
| 0.85–0.88 | 1 | 0 | 4 | 4 |
| 0.88–0.90 | 1 | 2 | 0 | 0 |
| 0.90–0.94 | 2 | 1 | 0 | 0 |
| 0.94–0.96 | 2 | 0 | 1 | 1 |
| ≥ 0.96 | 9 | 0 | 0 | 0 |

- Max unrelated moment: **0.957** (one moment: the same agency logo slate in two DVIDS videos). Next: 0.863, 0.862, 0.857, 0.850, all storm-debris footage vs other storm-debris footage. p99.9 0.860, p99 0.813.
- The owner's real clips among themselves: max **0.621**.
- **Blank frames:** before the blank filter, 6 black thumbnails (one DVIDS video's black tail) matched each other at 1.000 and gave the only "unrelated" scores above 0.96. Blank vs any non-blank: max 0.528.
- Unrelated clip pairs with ≥ 80% *ordered* coverage: 1 at T 0.80 and 0.83 (two 2-moment clips, mean best 0.843), **0 at T ≥ 0.85**.

**Hard negatives: one long video, different non-overlapping parts (DVIDS 943308 a/c/d, ~240 s each).**

| pair | mean best | 0.85 | 0.88 | 0.90 |
|---|---|---|---|---|
| a vs c | 0.883 | 88/41 | 62/35 | 29/21 |
| a vs d | 0.855 | 59/26 | 29/18 | 6/3 |
| c vs d | 0.837 | 54/29 | 34/26 | 20/20 |

**Chosen thresholds.**

| Name | Value | Rule | Gap |
|---|---|---|---|
| T_copy | **0.85** per moment | near_copy needs ≥ 80% of the shorter clip's moments ≥ T_copy **in time order** (longest increasing run, not "all in order") | near-copy rows: 100% ordered; best non-copy (angle_b) 75%; unrelated pairs: 0 |
| T_copy_mean (new) | **0.90** | AND the mean best similarity over the shorter clip ≥ 0.90 | near-copies ≥ 0.919; angle_b 0.879, same-event 0.883, shuffled 0.854 |
| T_scene | **0.87** | same_moment needs ≥ 1 non-blank moment ≥ T_scene + both real `recorded_at` within 10 min | angle_b: 3 of 4 moments ≥ 0.87 (max 0.938); unrelated non-slate max 0.863; owner's library max 0.621 |
| Blank filter (new) | grey-level std < 12 (0–255) on the thumbnail | blank moments never match and never count toward coverage | black frames match at 1.000 otherwise |

**Why not the plan's guesses (0.94 / 0.85).**
- 0.94 per moment misses real near-copies: a trim or a re-export with a title card moves the 5–10 s windows, so a moment's thumbnail is taken a few seconds off its twin. trimmed falls to 33%, reexport to 50%. The per-moment threshold must stay low; the **mean ≥ 0.90** is what separates a copy from "the same place".
- At T_copy 0.85 alone, angle_b is one moment short of a near-copy (75% vs 80%), and the same-event pair a vs c has 88% coverage. The order rule (41%) and the mean rule (0.883) keep both out. Keep both rules; neither alone is enough.

**Answers.**
- **shuffled** fails as intended: 75% coverage, 50% ordered, mean 0.854. It fails coverage and mean too, so the kit does not isolate the order rule; the synthetic unit test must (shuffled vectors with 100% coverage). On real footage the order rule is load-bearing for the same-event pair a vs c. Its creation_time is a day after base: with a time inside 10 min it would be same_moment (max 0.950), which is acceptable.
- **angle_b links** as same_moment (max 0.938, 3 of 4 moments ≥ 0.87) and is not a near-copy (75% ordered, mean 0.879).
- **Caveat:** angle_b is a synthetic crop of the same camera. A real glasses-plus-phone pair has a different lens, height and exposure and will score lower. Test a real pair in 29.4 before trusting T_scene 0.87; if it misses, lower T_scene towards 0.85 (unrelated moments ≥ 0.85: 5, all same-topic stock footage, and the time rule still blocks them).
- **Caveat:** the local library has 6 clips, not the 25 on live. Re-run the spike on the live library's thumbnails before 29.4's backfill.
