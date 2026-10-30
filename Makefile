# Homebrew rustup is keg-only, so put its toolchain on PATH for every target.
export PATH := /opt/homebrew/opt/rustup/bin:$(HOME)/.cargo/bin:$(PATH)

TF_STACKS := $(wildcard infra/stacks/*)

.PHONY: gates gates-api gates-web gates-render gates-infra dev models test

gates: gates-api gates-web gates-render gates-infra

# Every test suite (Rust, web, renderer), offline. The full gates add fmt, lint, builds and terraform.
test:
	cd api && cargo test --workspace
	cd web && npm test
	cd render && npm test

gates-api:
	cd api && cargo fmt --all --check
	cd api && cargo clippy --workspace --all-targets -- -D warnings
	cd api && cargo test --workspace

gates-web:
	cd web && npm run lint
	cd web && npm test
	cd web && npm run build

gates-render:
	cd render && npm run lint
	cd render && npm test
	cd render && npm run build

gates-infra:
	terraform fmt -check -recursive infra
	@for s in $(TF_STACKS); do terraform -chdir=$$s init -backend=false -input=false >/dev/null && terraform -chdir=$$s validate || exit 1; done

dev:
	cd web && npm run build
	docker compose up --build

models:
	cd ml && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt && .venv/bin/python -I export_pe.py --image-precision fp32 --text-precision int8

# nimbytes for Mac (desktop/). Dev builds trust the local Caddy root CA; release builds never do.
.PHONY: desktop-dev desktop-dmg gates-desktop
DESKTOP_DEV_CA := desktop/.dev-ca.pem

desktop-dev:
	docker exec nimbytes-caddy-1 cat /data/caddy/pki/authorities/local/root.crt > $(DESKTOP_DEV_CA)
	cd web && npm run build:desktop
	cd desktop/src-tauri && NIMBYTES_DEV_CA=$(CURDIR)/$(DESKTOP_DEV_CA) cargo tauri dev

# Needs APPLE_SIGNING_IDENTITY and NIMBYTES_SERVER_URL (the release build's fixed server).
desktop-dmg:
	@test -n "$$NIMBYTES_SERVER_URL" || { echo "set NIMBYTES_SERVER_URL (the release build's fixed server)"; exit 1; }
	cd desktop/src-tauri && cargo tauri build --target universal-apple-darwin
	codesign --verify --deep --strict --verbose=2 desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/nimbytes.app

gates-desktop:
	cd desktop/src-tauri && cargo fmt --check
	cd desktop/src-tauri && cargo clippy --all-targets -- -D warnings
	cd desktop/src-tauri && cargo test
