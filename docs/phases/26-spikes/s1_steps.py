"""Spike S1: Muse Spark turns a task video into guide steps. Usage: python3 -I s1_steps.py <video.mp4> <out.json> [tc]"""
import base64, json, sys, time, urllib.request
from pathlib import Path

ROOT = Path("~/Projects/nimbytes")
KEY = next(l.split("=", 1)[1].strip() for l in (ROOT / ".env").read_text().splitlines() if l.startswith("MODEL_API_KEY="))
video, out = Path(sys.argv[1]), Path(sys.argv[2])
tc = len(sys.argv) > 3
step = {"type": "object", "additionalProperties": False,
        "required": ["title", "instruction", "start_s", "end_s", "key_s", "control"],
        "properties": {"title": {"type": "string"}, "instruction": {"type": "string"},
                       "start_s": {"type": "number"}, "end_s": {"type": "number"}, "key_s": {"type": "number"},
                       "control": {"type": "string"}}}
schema = {"type": "object", "additionalProperties": False,
          "required": ["safety", "safety_reason", "title", "steps"],
          "properties": {"safety": {"type": "string", "enum": ["everyday", "caution", "not_supported"]},
                         "safety_reason": {"type": "string"}, "title": {"type": "string"},
                         "steps": {"type": "array", "items": step}}}
system = ("You turn a video of someone doing a familiar household task into a simple step-by-step guide "
          "for an older adult or a person who finds instructions hard. Use plain words. Each step is ONE action. "
          "Title: at most 6 words. Instruction: at most 18 words, imperative, says exactly what to do and where. "
          "start_s and end_s: the seconds of the video where that step happens; key_s: the second that best shows it. "
          "control: the physical thing to circle in the frame for that step (e.g. 'dial', 'start button', 'detergent drawer'), "
          "at most 4 words, or '' if none. Use 3 to 12 steps, in order, not overlapping. "
          "safety: 'not_supported' for medication, electrical repair, gas, driving or anything that could hurt someone if done wrong; "
          "'caution' if a step needs care; else 'everyday'. Never invent steps that are not shown.")
if tc:
    system += " The video shows the elapsed time in the top-left corner as t=HH:MM:SS.ms; use it for start_s, end_s and key_s."
body = {"model": "muse-spark-1.3", "store": False, "reasoning": {"effort": "low"},
        "text": {"format": {"type": "json_schema", "name": "guide_steps", "schema": schema, "strict": True}},
        "input": [{"type": "message", "role": "system", "content": [{"type": "input_text", "text": system}]},
                  {"type": "message", "role": "user", "content": [
                      {"type": "input_text", "text": f"The video is {sys.argv[4] if len(sys.argv) > 4 else '73.9'} seconds long. Make the guide."},
                      {"type": "input_video", "video_url": "data:video/mp4;base64," + base64.b64encode(video.read_bytes()).decode()}]}]}
req = urllib.request.Request("https://api.meta.ai/v1/responses", data=json.dumps(body).encode(),
                             headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
t0 = time.time()
resp = json.loads(urllib.request.urlopen(req, timeout=300).read())
dt = time.time() - t0
text = next(c["text"] for o in resp["output"] if o.get("type") == "message" for c in o["content"] if c.get("type") == "output_text")
guide = json.loads(text)
out.write_text(json.dumps({"seconds": round(dt, 1), "usage": resp.get("usage"), "guide": guide}, indent=2))
print(f"{dt:.1f}s usage={resp.get('usage', {}).get('input_tokens')}/{resp.get('usage', {}).get('output_tokens')}")
print(guide["safety"], "|", guide["title"])
for s in guide["steps"]:
    print(f"{s['start_s']:6.1f}-{s['end_s']:6.1f} key {s['key_s']:6.1f} | {s['title']} | {s['instruction']} | [{s['control']}]")
