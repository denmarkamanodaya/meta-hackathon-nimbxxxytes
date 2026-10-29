# api/ — Rust backend

Rules: `/CLAUDE.md` (hard rules + dk-coding lite). Rust layer rules:
`~/Projects/.claude/rules/stack/rust.md`, as trimmed by `/CLAUDE.md`. Design:
`docs/architecture.md`. Shapes: `docs/contracts.md`, `docs/data-model.md`. Model facts:
`docs/meta-api.md`.

## Crates

| Crate | Holds | May depend on |
| --- | --- | --- |
| `crates/core` | domain types, ports (traits), use cases, pure rules, `keys.rs` (S3 keys), `AppError` + `ErrorCode` (the one source of error codes) | `serde`, `thiserror` |
| `crates/contracts` | HTTP wire types, re-export of `core`'s `ErrorCode`, schemas sent to Spark | `core`, `serde`, `schemars` |
| `crates/adapters` | Meta, S3, ffmpeg, SQLite, Tantivy, sqlite-vec, ort, clock, ids | `core`, `contracts`, IO crates |
| `crates/server` | Axum handlers, worker loop, `composition.rs`, `main.rs` | all |
| `crates/testkit` | in-memory fakes of every port, test builders, fixture loader (dev-dependency only) | `core`, `contracts` |

Other folders: `migrations/` (sqlx), `prompts/` (prompt text + JSON schemas; the only home of
prompt wording), `config/prices.toml` (model prices), `models/` (ONNX files, git-ignored).

## Package rules

- `core` never imports an IO crate, never reads env, never calls `SystemTime::now`; time and ids come
  through `Clock` / `IdGenerator`.
- Every Meta call goes through `adapters::meta::MetaClient` (cache + cost log). No other `reqwest`
  call to `api.meta.ai`.
- Every ffmpeg / ffprobe call goes through `FfmpegMediaTool`, with a timeout from `composition.rs`.
- Handlers: extract `UserId`, parse input, call one use case, map `AppError` to status + error body.
- Ownership check (`user_id` match) happens in the use case before any presign.

## Gates

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace        # offline unit tests, < 60 s
```

What to test and what never to test: `/CLAUDE.md` "Testing". Fixtures: `tests/fixtures/` (recorded
Meta responses from the spikes, scrubbed; ffprobe / scdet output). Tiny media for ffmpeg argument
tests is generated in the test with `ffmpeg -f lavfi`, never committed.
