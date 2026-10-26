#!/usr/bin/env bash
# Deploy nimbytes to the EC2 box created by infra/stacks/app.
#
# Builds the api image for linux/arm64 on this Mac, streams it over SSH (docker save | gzip | ssh
# docker load; no registry), syncs the compose file, Caddyfile, web build and ONNX models, writes the
# server .env and runs `docker compose up -d` there.
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
IMAGE="${PROJECT}-api:latest"

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

for f in docker-compose.yml Caddyfile api/Dockerfile \
  api/models/pe/image.onnx api/models/pe/text.onnx api/models/pe/tokenizer.json api/models/pe/meta.json; do
  [ -f "$ROOT/$f" ] || fail "missing $f (run make models for the api/models/pe files)"
done
[ -f "$env_file" ] || fail "missing env file $env_file"

# On EC2 the instance role supplies AWS credentials; a profile name would point at a config file the
# container does not have.
if grep -Eq '^AWS_PROFILE=.+' "$env_file"; then
  fail "$env_file sets AWS_PROFILE; leave it empty for the server (the instance role is used)"
fi

ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
[ -n "$ssh_key" ] && ssh_opts+=(-i "$ssh_key")
ssh_cmd="ssh ${ssh_opts[*]}"
target="$REMOTE_USER@$host"

# Server .env: the local file minus the keys the server sets itself, plus the public address.
remote_env="$(mktemp)"
trap 'rm -f "$remote_env"' EXIT
grep -Ev '^(AWS_PROFILE|SITE_ADDRESS|PUBLIC_BASE_URL)=' "$env_file" >"$remote_env" || true
{
  echo "SITE_ADDRESS=$site_address"
  echo "PUBLIC_BASE_URL=https://$site_address"
} >>"$remote_env"

echo "deploy: $target -> https://$site_address $($dry_run && echo '(dry run)')"

# --- build -------------------------------------------------------------------

run "npm --prefix '$ROOT/web' run build"
run "docker buildx build --platform linux/arm64 --tag '$IMAGE' --load '$ROOT/api'"

# --- ship --------------------------------------------------------------------

run "$ssh_cmd '$target' 'mkdir -p $REMOTE_DIR/web/dist $REMOTE_DIR/api/models'"
run "docker save '$IMAGE' | gzip | $ssh_cmd '$target' 'gunzip | docker load'"
run "rsync -az --delete -e '$ssh_cmd' '$ROOT/web/dist/' '$target:$REMOTE_DIR/web/dist/'"
run "rsync -az --delete -e '$ssh_cmd' '$ROOT/api/models/' '$target:$REMOTE_DIR/api/models/'"
run "rsync -az -e '$ssh_cmd' '$ROOT/docker-compose.yml' '$ROOT/Caddyfile' '$target:$REMOTE_DIR/'"
run "rsync -az --chmod=F600 -e '$ssh_cmd' '$remote_env' '$target:$REMOTE_DIR/.env'"

# --- start -------------------------------------------------------------------

run "$ssh_cmd '$target' 'cd $REMOTE_DIR && docker compose -p $PROJECT up -d --no-build --remove-orphans && docker image prune -f'"

echo "deploy: done -> https://$site_address"
