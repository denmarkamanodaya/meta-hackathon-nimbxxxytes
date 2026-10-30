#!/usr/bin/env bash
# Spike 31.0 (iListen): does Voice Transcribe handle Mandarin, Japanese and a Mandarin/Japanese
# mix, and can Muse Spark name each turn's language, translate it and summarise in a chosen
# language? Usage: scripts/spike-ilisten.sh <dir with *.wav> <target language, e.g. English>
# Writes <name>.transcribe.json and <name>.<target>.understand.json next to each WAV.
set -euo pipefail

DIR=${1:?wav dir}
TARGET=${2:-English}
BASE=https://api.meta.ai/v1
KEY=$(grep -E '^MODEL_API_KEY=' "$(dirname "$0")/../.env" | cut -d= -f2-)

SCHEMA='{
  "type": "object", "additionalProperties": false,
  "required": ["title", "languages", "turns", "summary", "key_points"],
  "properties": {
    "title": { "type": "string" },
    "languages": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["code", "share"],
      "properties": { "code": { "type": "string" }, "share": { "type": "integer" } } } },
    "turns": { "type": "array", "items": { "type": "object", "additionalProperties": false,
      "required": ["index", "lang", "translation"],
      "properties": { "index": { "type": "integer" }, "lang": { "type": "string" }, "translation": { "type": "string" } } } },
    "summary": { "type": "string" },
    "key_points": { "type": "array", "items": { "type": "string" } }
  }
}'

SYSTEM="You read speech transcripts made by a speech recogniser. Turns are numbered.
For every turn, name the language spoken as an ISO 639-1 code (zh, ja, en, ko, tl, ...), judged
from the words and the script, and translate the turn into ${TARGET}. A turn already in ${TARGET}
is copied as is. Then, in ${TARGET}: a short title, a summary of two to four sentences, and up to
five key points (dates, places, amounts, actions). languages lists each language heard once, with
its share of the speech as a whole percentage; the shares add up to 100. Use only what was said."

for WAV in "$DIR"/*.wav; do
  NAME=$(basename "$WAV" .wav)
  case $NAME in gap|m[0-9]) continue ;; esac
  T="$DIR/$NAME.transcribe.json"
  if [ ! -s "$T" ]; then
    curl -sS -X POST "$BASE/asr/transcribe" -H "Authorization: Bearer $KEY" \
      -F 'request={"mode":"DIARIZATION","model":"muse-voice-transcribe-1.0","audioEncoding":"WAV"};type=application/json' \
      -F "audio=@$WAV;type=audio/wav" -o "$T"
  fi
  TURNS=$(jq -r '.turns | to_entries | map("\(.key) [\(.value.speaker // "-")] \(.value.transcript)") | join("\n")' "$T")
  BODY=$(jq -n --arg sys "$SYSTEM" --arg user "$TURNS" --argjson schema "$SCHEMA" '{
    model: "muse-spark-1.3", store: false, reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "listen_understand", strict: true, schema: $schema } },
    input: [
      { type: "message", role: "system", content: [{ type: "input_text", text: $sys }] },
      { type: "message", role: "user", content: [{ type: "input_text", text: $user }] } ] }')
  U="$DIR/$NAME.$TARGET.understand.json"
  curl -sS -X POST "$BASE/responses" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "$BODY" -o "$U.raw"
  jq -r '[.output[] | select(.type == "message") | .content[] | select(.type == "output_text") | .text] | join("")' "$U.raw" > "$U"
  echo "$NAME → $(jq -c '{languages, title}' "$U" 2>/dev/null || echo 'unparsed')"
done
