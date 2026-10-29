# Phase 12: move media storage from AWS S3 to Cloudflare R2

**Owner ruling 2026-10-27:** switch to R2 for latency and streaming cost. Plan carefully and verify
before cutting over. **Approved 2026-10-27.** The owner also asked that the S3 bucket and every
object in it be removed once R2 is verified, so S3 stops billing (step 12.6).

## Why (measured and verified, 2026-10-27)

| | AWS S3 (Sydney, today) | Cloudflare R2 |
| --- | --- | --- |
| Storage | about $0.025/GB-month (Intelligent-Tiering frequent tier) | **$0.015/GB-month** Standard; $0.01 Infrequent Access |
| Downloads (streaming) | about $0.114/GB after 100 GB/month free | **$0 egress** |
| Requests | PUT about $5.50/M, GET about $0.44/M | Class A $4.50/M, Class B $0.36/M; free 1M A + 10M B per month |
| Free tier | 100 GB/month egress | 10 GB-month storage, 1M A, 10M B per month |
| Location | ap-southeast-2 | location hint `oc` (Oceania), best effort |
| Example: 1 TB streamed per month | about $110 | **$0** |

Sources: developers.cloudflare.com/r2/pricing, /r2/reference/data-location.

**Speed, stated honestly:** from the owner's Mac, S3 measured 3.5 MB/s for one stream and about 4.6 MB/s
with 4 parallel ranges. The owner's connection is the ceiling there, so R2 will not change it much.
R2's benefit is Cloudflare's network for viewers far from Sydney (judges abroad) and zero cost per
byte streamed. The parallel-range read-ahead in the drive build (A2) is the speed fix on any provider.

## What R2 does and doesn't support (from R2's S3 compatibility docs)

| We use today | R2 | Plan |
| --- | --- | --- |
| Presigned multipart upload (create, parts, complete, abort, list parts) | ✅ | Unchanged. The spike verifies a browser part PUT and the ETag readback |
| Presigned GET with Range | ✅ GetObject Range | Unchanged. The spike verifies a presigned Range GET returns 206 |
| `response-content-disposition` on presigned downloads | ❓ not documented | Spike. Fallback: set `Content-Disposition` when the object is written (original at CreateMultipartUpload) |
| `Cache-Control: private, max-age=31536000, immutable` on derived files | ✅ | Unchanged |
| **Object tags (`x-amz-tagging`, PutObjectTagging)** | ❌ **not supported** | Remove from the R2 adapter (below) |
| Lifecycle by **tag** (originals → Intelligent-Tiering, previews expire after 7 days) | ❌ prefix and age only | Previews: an app cleanup job deletes previews older than 7 days. Originals: **Standard only. Never use Infrequent Access**: the owner's account was billed $9.00 for a single IA Class A unit and $0.90 for IA Class B, because IA operations are billed per million with no free tier |
| Abort incomplete multipart after 1 day | ✅ lifecycle action | Prefix `users/`, 1 day |
| CORS exposing ETag, wildcard origin `https://*.trycloudflare.com` | ✅ | Same origins as today |
| Server credentials from the EC2 instance role | ❌ (no IAM) | R2 access keys (scoped to the one bucket) in the server `.env`, never in the repo |
| SSE-S3 encryption at rest | R2 encrypts all objects at rest by default | Unchanged guarantee |

**Key layout stays exactly as it is** (`api/crates/core/src/keys.rs`, `users/{user}/…`). No DB migration
is needed, and the stored `shorts.render_key` values stay valid.

## Design (hexagonal, additive)

- **Port unchanged:** `core::ports::storage::BlobStore`. Use cases don't change.
- **Adapter:**
  - The same `aws-sdk-s3` client, configured in the composition root for R2: endpoint
    `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`, path-style, static keys.
  - `ObjectClass` tagging becomes a no-op when `STORAGE_PROVIDER=r2`: no `x-amz-tagging` on create,
    no PutObjectTagging.
  - Implemented as a small capability flag on the adapter, chosen in the composition root, not a
    second copy of the adapter (DRY).
- **Env (composition root):** `STORAGE_PROVIDER=s3|r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` (secret), `S3_BUCKET` (bucket name). `.env.example` gets the names only.
- **Preview cleanup job:** the worker deletes `previews/{short}/v{n}` objects older than 7 days for
  shorts that are ready, and keeps the accepted version's preview. This replaces the tag lifecycle rule.
