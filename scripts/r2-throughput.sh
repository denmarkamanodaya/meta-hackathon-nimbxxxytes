#!/usr/bin/env bash
# Phase 12.1 (f): time to first byte and download speed of presigned GET URLs, one stream and 4
# parallel ranges. Runs anywhere curl runs (the Mac, the EC2 box), so S3 and R2 can be compared
# from the same place. Needs no credentials: the URLs carry their signature.
#
# Usage: scripts/r2-throughput.sh URL [URL ...]
#   Get an R2 URL from the spike (SPIKE_KEEP=1 cargo run -p nimbytes-adapters --example r2_spike)
#   and an S3 URL of an object of similar size with:
#   aws s3 presign "s3://$S3_BUCKET/<key>" --expires-in 3600
set -euo pipefail

[ "$#" -ge 1 ] || { echo "usage: $0 URL [URL ...]" >&2; exit 2; }

# Seconds since the epoch with a fraction; BSD date (macOS) has no %N.
now_s() {
  if date +%N | grep -q '^[0-9]'; then date +%s.%N; else python3 -c 'import time; print(time.time())'; fi
}

measure() {
  local url="$1" host total quarter start end i from to pids one
  host="$(printf '%s' "$url" | sed -E 's#^https?://([^/?]+).*#\1#')"
  # The total size comes from Content-Range: a presigned GET URL does not allow HEAD.
  total="$(curl -s -o /dev/null -D - -H 'Range: bytes=0-0' "$url" |
    tr -d '\r' | awk -F/ 'tolower($0) ~ /^content-range:/ {print $2}')"
  [ -n "$total" ] || { echo "$host: no Content-Range (bad or expired URL?)" >&2; return 1; }
  one="$(curl -s -o /dev/null -w '%{time_starttransfer} %{speed_download}' "$url")"
  printf '%s' "$one" | awk -v h="$host" '{ printf "%s  TTFB %.0f ms  1 stream %.1f MB/s", h, $1 * 1000, $2 / 1e6 }'
  quarter=$(((total + 3) / 4))
  pids=()
  start="$(now_s)"
  for i in 0 1 2 3; do
    from=$((i * quarter))
    to=$(((i + 1) * quarter - 1))
    [ "$to" -lt "$total" ] || to=$((total - 1))
    curl -s -o /dev/null -H "Range: bytes=$from-$to" "$url" &
    pids+=("$!")
  done
  wait "${pids[@]}"
  end="$(now_s)"
  awk -v t="$total" -v s="$start" -v e="$end" \
    'BEGIN { printf "  4 ranges %.1f MB/s  (%d bytes)\n", t / 1e6 / (e - s), t }'
}

for url in "$@"; do
  measure "$url"
done
