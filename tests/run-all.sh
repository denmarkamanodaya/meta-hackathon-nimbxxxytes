#!/usr/bin/env bash
# Runs every test suite and check in the repo: the same gates CI runs (.github/workflows/ci.yml).
# Fast and offline. Usage: tests/run-all.sh
set -euo pipefail
cd "$(dirname "$0")/.."
make gates
