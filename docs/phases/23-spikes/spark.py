# usage: spark.py out.json schema.json prompt.txt [image ...]  (images as data URLs)
import sys, json, base64, time, urllib.request
key = [l.split('=',1)[1].strip().strip('"') for l in open('~/Projects/nimbytes/.env') if l.startswith('MODEL_API_KEY=')][0]
out, schema_p, prompt_p, imgs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
schema = json.load(open(schema_p)); prompt = open(prompt_p).read()
content = [{"type": "input_text", "text": prompt}] + [{"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(open(p, 'rb').read()).decode()} for p in imgs]
body = {"model": "muse-spark-1.3", "store": False, "reasoning": {"effort": "low"}, "input": [{"type": "message", "role": "user", "content": content}],
        "text": {"format": {"type": "json_schema", "name": "out", "strict": True, "schema": schema}}}
req = urllib.request.Request('https://api.meta.ai/v1/responses', data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
t = time.time()
try:
    r = json.load(urllib.request.urlopen(req, timeout=180))
except urllib.error.HTTPError as e:
    print('HTTP', e.code, e.read().decode()[:400]); sys.exit(1)
txt = ''.join(c.get('text', '') for o in r.get('output', []) for c in (o.get('content') or []) if c.get('type') == 'output_text')
json.dump({"usage": r.get("usage"), "answer": json.loads(txt)}, open(out, 'w'), indent=1)
u = r.get('usage', {}); cost = u.get('input_tokens', 0) * 1.25e-6 + u.get('output_tokens', 0) * 4.25e-6
print(f"{out} {time.time()-t:.1f}s ${cost:.4f}", json.dumps(json.loads(txt))[:300])
