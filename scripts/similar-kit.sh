#!/usr/bin/env bash
# Builds the near-copy / same-moment test kit in data/samples/similar/ (ffmpeg only).
#
# The kit is cut from the public-domain and Pexels samples in data/samples/. Every file gets a
# real creation_time so the "recorded at" rule can be tested. EXPECTED.csv lists what the
# similar-footage detector should report for each file:
#   file,expected,other
#   near_copy  = a re-encode / resize / trim / re-export of `other`
#   same_moment = the same scene from another device, recorded within minutes of `other`
#   none        = must not link to any kit file
#
# Idempotent: files that already exist are kept. Pass --force to rebuild everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES="$ROOT/data/samples"
OUT="$SAMPLES/similar"

# Base: 30 s of street and debris footage with camera motion and several scene changes.
BASE_SRC="$SAMPLES/up720/A1_940064.mp4"
BASE_AT=20
BASE_LEN=30
# Unrelated clips (different places, different subjects).
SAME_TIME_SRC="$SAMPLES/pexels/Ready_6646681.mp4"
OTHER_SRC="$SAMPLES/pexels/B_14109231.mp4"

BASE_TIME="2026-10-20T10:00:00Z"
ANGLE_B_TIME="2026-10-20T10:00:40Z"     # base + 40 s
SAME_TIME_TIME="2026-10-20T10:02:00Z"   # base + 2 min
REEXPORT_TIME="2026-10-22T18:30:00Z"    # exported from an editor two days later
SHUFFLED_TIME="2026-10-21T09:00:00Z"    # a re-cut made the next day, outside the time window
OTHER_TIME="2026-09-14T16:20:00Z"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

for f in "$BASE_SRC" "$SAME_TIME_SRC" "$OTHER_SRC"; do
  [[ -f "$f" ]] || { echo "missing sample: $f" >&2; exit 1; }
done
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FF=(ffmpeg -hide_banner -loglevel error -y)
ENC=(-c:v libx264 -preset medium -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart)

need() { [[ $FORCE -eq 1 || ! -s "$OUT/$1" ]]; }
stamp() { echo -metadata "creation_time=$1"; }

# base.mp4: 1280x720, left 65% window of the source (so angle_b can be the right 65%).
CROP_L="crop=iw*0.65:ih*0.65:0:ih*0.175,scale=1280:720,setsar=1"
CROP_R="crop=iw*0.65:ih*0.65:iw*0.35:ih*0.175,scale=1280:720,setsar=1"
if need base.mp4; then
  "${FF[@]}" -ss "$BASE_AT" -i "$BASE_SRC" -t "$BASE_LEN" -vf "$CROP_L" -crf 18 "${ENC[@]}" \
    $(stamp "$BASE_TIME") "$OUT/base.mp4"
fi
BASE="$OUT/base.mp4"

# reencode.mp4: heavy re-encode at a different bitrate.
if need reencode.mp4; then
  "${FF[@]}" -i "$BASE" -c:v libx264 -preset fast -crf 32 -maxrate 900k -bufsize 1800k \
    -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart $(stamp "$BASE_TIME") "$OUT/reencode.mp4"
fi

# resized.mp4: 720p -> 480p, 5% crop, slight colour shift.
if need resized.mp4; then
  "${FF[@]}" -i "$BASE" \
    -vf "crop=iw*0.95:ih*0.95,scale=854:480,setsar=1,eq=saturation=1.15:brightness=0.03:gamma=1.05" \
    -crf 24 "${ENC[@]}" $(stamp "$BASE_TIME") "$OUT/resized.mp4"
fi

# trimmed.mp4: the middle 18 s of base.
if need trimmed.mp4; then
  "${FF[@]}" -ss 6 -i "$BASE" -t 18 -crf 22 "${ENC[@]}" $(stamp "$BASE_TIME") "$OUT/trimmed.mp4"
fi

