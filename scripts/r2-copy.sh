#!/usr/bin/env bash
# Phase 12.4: copy every media object from the S3 bucket to the R2 bucket under the same key, then
# verify each one. Run it on the EC2 box with the api stopped (no Mac egress, no writes during the
# copy). Credentials come from the environment only:
#   S3 side: the instance role, or AWS_PROFILE when set (never the R2 keys).
#   R2 side: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
#
# Usage: set -a; . ./.env; set +a; scripts/r2-copy.sh [--dry-run] [--prefix users/]
#   --dry-run   list what would be copied (count, bytes, which keys R2 already holds); writes nothing
#   --prefix    copy only keys under this prefix (default users/, the app's whole key space)
#
# Env: S3_BUCKET (source), AWS_REGION, R2_BUCKET (destination), plus the credentials above.
#
# Per object: download from S3 to a temp file, MD5 it, PutObject to R2 with Content-MD5 (R2 refuses a
# body that does not match) and the source's Content-Type, Cache-Control and Content-Disposition,
# without tags (R2 has none). Then HeadObject on R2: the size must equal S3's and the ETag must equal
# the MD5 (a single-part PutObject's ETag is its MD5). Finally both buckets must list the same keys.
# Exit 1 if any object fails; rerunning copies everything again, so a rerun is safe.
set -euo pipefail

dry_run=false
prefix="users/"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --prefix) prefix="$2"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

for key in S3_BUCKET AWS_REGION R2_BUCKET R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY; do
  [ -n "${!key:-}" ] || { echo "env $key is required" >&2; exit 2; }
done
case "$R2_ACCOUNT_ID" in *[!A-Za-z0-9]*) echo "R2_ACCOUNT_ID must be letters and digits" >&2; exit 2 ;; esac
R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# The S3 side never sees the R2 keys, and the R2 side never sees the AWS profile or role.
s3api() {
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    aws s3api --region "$AWS_REGION" --output json "$@"
}
r2api() {
  env -u AWS_PROFILE -u AWS_SESSION_TOKEN \
    AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    AWS_REGION=auto AWS_EC2_METADATA_DISABLED=true \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws s3api --endpoint-url "$R2_ENDPOINT" --output json "$@"
}

# "key<TAB>size" for every object under the prefix, sorted by key.
list_keys() {
  "$1" list-objects-v2 --bucket "$2" --prefix "$prefix" \
    --query 'Contents[].[Key, Size]' --output text | awk 'NF == 2' | sort
}

md5_hex() { openssl dgst -md5 -binary "$1" | od -An -tx1 | tr -d ' \n'; }
md5_b64() { openssl dgst -md5 -binary "$1" | base64; }

# Copies one object and verifies it; prints one line; returns 1 on any mismatch.
copy_one() {
  local key="$1" size="$2" file="$work/object" head type cache disp hex args got_size got_etag
  head="$(s3api get-object --bucket "$S3_BUCKET" --key "$key" "$file")"
  type="$(printf '%s' "$head" | jq -r '.ContentType // empty')"
  cache="$(printf '%s' "$head" | jq -r '.CacheControl // empty')"
  disp="$(printf '%s' "$head" | jq -r '.ContentDisposition // empty')"
  hex="$(md5_hex "$file")"
  args=(--bucket "$R2_BUCKET" --key "$key" --body "$file" --content-md5 "$(md5_b64 "$file")")
  [ -z "$type" ] || args+=(--content-type "$type")
  [ -z "$cache" ] || args+=(--cache-control "$cache")
  [ -z "$disp" ] || args+=(--content-disposition "$disp")
  r2api put-object "${args[@]}" >/dev/null
  head="$(r2api head-object --bucket "$R2_BUCKET" --key "$key")"
  got_size="$(printf '%s' "$head" | jq -r '.ContentLength')"
  got_etag="$(printf '%s' "$head" | jq -r '.ETag' | tr -d '"')"
  if [ "$got_size" = "$size" ] && [ "$got_etag" = "$hex" ]; then
    echo "ok   $key  $size bytes  md5 $hex"
  else
    echo "FAIL $key  size s3 $size r2 $got_size  md5 $hex etag $got_etag" >&2
    return 1
  fi
}

command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
# One object at a time passes through here; removed on any exit.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

src="$(list_keys s3api "$S3_BUCKET")"
count="$(printf '%s' "$src" | grep -c . || true)"
bytes="$(printf '%s\n' "$src" | awk '{ s += $2 } END { print s + 0 }')"
echo "S3 s3://$S3_BUCKET/$prefix: $count objects, $bytes bytes -> R2 $R2_BUCKET"

if $dry_run; then
  dst="$(list_keys r2api "$R2_BUCKET")"
  present="$(comm -12 <(printf '%s\n' "$src") <(printf '%s\n' "$dst") | grep -c . || true)"
  echo "dry run: R2 already holds $present of them with the same size; nothing written"
  printf '%s\n' "$src" | awk 'NF == 2 { printf "would copy %s (%s bytes)\n", $1, $2 }'
  exit 0
fi

failed=0
while IFS=$'\t' read -r key size; do
  [ -n "$key" ] || continue
  copy_one "$key" "$size" || failed=$((failed + 1))
done <<<"$src"

dst="$(list_keys r2api "$R2_BUCKET")"
if [ "$src" != "$dst" ]; then
  echo "FAIL listings differ (key and size), S3 vs R2:" >&2
  diff <(printf '%s\n' "$src") <(printf '%s\n' "$dst") >&2 || true
  failed=$((failed + 1))
fi

if [ "$failed" -gt 0 ]; then
  echo "$failed failure(s); fix and rerun" >&2
  exit 1
fi
echo "all $count objects copied and verified (size + MD5), listings equal"
