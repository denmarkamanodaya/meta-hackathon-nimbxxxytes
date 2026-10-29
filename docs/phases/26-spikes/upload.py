"""Uploads one file to a nimbytes stack through the API (create, PUT parts, complete). Usage: python3 -I upload.py <base_url> <file>"""
import json, ssl, sys, urllib.request, http.cookiejar
from pathlib import Path

ROOT = Path("~/Projects/nimbytes")
PASS = next(l.split("=", 1)[1].strip() for l in (ROOT / ".env").read_text().splitlines() if l.startswith("DEMO_PASSCODE="))
base, f = sys.argv[1].rstrip("/"), Path(sys.argv[2])
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPSHandler(context=ctx))
def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.loads(op.open(req, timeout=60).read() or b"null")
call("POST", "/api/session", {"passcode": PASS})
size = f.stat().st_size
up = call("POST", "/api/uploads", {"filename": f.name, "size_bytes": size, "content_type": "video/mp4"})
ps, parts, data = up["part_size"], [], f.read_bytes()
urls = {p["n"]: p["url"] for p in up["parts"]}
for n in sorted(urls):
    chunk = data[(n - 1) * ps : n * ps]
    r = urllib.request.urlopen(urllib.request.Request(urls[n], data=chunk, method="PUT"), timeout=600)
    parts.append({"n": n, "etag": r.headers["ETag"]}); print("part", n, "ok", flush=True)
done = call("POST", f"/api/uploads/{up['upload_id']}/complete", {"parts": parts})
print(json.dumps(done))
