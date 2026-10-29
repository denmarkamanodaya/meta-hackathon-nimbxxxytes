#!/usr/bin/env python3
"""Checks the similar-footage links the API reports against the test kit's EXPECTED.csv.

Upload every file of data/samples/similar/ first (scripts/similar-kit.sh builds them), wait for
ingest, then run:

    python3 scripts/similar-check.py [--base-url https://localhost] [--kit data/samples/similar]

The passcode is read from DEMO_PASSCODE in the environment, else from the repo's .env. It is never
printed. Clips are matched to kit rows by filename. Per row it prints PASS or FAIL, then any extra
link between kit clips as INFO. Exit code 1 when a row fails or a kit clip is missing.

Expected shapes:
- clip list item: {clip_id, filename, near_copy_of: {clip_id, title, score} | null, ...}
- clip detail:    {clip: {...}, links: [{clip_id, title, kind, score}], ...}
  kind is "near_copy_of", "copied_by" or "same_moment"; `links` may also sit inside `clip`.
"""

from __future__ import annotations

import argparse
import csv
import http.cookiejar
import json
import os
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def passcode() -> str:
    value = os.environ.get("DEMO_PASSCODE")
    if value:
        return value
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DEMO_PASSCODE="):
                return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("DEMO_PASSCODE not set and not found in .env")


class Api:
    def __init__(self, base: str, insecure: bool) -> None:
        self.base = base.rstrip("/")
        ctx = ssl._create_unverified_context() if insecure else ssl.create_default_context()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=ctx))

    def call(self, method: str, path: str, body: dict | None = None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}{path}", data=data, method=method,
                                     headers={"content-type": "application/json"})
        with self.opener.open(req, timeout=30) as res:
            raw = res.read()
        return json.loads(raw) if raw else None


def links_of(detail: dict) -> list[dict]:
    links = detail.get("links")
    if links is None:
        links = (detail.get("clip") or {}).get("links")
    if links is None:
        sys.exit("clip detail has no `links` field yet: the similar-footage API is not deployed")
    return links


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base-url", default="https://localhost")
    ap.add_argument("--kit", default=str(ROOT / "data/samples/similar"))
    ap.add_argument("--secure", action="store_true", help="verify TLS (off for the local Caddy)")
    args = ap.parse_args()

    with open(Path(args.kit) / "EXPECTED.csv", newline="") as f:
        rows = list(csv.DictReader(f))

    api = Api(args.base_url, insecure=not args.secure)
    api.call("POST", "/api/session", {"passcode": passcode()})
    clips = api.call("GET", "/api/clips")
    clips = clips.get("items", clips) if isinstance(clips, dict) else clips

    by_name: dict[str, dict] = {}
    for c in clips:
        name = c.get("filename")
        if name in {r["file"] for r in rows}:
            if name in by_name:
                print(f"WARN  {name}: uploaded more than once, using the newest listed first")
                continue
            by_name[name] = c

    ok = True
    missing = [r["file"] for r in rows if r["file"] not in by_name]
    for name in missing:
        print(f"FAIL  {name}: not in the library (upload the kit first)")
        ok = False
    if missing:
        return 1

    id_to_name = {c["clip_id"]: n for n, c in by_name.items()}
    links: dict[str, list[dict]] = {}
    for name, c in by_name.items():
        links[name] = links_of(api.call("GET", f"/api/clips/{c['clip_id']}"))

    def linked(a: str, b: str, kind: str) -> dict | None:
        """A link of `kind` between kit files a and b, reported on either side."""
        for x, y in ((a, b), (b, a)):
            for link in links[x]:
                if link.get("kind") == kind and link.get("clip_id") == by_name[y]["clip_id"]:
                    return link
        return None

    expected_pairs: set[frozenset[str]] = set()
    for r in rows:
        name, kind, other = r["file"], r["expected"], r["other"]
        clip = by_name[name]
        kit_links = [l for l in links[name] if l.get("clip_id") in id_to_name]
        if kind == "original":
            good = clip.get("near_copy_of") is None
            why = "is not marked as a copy" if good else f"marked near_copy_of {clip.get('near_copy_of')}"
        elif kind == "near_copy":
            expected_pairs.add(frozenset((name, other)))
            link = linked(name, other, "near_copy_of")
            mark_ok = (clip.get("near_copy_of") or {}).get("clip_id") == by_name[other]["clip_id"]
            good = link is not None and mark_ok
            why = (f"near_copy of {other} (score {link.get('score')})" if good else
                   f"link {'found' if link else 'missing'}, near_copy_of "
                   f"{'ok' if mark_ok else repr(clip.get('near_copy_of'))}")
        elif kind == "same_moment":
            expected_pairs.add(frozenset((name, other)))
            link = linked(name, other, "same_moment")
            good = link is not None and clip.get("near_copy_of") is None
            why = (f"same_moment with {other} (score {link.get('score')})" if good else
                   f"same_moment link {'found' if link else 'missing'}, near_copy_of "
                   f"{clip.get('near_copy_of')!r}")
        elif kind == "none":
            back = [n for n in by_name if any(l.get("clip_id") == clip["clip_id"] for l in links[n])]
            good = not kit_links and not back and clip.get("near_copy_of") is None
            why = "no links" if good else (
                f"unexpected links: {[(id_to_name[l['clip_id']], l.get('kind')) for l in kit_links]}"
                f" reported by {back}")
        else:
            good, why = False, f"unknown expected kind {kind!r} in EXPECTED.csv"
        ok &= good
        print(f"{'PASS' if good else 'FAIL'}  {name:22s} expected {kind:12s} {why}")

    # Extra links among kit clips (for example two near-copies of base linked to each other).
    seen: set[frozenset[str]] = set()
    for name in by_name:
        for l in links[name]:
            other = id_to_name.get(l.get("clip_id"))
            pair = frozenset((name, other)) if other else None
            if pair and pair not in expected_pairs and pair not in seen:
                seen.add(pair)
                print(f"INFO  extra link {name} -> {other}: {l.get('kind')} ({l.get('score')})")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
