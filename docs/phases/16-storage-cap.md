# Phase 16: storage cap of 250 GB (plan, for owner review)

Owner ruling (2026-10-28, clarified): **the demo account is capped at 250 GB**, so nobody can abuse
it during judging.
- It is enforced everywhere: the API, the web/PWA and the Mac app.
- Everything stops at the cap.
- Warnings appear at 80% and 95%.

It ships with the backend work for redesign v2. **No code until the owner approves this plan.**

Where it is enforced:
- **The API is the gate.** A check only in the app can be bypassed with a direct API call, so the
  server refuses the write with `STORAGE_FULL`.
- The PWA and the Mac app read the same usage and cap from the API. They show the meter and
  block before an upload starts. They never hold their own copy of the number.

## Facts checked

- R2 has **no bucket size limit setting**. The limits page lists storage per bucket as unlimited,
  and going over the free 10 GB adds charges rather than blocking writes. The app must enforce the
  cap itself. Source: https://developers.cloudflare.com/r2/platform/limits/ and /r2/pricing/.
- There is one bucket, `<r2-bucket>` (owner ruling). Live and the local stack write to it, so the
  cap is the **bucket total**, not one server's view.
- The bucket holds more than originals:
  - Mac-made or server proxies;
  - thumbnails and face crops;
  - short renders and 9:16 exports;
  - storyboard frames and covers (Muse Image);
  - brand files.
- Incomplete multipart uploads also take space until they are aborted.
- Today `domain/storage.rs::summarize` adds up **originals only** (`clip.size_bytes`). It still
  carries S3 tiering words ("resting", Intelligent-Tiering), which are stale since R2 (a known open
  item).
- `BlobStore` (`ports/storage.rs`) has no list or size call. The R2 bucket is not in Terraform: the
  `infra/modules/storage` module is the old S3 bucket.

## Design

1. **One source for the cap.** `[storage] account_cap_gb = 250` in the server config (beside
   `config/prices.toml`), read once at start and applied per account. Today the only account is the
   demo one. There are no literals in code.
   `GET /api/storage` returns `{used_bytes, cap_bytes, level: ok|warn|high|full}`. The PWA and
   the Mac app read it.
2. **Measure the account's real usage.**
   - Every object key starts `users/{user_id}/`, so `BlobStore::used_bytes(prefix)` runs
     ListObjectsV2 over that prefix and sums `Size`. The total counts the account's originals,
     proxies, thumbnails, face crops, renders, exports, storyboards, covers and brand files.
   - Keep the result in a `storage_usage` row per account (bytes, measured_at).
   - Refresh it at start, every hour, and after each completed upload, render, export and delete.
   - A pure rule turns (measured, reserved, incoming, cap) into allow or deny, with unit tests.
3. **Reserve before writing.**
   - At upload start (`usecases/uploads.rs`), the check is: measured + reserved in-flight uploads +
     the file size + a proxy allowance ≤ cap.
   - If it fails, the upload is refused with `STORAGE_FULL`, and nothing is presigned.
   - The reservation is released when the upload completes or is aborted.
   - The same check runs before renders, exports, storyboards and covers, each with its own size
     estimate.
4. **Incomplete uploads.**
   - Abandoned uploads are aborted after 24 h by the existing stale upload sweep (to be verified).
   - The bucket's abort rule for incomplete multipart uploads is checked. R2's default is 7 days.
5. **Show it.**
   - The storage line reads "X of 250 GB".
   - Warnings appear at 80% and 95%.
   - When full, the Upload screen (phone) and the Mac upload and Exports folder explain why, and
     suggest deleting duplicates or old clips.
   - The redesign v2 mock gets these states once rulings 2 and 3 are made.
6. **Fix the stale summary.** It drops the resting/frequent tiering (R2 has one class) and reports the
   bucket total next to originals.

## Owner decisions

| # | Question | Ruling (2026-10-28) |
| --- | --- | --- |
| 1 | What is capped | **The demo account at 250 GB.** Everything the account stores counts. Enforced by the API, shown and pre-checked by the PWA and the Mac app |
| 2 | What stops at the cap | **Everything:** uploads, renders, exports, storyboards and covers |
| 3 | Warnings | **80% (200 GB) and 95% (237.5 GB)** |
| 4 | Local stack (open) | It shares the live user id and bucket, so local writes count toward the same 250 GB. Recommended: accept |

## Checks

- Unit tests for the allow/deny rule: the edge at exactly 250 GB, reservations, and release on
  abort.
- A mutation check on the rule.
- A local test with the cap set to the current usage plus 10 MB: a bigger upload is refused with
  `STORAGE_FULL`, and a small one passes.
- Deploy only on the owner's word.
