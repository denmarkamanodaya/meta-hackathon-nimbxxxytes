# Contributing to nimbytes

Thanks for helping. nimbytes is an AI-powered filesystem built on Meta AI; see the
[README](README.md) for what it does and how it is built.

## Setup

```bash
git clone https://github.com/denmarkamanodaya/meta-hackathon-nimbytes.git
cd meta-hackathon-nimbytes
cp .env.example .env          # fill in MODEL_API_KEY, storage keys, DEMO_PASSCODE
make models                   # Perception Encoder + MMS-TTS ONNX files
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
cd web && npm install && npm run dev:mock    # the app on an in-browser mock API, no keys needed
```

Tools: Rust (version pinned in `api/rust-toolchain.toml`), Node 24, Terraform 1.14, Docker,
ffmpeg and poppler. The Mac app needs macOS and Xcode (`make desktop-dev`).

## Running tests

Run every suite from the repository root:

```bash
npm test              # same as `make test`: Rust, web and renderer suites
make test             # every test suite, offline
tests/run-all.sh      # the full gates CI runs: fmt, clippy, lint, tests, builds, terraform validate
```

Or one package at a time:

```bash
cd api && cargo test --workspace     # Rust API (about 1,100 tests)
cd web && npm test                   # web app and PWA (Vitest)
cd render && npm test                # Remotion renderer (Vitest)
```

Tests are fast and offline: no calls to the Meta models, no cloud, no secrets. Where each suite
lives: [`tests/README.md`](tests/README.md).

## Code style

Format and lint before you push: `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings` in `api/`, `npm run lint` in `web/` and `render/`.


- **Rust:** `cargo fmt`, `clippy -D warnings`. Hexagonal layout: pure domain, ports and use cases
  in `api/crates/core`; only adapters (`api/crates/adapters`) do IO; one composition root
  (`api/crates/server`). One typed `AppError { code, message }` with `UPPER_SNAKE` codes.
- **Web:** ESLint and TypeScript strict. Vanilla CSS with design tokens only
  (`web/src/design/tokens.css`); components call hooks, hooks call services, only services fetch.
- **AI:** every model call goes through the one `MetaClient` (cache and cost log); prompts live in
  `api/prompts/` with a JSON schema each.
- Write a unit test for every rule, parser, use case and handler you add, in the same change.

## Pull requests

1. Branch from `main`; keep each pull request to one change.
2. Run `tests/run-all.sh` before you push; CI runs the same on every pull request.
3. Fill in the pull request template: what and why, how you checked it, screenshots for UI.
4. Use Conventional Commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`).

Bugs and ideas: open an issue with the bug report or feature request template.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see
[SECURITY.md](SECURITY.md), not a public issue.