# reexport.mp4: a 2 s title card, then base.
if need reexport.mp4; then
  "${FF[@]}" -f lavfi -i "color=c=0x1d2b3a:s=1280x720:r=30000/1001:d=2" \
    -f lavfi -i "anullsrc=r=48000:cl=stereo" -i "$BASE" \
    -filter_complex "[0:v]drawtext=text='Storm walk':fontcolor=white:fontsize=72:x=(w-tw)/2:y=(h-th)/2,format=yuv420p,setsar=1[t];[1:a]atrim=0:2,asetpts=N/SR/TB[ta];[2:v]fps=30000/1001,format=yuv420p,setsar=1[bv];[2:a]aresample=48000,aformat=channel_layouts=stereo[ba];[t][ta][bv][ba]concat=n=2:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -crf 22 "${ENC[@]}" $(stamp "$REEXPORT_TIME") "$OUT/reexport.mp4"
fi

# shuffled.mp4: base cut into thirds and reordered C, A, B (same frames, wrong order).
if need shuffled.mp4; then
  "${FF[@]}" -i "$BASE" -filter_complex \
    "[0:v]split=3[v1][v2][v3];[0:a]asplit=3[a1][a2][a3];\
[v1]trim=0:10,setpts=PTS-STARTPTS[va];[a1]atrim=0:10,asetpts=PTS-STARTPTS[aa];\
[v2]trim=10:20,setpts=PTS-STARTPTS[vb];[a2]atrim=10:20,asetpts=PTS-STARTPTS[ab];\
[v3]trim=20:30,setpts=PTS-STARTPTS[vc];[a3]atrim=20:30,asetpts=PTS-STARTPTS[ac];\
[vc][ac][va][aa][vb][ab]concat=n=3:v=1:a=1[v][a]" \
    -map "[v]" -map "[a]" -crf 22 "${ENC[@]}" $(stamp "$SHUFFLED_TIME") "$OUT/shuffled.mp4"
fi

# angle_b.mp4: the right 65% window of the same source, starting 1.5 s later, recorded 40 s later.
if need angle_b.mp4; then
  "${FF[@]}" -ss "$(echo "$BASE_AT + 1.5" | bc)" -i "$BASE_SRC" -t "$BASE_LEN" -vf "$CROP_R" \
    -crf 20 "${ENC[@]}" $(stamp "$ANGLE_B_TIME") "$OUT/angle_b.mp4"
fi

# same_time_other.mp4: an unrelated clip recorded 2 minutes after base.
if need same_time_other.mp4; then
  "${FF[@]}" -i "$SAME_TIME_SRC" -t 30 \
    -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1" \
    -crf 20 "${ENC[@]}" $(stamp "$SAME_TIME_TIME") "$OUT/same_time_other.mp4"
fi

# other.mp4: an unrelated clip at an unrelated time.
if need other.mp4; then
  "${FF[@]}" -i "$OTHER_SRC" -t 30 -vf "scale=720:1280,setsar=1" \
    -crf 20 "${ENC[@]}" $(stamp "$OTHER_TIME") "$OUT/other.mp4"
fi

cat > "$OUT/EXPECTED.csv" <<'CSV'
file,expected,other
base.mp4,original,
reencode.mp4,near_copy,base.mp4
resized.mp4,near_copy,base.mp4
trimmed.mp4,near_copy,base.mp4
reexport.mp4,near_copy,base.mp4
shuffled.mp4,none,
angle_b.mp4,same_moment,base.mp4
same_time_other.mp4,none,
other.mp4,none,
CSV

echo "kit in $OUT"
for f in base reencode resized trimmed reexport shuffled angle_b same_time_other other; do
  printf '%-22s %8ss  %s  %s\n' "$f.mp4" \
    "$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/$f.mp4" | xargs printf '%.1f')" \
    "$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$OUT/$f.mp4")" \
    "$(ffprobe -v error -show_entries format_tags=creation_time -of default=nw=1:nk=1 "$OUT/$f.mp4")"
done