- **Terraform:**
  - New `infra/modules/r2/` + `infra/stacks/r2/`, cloudflare provider pinned.
  - Resources: `cloudflare_r2_bucket` (location `oc`), CORS, and lifecycle (abort-multipart; optional
    IA rule).
  - The Cloudflare API token comes from the environment only.
  - The S3 stack stays until cutover is verified, then it's destroyed with an owner yes.
- **Clients:** PWA, browser and Mac app need **no change**. They only ever see presigned URLs from the
  API. The Mac drive's range reads go straight to R2.

## Phases

| # | Step | Who | Gate |
| --- | --- | --- | --- |
| 12.0 | Owner setup (below) | owner | Keys in `.env`, never in chat |
| 12.1 | **Spike, 1–2 h, a throwaway test bucket:** <br>(a) browser multipart PUT via presigned part URLs, with ETag read through CORS; <br>(b) presigned GET with Range returns 206; <br>(c) `response-content-disposition` honoured or not; <br>(d) `Cache-Control` preserved; <br>(e) that tagging-free create works; <br>(f) latency and throughput from the Mac and from the EC2 box vs S3 (TTFB, MB/s, 4 parallel ranges) | api | Go/no-go table. Fallback for (c) chosen |
| 12.2 | Adapter + config: the R2 mode in the S3 adapter, the env schema, the preview cleanup job; unit tests (no tagging request on R2, cleanup selection rule, config parsing) | api | Gates green. S3 mode byte-for-byte unchanged (existing tests) |
| 12.3 | Terraform R2 stack: plan shown, **owner yes**, apply; state backed up | lead | Bucket + CORS + lifecycle live |
| 12.4 | **Copy data:** stop the server's api, copy every object S3 → R2 with the same keys (one-off script, server side, so no Mac egress), verify count + sizes + ETags/MD5 per object, then switch `.env` to R2 and restart. The library is about 0.2 GB today, so this takes minutes | lead | Every object verified; app reads and writes on R2 |
| 12.5 | Live verify on all three surfaces: <br>- phone PWA: upload, play, search thumbnails; <br>- browser PWA: same; <br>- Mac app: sync manifest, drive range reads, FCPXML originals; <br>- render: preview and final; <br>- download | owner + lead | Owner checks by hand |
| 12.6 | **S3 cleanup (owner-requested):** after the owner confirms 12.5 on all three surfaces: <br>1. Empty the bucket, all objects and incomplete multipart uploads, with versioning off. <br>2. `terraform destroy` the storage stack: bucket, bucket policy, IAM user `nimbytes-app-local`, policy. <br>3. Remove the EC2 role's S3 policy from the app stack (plan shown). <br>4. Confirm with `aws s3 ls` and `aws iam list-users` that nothing remains. <br>The lead shows the destroy plan and runs it on the owner's final yes. No 7-day window, because the owner prefers no S3 bill (S3 cost for 0.2 GB is cents) | lead | Nothing of S3 left |
| 12.7 | Docs: README storage row and pitch ("zero-egress storage" replaces "tiers itself"), positioning, contracts, STATUS, LEARNING | lead | – |

Estimate: about 1 day of work after the owner setup, mostly 12.1 and 12.4–12.5.

## 12.2 built (2026-10-27, not yet run against R2)

