"""Uploads the near-copy test kit (data/samples/similar/, made by scripts/similar-kit.sh) to a
running nimbytes API through the real multipart upload flow, base first, and waits until each
clip settles (ready, near_copy, duplicate or failed). Then run scripts/similar-check.py.

Usage: python3 -I scripts/similar-upload.py [--api https://localhost] [--env .env]
The demo passcode is read from the env file and never printed. Local stacks use a self-signed
certificate, so TLS checks are off for localhost only.
"""
import argparse
import http.cookiejar
import json
import os
import ssl
import sys
import time
import urllib.request

KIT = "data/samples/similar"
ORDER = ["base", "reencode", "resized", "trimmed", "reexport", "shuffled", "angle_b", "same_time_other", "other"]
SETTLED = {"ready", "near_copy", "duplicate", "failed"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="https://localhost")
    ap.add_argument("--env", default=".env")
    args = ap.parse_args()
    ctx = ssl.create_default_context()
    if "localhost" in args.api:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(jar))

    def call(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.api + "/api" + path, data=data, method=method, headers={"content-type": "application/json"})
        with opener.open(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else None

    passcode = next(l.split("=", 1)[1].strip() for l in open(args.env) if l.startswith("DEMO_PASSCODE="))
    call("POST", "/session", {"passcode": passcode})

    have = {c["filename"]: c["clip_id"] for c in call("GET", "/clips")}
    for name in ORDER:
        path = f"{KIT}/{name}.mp4"
        if f"{name}.mp4" in have:
            # Already uploaded by an earlier run: only wait for it to settle.
            made = {"clip_id": have[f"{name}.mp4"]}
            clip = made["clip_id"]
            status = "uploaded"
            for _ in range(180):
                status = call("GET", f"/clips/{clip}")["clip"]["status"]
                if status in SETTLED:
                    break
                time.sleep(5)
            print(f"{name:16} {clip}  {status} (already uploaded)", flush=True)
            continue
        size = os.path.getsize(path)
        made = call("POST", "/uploads", {"filename": f"{name}.mp4", "size_bytes": size, "content_type": "video/mp4"})
        part = made["part_size"]
        count = (size + part - 1) // part
        urls = {p["n"]: p["url"] for p in made["parts"]}
        missing = [n for n in range(1, count + 1) if n not in urls]
        if missing:
            urls.update({p["n"]: p["url"] for p in call("POST", f"/uploads/{made['upload_id']}/parts", {"part_numbers": missing})["parts"]})
        done = []
        with open(path, "rb") as f:
            for n in range(1, count + 1):
                chunk = f.read(part)
                put = urllib.request.Request(urls[n], data=chunk, method="PUT")
                with urllib.request.urlopen(put, timeout=300) as r:
                    done.append({"n": n, "etag": r.headers["ETag"]})
        call("POST", f"/uploads/{made['upload_id']}/complete", {"parts": done})
        clip = made["clip_id"]
        status = "uploaded"
        for _ in range(180):
            status = call("GET", f"/clips/{clip}")["clip"]["status"]
            if status in SETTLED:
                break
            time.sleep(5)
        print(f"{name:16} {clip}  {status}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
