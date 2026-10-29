# Phase 1 — Upload and storage

**Day:** Wed 28 Oct (morning) · **Depends on:** Phase 0 (bucket, workspace, shell)

## Goal

From the phone, pick several clips from the gallery and get them into S3 reliably, with real
progress, surviving a flaky connection. A completed upload registers a clip (`status = uploaded`)
and queues its ingest job.

## Tasks

| # | Task | Owner | Notes |
| --- | --- | --- | --- |
| 1.1 | Demo session: `POST /api/session` with passcode from env → signed cookie; extractor that yields `UserId` for every handler | api | `tower-cookies` or `axum-extra` signed cookies |
| 1.2 | `core::keys` — the only S3 key builder (`original(user, clip, ext)`, `proxy_720p`, …) per `docs/data-model.md` | api | DRY: no key literal anywhere else |
| 1.3 | `POST /api/uploads`: create clip row (`uploading`) + S3 multipart upload; part size 8 MiB (16 MiB if file > 1 GiB); presign all part URLs (15 min) | api | `aws-sdk-s3` presigning |
| 1.4 | `POST /api/uploads/{id}/parts` re-presign for resume; `POST …/complete` → `CompleteMultipartUpload`, clip `uploaded`, enqueue `ingest` job | api | Verify size via `HeadObject` |
| 1.5 | `SqliteJobQueue` + worker loop skeleton: claim with `UPDATE … SET status='running' … RETURNING`, `step` column, exponential backoff, max 3 attempts | api | Steps are no-ops until Phase 2 |
| 1.6 | Upload screen: `<input type="file" accept="video/*" multiple>`; per-file card with progress bar, speed, state; 3 parts in flight per file; one file at a time | web | Read `ETag` header from each PUT |
| 1.7 | Resume: store `{upload_id, clip_id, done_parts[]}` per file fingerprint (name + size + lastModified) in IndexedDB; on return, re-presign missing parts | web | localStorage fallback in try/catch |
| 1.8 | "Keep this screen open" notice + Screen Wake Lock while uploading (re-acquire on `visibilitychange`) | web | iOS Safari 16.4+ supports it |
| 1.9 | Library screen stub: list clips with status chip (`uploading`/`uploaded`/`processing`/`ready`) polling `GET /api/clips` every 3 s | web | Full library in Phase 4 |

## Unit tests

| Test | Covers |
| --- | --- |
| `core::keys` builds every key in `docs/data-model.md` exactly; rejects ids with `/` or `..` | DRY key source, path safety |
| Part planning: part size 8 MiB / 16 MiB threshold, part count, last-part size, S3's 10,000-part limit | 1.3 |
| Upload use cases with fake `BlobStore` + `Catalogue`: create → complete registers clip `uploaded` and enqueues one `ingest` job; complete with a missing part → `UPLOAD_INCOMPLETE` | 1.3, 1.4 |
| Handlers: another user's `upload_id` → 403 `FORBIDDEN`; no cookie → 401 | 1.1, ownership |
| `SqliteJobQueue` on a temp DB: two concurrent claims never get the same job; backoff sets `run_after`; 3rd failure → `failed` | 1.5 |
| Web: resume state (fingerprint, done parts, which parts to re-presign); ETag collection; Wake Lock re-acquire on `visibilitychange` with a mocked `navigator.wakeLock` | 1.6–1.8 |

## Acceptance checks

- [ ] Upload 3 clips at once from the iPhone over the HTTPS tunnel; all reach `uploaded`.
- [ ] Toggle airplane mode mid-upload, turn it off, reopen the screen: upload resumes from the last
      finished part, not from zero.
- [ ] S3 object size equals file size; key matches `users/{user}/originals/{clip}.{ext}`.
- [ ] Requests for another user's `upload_id` return `FORBIDDEN`.
- [ ] Gates pass.

## Risks

- iOS Safari kills uploads when the tab is backgrounded: the notice + Wake Lock + resume covers it;
  say so in the demo instead of fighting it.
- The gallery picker on iOS may hand over a transcoded copy (H.264) instead of HEVC; both paths must
  work in Phase 2.
