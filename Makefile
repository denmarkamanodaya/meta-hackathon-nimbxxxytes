# Homebrew rustup is keg-only, so put its toolchain on PATH for every target.
export PATH := /opt/homebrew/opt/rustup/bin:$(HOME)/.cargo/bin:$(PATH)

TF_STACKS := $(wildcard infra/stacks/*)

.PHONY: gates gates-api gates-web gates-infra dev models

gates: gates-api gates-web gates-infra

gates-api:
	cd api && cargo fmt --all --check
	cd api && cargo clippy --workspace --all-targets -- -D warnings
	cd api && cargo test --workspace

gates-web:
	cd web && npm run lint
	cd web && npm test
	cd web && npm run build

gates-infra:
	terraform fmt -check -recursive infra
	@for s in $(TF_STACKS); do terraform -chdir=$$s init -backend=false -input=false >/dev/null && terraform -chdir=$$s validate || exit 1; done

dev:
	cd web && npm run build
	docker compose up --build

models:
	cd ml && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt && .venv/bin/python -I export_pe.py