- **Config** (`api/crates/server/src/composition/mod.rs`): `STORAGE_PROVIDER=s3|r2`, `s3` when
  unset, anything else refused at start.
  - `r2` needs `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. The account
    id must be letters and digits, so it can't change the host. The secret is never printed.
  - **Change from the design above:** R2 uses its own `R2_BUCKET`, not `S3_BUCKET`. `S3_BUCKET` stays
    for S3 mode, so going back is one `STORAGE_PROVIDER` change.
- **Adapter:** one `S3BlobStore`. `nimbytes_adapters::s3::r2` has the endpoint, region `auto` and
  path-style settings. `.without_object_tags()` sends no `x-amz-tagging` on create or put and makes
  `tag()` a no-op. S3 mode is unchanged: its wire tests in `s3/tests.rs` are untouched and green. The
  R2 wire tests are in `s3/r2_tests.rs`.
- **Preview cleanup:** rule `domain/preview_cleanup.rs`, use case `usecases/shorts/previews.rs`,
  scheduled in `worker.rs`.
  - It runs in R2 mode only: at start, then every 6 h.
  - It covers shorts created more than 7 days ago that are `ready` or `failed`. Previews are
    rendered while the short is made, so the short's age stands in for theirs.
  - For a ready short it removes every preview except the best version's, or the newest preview
    when the best version has none. Objects go first, then the stored `preview_key` is cleared, so a rerun removes nothing
    more.
  - Shorts that `failed` lose every preview after the same 7 days (lead ruling 2026-10-27). Shorts
    still being made keep all of theirs.
- **Scripts (prepared, never run):**
  - 12.1: `cargo run -p nimbytes-adapters --example r2_spike` covers (a)–(f) through the real adapter
    in R2 mode and prints the go/no-go table. `scripts/r2-throughput.sh URL…` covers (f) from the box,
    against presigned S3 and R2 URLs.
  - 12.4: `scripts/r2-copy.sh [--dry-run] [--prefix users/]` copies S3 to R2 under the same keys. It
    keeps Content-Type, Cache-Control and Content-Disposition, sends Content-MD5, and checks per
    object that the size matches and that R2's ETag equals the MD5. It then checks that both buckets
    list the same keys and sizes.
  - Both read credentials from the environment only.

## Owner setup (12.0)

1. In the Cloudflare dashboard, turn on **R2**. Cloudflare asks for a payment method even on the free
   tier.
2. Note the **Account ID** (R2 overview page).
3. **R2 → Manage API tokens → Create**: "Object Read & Write", limited to the bucket `<r2-bucket>`
   (create the bucket first, or let Terraform create it and scope the token after). This gives an
   **Access Key ID + Secret**.
4. A **Cloudflare API token** for Terraform, with the permission "Workers R2 Storage: Edit" on the account.
5. Put them in `~/Projects/nimbytes/.env` yourself (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_API_TOKEN`). Never paste them in chat.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `response-content-disposition` unsupported | Downloads save under a key-like name | Set Content-Disposition when the object is written |
| The location hint is best effort | The bucket may not sit in Oceania | The spike measures TTFB from Perth and from the box |
| R2 keys on the box instead of an instance role | A leaked `.env` exposes the bucket | Token scoped to one bucket, `.env` mode 600, rotate after the event |
| Losing the "storage tiers itself" pitch point | Weaker storage story | Replace with "zero-egress streaming storage"; optional IA rule for originals |
| Cutover during the event week | Downtime or broken links | Small library, a few minutes, S3 kept 7 days for instant rollback |

## 12.1 and 12.4 done (2026-10-27)

- **12.1 spike: all go.** Multipart parts plus ETag through CORS, Range 206, `response-content-disposition`
  honoured (no fallback needed), Cache-Control kept, tag-free create and put.
  - From the owner's Mac: TTFB 275 ms, 6.2 MB/s (S3 was 3.5 MB/s).
  - From the box: R2 80 MB/s for one stream and 83 MB/s with 4 ranges; S3 61 MB/s and 250 MB/s.
- **12.3 skipped:** the bucket, CORS and token were made in the dashboard (owner session). R2's
  default 7-day abort for incomplete multipart uploads stays in place.
- **12.4 cutover, 09:03–09:13 UTC:**
  1. The api was stopped and the DB backed up to `/srv/nimbytes/backup-20261027-0903/`. The WAL was
     checkpointed on stop.
  2. `r2-copy.sh` copied 52 objects (254 MB), each checked for size and MD5.
  3. One extra R2 object was left by the spike (`users/r2-spike/…`). It was deleted, and the
     listings then matched exactly.
  4. `STORAGE_PROVIDER=r2` was set and deployed. That deploy also shipped the v1.1 work.
  5. Live checks: presigned URLs point at R2, Range 206 with CORS for the sslip.io origin,
     thumbnails 200, `/api/search/stream` returns local, ranked, done in 3.65 s, and preview cleanup
     ran with 0 removed.
- **Next:** 12.5, the owner's checks on all three surfaces. After that, 12.6 S3 cleanup with the
  owner's yes.

## 12.6 done (2026-10-27)

1. The owner emptied the bucket (52 objects; versioning was never on).
2. The app stack apply was targeted at `module.app.aws_iam_role_policy.app`: 1 destroyed, so the EC2 role
   has no inline or attached policy now. A full app apply would still replace the instance, because
   user-data changed. Never run one untargeted unless replacing the box is intended.
3. `terraform destroy` of the storage stack removed 10 resources (bucket and its settings, IAM user
   `nimbytes-app-local` and its policy). The state backups are in `~/Backups/nimbytes-*-tfstate-*`.
4. Checks: `aws s3 ls` shows no bucket, `aws iam list-users` returns none, and the site answers 200.
- S3 rollback is no longer possible. The `infra/stacks/storage` code stays in the repo, destroyed.
