#!/usr/bin/env bash
# Deploy nimbytes to the EC2 box created by infra/stacks/app.
#
# Builds the api and renderer images for linux/arm64 on this Mac, streams both over SSH (docker save
# | gzip | ssh docker load; no registry), syncs the compose file, Caddyfile, web build and the four
# ONNX model files the api loads, writes the server .env and runs `docker compose up -d` there.
# docker-compose.local.yml (local rehearsal credentials) is never shipped.
#
# Usage: scripts/deploy.sh [--dry-run] [--host IP] [--ssh-key PATH] [--env-file PATH]
#   --dry-run    print every command instead of running it
#   --host       public IP of the box (default: `terraform output public_ip` of infra/stacks/app)
#   --ssh-key    private key for ec2-user (default: ssh agent / ~/.ssh config)
#   --env-file   local env file copied to the server as .env (default: .env)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR=/srv/nimbytes
REMOTE_USER=ec2-user
# Compose names images <project>-<service>; the server runs with --no-build, so the tag must match.
PROJECT=nimbytes
API_IMAGE="${PROJECT}-api:latest"
RENDERER_IMAGE="${PROJECT}-renderer:latest"
# The files the api loads from PE_MODEL_DIR; text.fp32.onnx (1.4 GB) is an export leftover.
MODEL_FILES=(image.onnx text.onnx tokenizer.json meta.json)
# The files the guide narrator loads from TTS_MODEL_DIR (MMS-TTS English).
TTS_FILES=(model.onnx vocab.json tokenizer_config.json meta.json)
# The api container runs as this uid (api/Dockerfile) and writes SQLite, the index and scratch files.
APP_UID=10001

dry_run=false
host=""
ssh_key=""
env_file="$ROOT/.env"

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --host) host="$2"; shift ;;
    --ssh-key) ssh_key="$2"; shift ;;
    --env-file) env_file="$2"; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

run() {
  if $dry_run; then
    printf '+ %s\n' "$*"
  else
    bash -c "$*"
  fi
}

fail() {
  echo "deploy: $*" >&2
  exit 1
}

# --- preflight ---------------------------------------------------------------

if [ -z "$host" ]; then
  # Before the app stack is applied this prints a warning instead of an IP; the check below catches it.
  host="$(terraform -chdir="$ROOT/infra/stacks/app" output -raw public_ip 2>/dev/null || true)"
fi
[[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "no IPv4 host: pass --host, or apply infra/stacks/app so its public_ip output exists"
site_address="${host//./-}.sslip.io"

for f in docker-compose.yml Caddyfile api/Dockerfile render/Dockerfile; do
  [ -f "$ROOT/$f" ] || fail "missing $f"
done
for f in "${MODEL_FILES[@]}"; do
  [ -f "$ROOT/api/models/pe/$f" ] || fail "missing api/models/pe/$f (run make models)"
done
for f in "${TTS_FILES[@]}"; do
  [ -f "$ROOT/api/models/mms-tts-eng/$f" ] || fail "missing api/models/mms-tts-eng/$f (run ml/export_mms_tts.py)"
done
[ -f "$env_file" ] || fail "missing env file $env_file"


ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
[ -n "$ssh_key" ] && ssh_opts+=(-i "$ssh_key")
ssh_cmd="ssh ${ssh_opts[*]}"
target="$REMOTE_USER@$host"

# Server .env: the local file minus the keys the server sets itself, plus the public address.
remote_env="$(mktemp)"
trap 'rm -f "$remote_env"' EXIT
# AWS_PROFILE is for local dev only: on EC2 the instance role supplies credentials, and a profile
# name would point the SDK at a config file the container does not have. CLOUDFLARE_API_TOKEN is for
# Terraform on this Mac only; the server never needs it.
grep -Ev '^(AWS_PROFILE|CLOUDFLARE_API_TOKEN|SITE_ADDRESS|PUBLIC_BASE_URL)=' "$env_file" >"$remote_env" || true
if grep -Eq '^AWS_PROFILE=.+' "$env_file"; then
  echo "deploy: stripped AWS_PROFILE from the server .env (the instance role is used there)"
fi
{
  echo "SITE_ADDRESS=$site_address"
  echo "PUBLIC_BASE_URL=https://$site_address"
} >>"$remote_env"

echo "deploy: $target -> https://$site_address $($dry_run && echo '(dry run)')"

# --- build -------------------------------------------------------------------

# The PWA's "nimbytes for Mac" link is baked in at build time from the env file (hidden when unset).
mac_url="$(grep -E '^VITE_MAC_DOWNLOAD_URL=' "$env_file" | head -1 | cut -d= -f2- || true)"
run "VITE_MAC_DOWNLOAD_URL='$mac_url' npm --prefix '$ROOT/web' run build"
run "docker buildx build --platform linux/arm64 --tag '$API_IMAGE' --load '$ROOT/api'"
run "docker buildx build --platform linux/arm64 --tag '$RENDERER_IMAGE' --load '$ROOT/render'"

# --- ship --------------------------------------------------------------------

run "$ssh_cmd '$target' 'mkdir -p $REMOTE_DIR/web/dist $REMOTE_DIR/api/models/pe $REMOTE_DIR/api/models/mms-tts-eng'"
# ./data in docker-compose.yml is this EBS mount; user-data chowns its top level only, so make sure
# everything under it belongs to the api user (idempotent).
run "$ssh_cmd '$target' 'sudo chown -R $APP_UID:$APP_UID $REMOTE_DIR/data'"
run "docker save '$API_IMAGE' '$RENDERER_IMAGE' | gzip | $ssh_cmd '$target' 'gunzip | docker load'"
run "rsync -az --delete -e '$ssh_cmd' '$ROOT/web/dist/' '$target:$REMOTE_DIR/web/dist/'"
model_paths="$(printf "'$ROOT/api/models/pe/%s' " "${MODEL_FILES[@]}")"
run "rsync -az -e '$ssh_cmd' $model_paths '$target:$REMOTE_DIR/api/models/pe/'"
tts_paths="$(printf "'$ROOT/api/models/mms-tts-eng/%s' " "${TTS_FILES[@]}")"
run "rsync -az -e '$ssh_cmd' $tts_paths '$target:$REMOTE_DIR/api/models/mms-tts-eng/'"
run "rsync -az -e '$ssh_cmd' '$ROOT/docker-compose.yml' '$ROOT/Caddyfile' '$target:$REMOTE_DIR/'"
# macOS ships openrsync, which has no --chmod; tighten the mode with a separate ssh step.
run "rsync -az -e '$ssh_cmd' '$remote_env' '$target:$REMOTE_DIR/.env'"
run "$ssh_cmd '$target' 'chmod 600 $REMOTE_DIR/.env'"

# --- start -------------------------------------------------------------------

run "$ssh_cmd '$target' 'cd $REMOTE_DIR && docker compose -p $PROJECT up -d --no-build --remove-orphans && docker image prune -f'"

echo "deploy: done -> https://$site_address"
