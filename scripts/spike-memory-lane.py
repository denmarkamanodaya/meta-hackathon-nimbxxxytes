#!/usr/bin/env python3
"""Spike 32.0 (Memory Lane): gather one named person's moments from the live library through the
API, ask Muse Spark (write + check) for a short spoken memory session, print it and save it to
data/spike-memory-lane/. Reads MODEL_API_KEY and DEMO_PASSCODE from .env. No writes to the library.

Usage: python3 -I scripts/spike-memory-lane.py <server-url> <person name | event:Clip title words> [max moments]
A person needs named face tracks; "event:60th birthday" builds the session from one clip instead.
"""
import http.cookiejar, json, os, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
SERVER, PERSON = sys.argv[1].rstrip("/"), sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 8
OUT = ROOT / "data" / "spike-memory-lane"
OUT.mkdir(parents=True, exist_ok=True)

jar = http.cookiejar.CookieJar()
web = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def api(path, body=None):
    req = urllib.request.Request(SERVER + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"}, method="GET" if body is None else "POST")
    with web.open(req, timeout=60) as r:
        return json.loads(r.read())

api("/api/session", {"passcode": ENV["DEMO_PASSCODE"].strip().strip('"')})
clips = api("/api/clips")
clips = clips if isinstance(clips, list) else clips.get("clips", clips.get("items", []))
moments = []
EVENT = PERSON[6:].lower() if PERSON.lower().startswith("event:") else None
for c in clips:
    if EVENT is not None:
        if EVENT not in c["title"].lower():
            continue
    elif PERSON.lower() not in [p.lower() for p in c.get("people", [])]:
        continue
    d = api(f"/api/clips/{c['clip_id']}")
    if EVENT is not None:  # every visible face counts in event mode
        spans = [(t["first_s"], t["last_s"]) for t in d["tracks"] if not t["hidden"]]
    else:
        spans = [(t["first_s"], t["last_s"]) for t in d["tracks"] if (t.get("person_name") or "").lower() == PERSON.lower() and not t["hidden"]]
    for s in d["segments"]:
        if not s.get("description"):
            continue
        on = sum(max(0, min(s["end_s"], b) - max(s["start_s"], a)) for a, b in spans)
        if on <= 0:
            continue
        said = [t["text"] for t in d["turns"] if t["end_s"] > s["start_s"] and t["start_s"] < s["end_s"]]
        moments.append({"clip_id": c["clip_id"], "clip_title": c["title"], "recorded_at": c.get("recorded_at"),
                        "start_s": s["start_s"], "end_s": s["end_s"], "on_screen_s": round(on, 1),
                        "description": s["description"], "said": " ".join(said)[:500]})
moments.sort(key=lambda m: -m["on_screen_s"])
picked, seen = [], set()
per_clip = MAX if EVENT is not None else 3
for m in moments:  # variety: a few moments per clip, spread in time
    near = any(p["clip_id"] == m["clip_id"] and abs(p["start_s"] - m["start_s"]) < 25 for p in picked)
    if sum(1 for p in picked if p["clip_id"] == m["clip_id"]) < per_clip and not near:
        picked.append(m)
    if len(picked) == MAX:
        break
picked.sort(key=lambda m: (m["recorded_at"] or "", m["clip_id"], m["start_s"]))
print(f"{len(moments)} moments with {PERSON}; using {len(picked)}")

def spark(system, user, schema_name, schema):
    body = {"model": "muse-spark-1.3", "reasoning": {"effort": "low"},
            "text": {"format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": schema}},
            "input": [{"type": "message", "role": "system", "content": [{"type": "input_text", "text": system}]},
                      {"type": "message", "role": "user", "content": [{"type": "input_text", "text": user}]}]}
    req = urllib.request.Request("https://api.meta.ai/v1/responses", data=json.dumps(body).encode(),
                                 headers={"authorization": f"Bearer {ENV['MODEL_API_KEY'].strip().strip(chr(34))}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = json.loads(r.read())
    text = next(c["text"] for o in raw["output"] if o.get("type") == "message" for c in o["content"] if c.get("type") == "output_text")
    return json.loads(text), raw.get("usage")

WRITE_SYSTEM = (
    "You write a gentle reminiscence session for an older person whose memory is fading, sitting with family. "
    "For each moment write one caption line in the second person (you, your), warm and simple, at most 30 words: "
    "who is there, where and when, what happened. Then one short, gentle question that invites a memory "
    "(never a test, never 'do you remember who this is'). Use ONLY facts in the moment's description, what was said, "
    "the person's name and the date. Never invent names, relationships, places or feelings. If a fact is unknown, leave it out. "
    "Also give a short session title.")
write_schema = {"type": "object", "additionalProperties": False, "required": ["title", "moments"], "properties": {
    "title": {"type": "string"},
    "moments": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["index", "line", "prompt"],
                "properties": {"index": {"type": "integer"}, "line": {"type": "string"}, "prompt": {"type": "string"}}}}}}
inputs = [{"index": i, "person": None if EVENT is not None else PERSON, "date": m["recorded_at"], "event": m["clip_title"], "description": m["description"], "said": m["said"]} for i, m in enumerate(picked)]
draft, u1 = spark(WRITE_SYSTEM, json.dumps({"moments": inputs}, ensure_ascii=False), "memory_session", write_schema)

CHECK_SYSTEM = ("You check a reminiscence session against its source facts. For each line, list every claim and say whether the "
                "source moment supports it. If any claim is unsupported, return a corrected line that keeps only supported facts.")
check_schema = {"type": "object", "additionalProperties": False, "required": ["moments"], "properties": {
    "moments": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["index", "supported", "unsupported_claims", "line"],
                "properties": {"index": {"type": "integer"}, "supported": {"type": "boolean"},
                               "unsupported_claims": {"type": "array", "items": {"type": "string"}}, "line": {"type": "string"}}}}}}
check, u2 = spark(CHECK_SYSTEM, json.dumps({"sources": inputs, "session": draft["moments"]}, ensure_ascii=False), "memory_check", check_schema)

result = {"person": PERSON, "title": draft["title"], "usage": [u1, u2], "moments": []}
fixed = {c["index"]: c for c in check["moments"]}
print(f"\n== {draft['title']}\n")
for d in draft["moments"]:
    m, c = picked[d["index"]], fixed.get(d["index"], {})
    line = c.get("line") or d["line"]
    result["moments"].append({**m, "line": line, "draft_line": d["line"], "prompt": d["prompt"], "supported": c.get("supported"), "unsupported": c.get("unsupported_claims")})
    flag = "" if c.get("supported", True) else f"  [fixed: {', '.join(c.get('unsupported_claims') or [])}]"
    print(f"{d['index']+1}. {m['clip_title']} {m['start_s']:.0f}-{m['end_s']:.0f}s ({m['on_screen_s']}s on screen){flag}\n   {line}\n   ? {d['prompt']}\n")
(OUT / f"{PERSON.lower().replace(':', '-').replace(' ', '-')}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
print("usage:", u1, u2)
