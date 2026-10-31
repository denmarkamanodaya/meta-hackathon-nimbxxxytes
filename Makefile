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

# Perception Encoder (required: about 1.7 GB download, 700 MB out) and the MMS-TTS voice (optional
# iGuide voice). Needs uv and Python 3.13; writes api/models/pe and api/models/mms-tts-eng.
models:
	cd ml && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt && .venv/bin/python -I export_pe.py --image-precision fp32 --text-precision int8
	cd ml && .venv/bin/python -I export_mms_tts.py && mkdir -p ../api/models && rm -rf ../api/models/mms-tts-eng && cp -R out/mms-tts-eng ../api/models/mms-tts-eng

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

# Judge stack: one machine, Docker only, no cloud account (docker-compose.judge.yml). The web app is
# built in a Node container (its node_modules stay in Docker volumes, never on the host).
.PHONY: judge judge-web judge-down judge-check judge-models
JUDGE_COMPOSE := docker compose -f docker-compose.yml -f docker-compose.judge.yml

judge: judge-check judge-models judge-web
	$(JUDGE_COMPOSE) up -d --build
	@echo "nimbytes is starting at http://localhost:$${NIMBYTES_PORT:-8080} (sign in with your DEMO_PASSCODE)"

judge-check:
	@test -f .env || { echo "No .env: run  cp .env.example .env  and fill in the REQUIRED values"; exit 1; }
	@for k in MODEL_API_KEY DEMO_PASSCODE SESSION_SECRET; do \
		grep -Eq "^$$k=.+" .env || { echo ".env: $$k is REQUIRED (see the comments in .env.example)"; exit 1; }; \
	done

# Perception Encoder, already converted to ONNX: the models-v1 release asset (Meta's weights,
# Apache-2.0, licence and notices inside). Downloaded once and checked against its SHA-256.
PE_URL := https://github.com/denmarkamanodaya/meta-hackathon-nimbytes/releases/download/models-v1/perception-encoder.tar.gz
PE_SHA256 := bee8d8b00878bf6dd78ba75fa75c9e7b5e30d871ded4a455b72bcb1b154f32e5

judge-models:
	@if [ -f api/models/pe/image.onnx ]; then echo "Perception Encoder: already in api/models/pe"; else \
		echo "Downloading Perception Encoder (650 MB, once)..." && mkdir -p api/models && \
		curl -fL --retry 3 -o api/models/pe.tar.gz "$(PE_URL)" && \
		got=$$( (sha256sum api/models/pe.tar.gz 2>/dev/null || shasum -a 256 api/models/pe.tar.gz) | cut -d' ' -f1 ) && \
		if [ "$$got" != "$(PE_SHA256)" ]; then rm -f api/models/pe.tar.gz; echo "Download damaged (checksum mismatch); removed it, run make judge again"; exit 1; fi && \
		tar -xzf api/models/pe.tar.gz -C api/models && mv api/models/perception-encoder api/models/pe && \
		rm api/models/pe.tar.gz && echo "Perception Encoder: ready"; fi

judge-web:
	docker run --rm -v "$(CURDIR)":/app -v nimbytes-judge-render-modules:/app/render/node_modules \
		-v nimbytes-judge-web-modules:/app/web/node_modules -w /app node:22-bookworm-slim \
		sh -c "cd render && npm ci --no-audit --no-fund && cd ../web && npm ci --no-audit --no-fund && npm run build"

judge-down:
	$(JUDGE_COMPOSE) down
