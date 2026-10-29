"""Phase 29.0 calibration spike: PE image similarity for near-copies and same-moment footage.

Run from the repo root with the ml venv:
    ml/.venv/bin/python docs/phases/29-spikes/calibrate.py

Inputs
- data/samples/similar/        the kit from scripts/similar-kit.sh
- data/similar-spike/real/     the owner's real segment thumbnails, fetched from the local API
                               (<clip_id>__<idx>.jpg), already the exact ingest thumbs
- data/samples/{up720,pexels,dvids}  other sample videos, the extra "unrelated" set

Moments mimic ingest: scene cuts with the same filter as args::scene_cuts (select gt(scene,0.3)),
then the 5-10 s windows of domain/segmenting.rs::windows (ported below), one thumbnail at each
window's middle with the same ffmpeg args as MediaTool::thumbnail
(-ss mid -i src -frames:v 1 -vf scale=640:-2 -q:v 3). Ingest takes the thumb from the proxy, the
spike from the file itself.
"Blank" moments (near-uniform thumbnails: black frames, a covered lens) are flagged by the
grey-level standard deviation and reported apart, because they match each other at ~1.0.
Embeddings use api/models/pe/image.onnx with meta.json preprocessing (RGB, squash 224 bilinear
with antialias, /255, (x-0.5)/0.5, NCHW). Outputs are L2-normalised, so cosine = dot.
"""

from __future__ import annotations

import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
KIT = ROOT / "data/samples/similar"
REAL = ROOT / "data/similar-spike/real"
CACHE = ROOT / "data/similar-spike/cache"
PE = ROOT / "api/models/pe"
MIN_W, TARGET_W, MAX_W = 5.0, 7.0, 10.0
BLANK_STD = 12.0   # grey-level std (0-255) below which a thumbnail counts as blank
THRESHOLDS = [0.80, 0.83, 0.85, 0.88, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97]

KIT_FILES = ["base", "reencode", "resized", "trimmed", "reexport", "shuffled", "angle_b",
             "same_time_other", "other"]
# Unrelated sample videos: distinct sources only (no copies of each other, not the base source).
UNRELATED = [
    "up720/A1_939219.mp4", "up720/A1_939972.mp4", "up720/A1_940625.mp4", "up720/A1_941492.mp4",
    "up720/A1_951167.mp4", "up720/A1neg_939692.mp4", "up720/A1neg_958263.mp4",
    "up720/Ready_11842272.mp4", "up720/Ready_34237017.mp4",
    "pexels/B_14109231.mp4", "pexels/B_30567541.mp4", "pexels/B_30567549.mp4",
    "pexels/B_31014581.mp4", "pexels/Ready_40123679.mp4", "pexels/Ready_6646681.mp4",
    "dvids/A1alt_938296.mp4", "dvids/A1alt_938842.mp4", "dvids/A2_885954.mp4",
    "dvids/A2_886529.mp4", "dvids/A2_887313.mp4", "dvids/A2_887328.mp4", "dvids/A2_887750.mp4",
]
# Same event, different, non-overlapping parts of one long video: reported apart (hard negatives).
SAME_EVENT = ["up720/A1_943308_a.mp4", "up720/A1_943308_c.mp4", "up720/A1_943308_d.mp4"]


def duration(src: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                          "default=nw=1:nk=1", str(src)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def scene_cuts(src: Path) -> list[float]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-nostats",
                          "-i", str(src), "-vf", "select='gt(scene,0.3)',metadata=mode=print:file=-",
                          "-an", "-f", "null", "-"], capture_output=True, text=True, check=True)
    return [float(line.split("pts_time:")[1].split()[0])
            for line in out.stdout.splitlines() if "pts_time:" in line]


def windows(d: float, cuts: list[float]) -> list[tuple[float, float]]:
    """Port of core domain/segmenting.rs::windows."""
    out, start = [], 0.0
    while d - start > MAX_W:
        rem = d - start
        if rem < MAX_W + MIN_W:
            lo, hi, target = start + MIN_W, d - MIN_W, start + rem / 2
        else:
            lo, hi, target = start + MIN_W, start + MAX_W, start + TARGET_W
        inside = [c for c in cuts if lo <= c <= hi]
        end = min(inside, key=lambda c: abs(c - target)) if inside else target
        out.append((start, end))
        start = end
    out.append((start, d))
    return out


def moment_thumbs(src: Path, tag: str) -> list[Path]:
    """One thumbnail per ingest window, at its middle."""
    out_dir = CACHE / tag
    out_dir.mkdir(parents=True, exist_ok=True)
    spans_f = out_dir / "spans.json"
    if spans_f.exists():
        spans = json.loads(spans_f.read_text())
    else:
        spans = windows(duration(src), scene_cuts(src))
        spans_f.write_text(json.dumps(spans))
    thumbs = []
    for i, (start, end) in enumerate(spans):
        dst = out_dir / f"{i:03d}.jpg"
        if not dst.exists():
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                            "-ss", f"{(start + end) / 2:.3f}", "-i", str(src),
                            "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", str(dst)],
                           check=True)
        thumbs.append(dst)
    return thumbs


def blank_mask(paths: list[Path]) -> np.ndarray:
    return np.array([np.asarray(Image.open(p).convert("L"), dtype=np.float32).std() < BLANK_STD
                     for p in paths])


class Embedder:
    def __init__(self) -> None:
        meta = json.loads((PE / "meta.json").read_text())["image"]
        self.size = meta["input_shape"][3]
        self.mean = np.array(meta["mean"], dtype=np.float32).reshape(3, 1, 1)
        self.std = np.array(meta["std"], dtype=np.float32).reshape(3, 1, 1)
        self.sess = ort.InferenceSession(str(PE / meta["file"]), providers=["CPUExecutionProvider"])
        self.inp = meta["input"]

    def __call__(self, paths: list[Path]) -> np.ndarray:
        vecs = []
        for k in range(0, len(paths), 16):
            batch = []
            for p in paths[k:k + 16]:
                img = Image.open(p).convert("RGB").resize((self.size, self.size), Image.BILINEAR)
                x = np.asarray(img, dtype=np.float32).transpose(2, 0, 1) / 255.0
                batch.append((x - self.mean) / self.std)
            vecs.append(self.sess.run(None, {self.inp: np.stack(batch)})[0])
        v = np.concatenate(vecs)
        return v / np.linalg.norm(v, axis=1, keepdims=True)


def embed_cached(emb: Embedder, tag: str, paths: list[Path]) -> np.ndarray:
    f = CACHE / f"{tag.replace('/', '_')}.npy"
    if f.exists():
        v = np.load(f)
        if len(v) == len(paths):
            return v
    v = emb(paths)
    np.save(f, v)
    return v


def lis_len(seq: list[int]) -> int:
    """Longest non-decreasing subsequence: how many matches keep their order in time."""
    import bisect
    tails: list[int] = []
    for x in seq:
        i = bisect.bisect_right(tails, x)
        tails[i:i + 1] = [x]
    return len(tails)


def pair_stats(a: np.ndarray, b: np.ndarray) -> dict:
    """Shorter clip's moments against the longer clip: best sim per moment and its index."""
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    sims = short @ long_.T
    best = sims.max(axis=1)
    arg = sims.argmax(axis=1)
    cov = {t: float((best >= t).mean()) for t in THRESHOLDS}
    order = {}
    for t in THRESHOLDS:
        idx = [int(arg[i]) for i in range(len(best)) if best[i] >= t]
        order[t] = lis_len(idx) / len(best)
    return {"best": best, "arg": arg, "cov": cov, "ordered": order, "n_short": len(best),
            "max": float(best.max())}


def hist(values: np.ndarray, edges: list[float]) -> list[int]:
    return [int(((values >= lo) & (values < hi)).sum()) for lo, hi in zip(edges, edges[1:])]


def cov_row(label: str, s: dict) -> str:
    cells = [f"{s['cov'][t]:.0%}/{s['ordered'][t]:.0%}" for t in THRESHOLDS]
    return (f"| {label} | {s['n_short']} | {s['max']:.3f} | {s['best'].min():.3f} | "
            f"{s['best'].mean():.3f} | "
            + " | ".join(cells) + " |")


def main() -> None:
    emb = Embedder()
    full: dict[str, np.ndarray] = {}
    blank: dict[str, np.ndarray] = {}

    def add(tag: str, paths: list[Path]) -> None:
        full[tag] = embed_cached(emb, tag, paths)
        blank[tag] = blank_mask(paths)

    for name in KIT_FILES:
        src = KIT / f"{name}.mp4"
        if not src.exists():
            sys.exit(f"missing {src}: run scripts/similar-kit.sh first")
        add(f"kit/{name}", moment_thumbs(src, f"kit/{name}"))

    real: dict[str, list[Path]] = defaultdict(list)
    for p in sorted(REAL.glob("*.jpg")):
        real[p.stem.split("__")[0]].append(p)
    for cid, paths in real.items():
        add(f"real/{cid[-6:]}", paths)

    for rel in UNRELATED + SAME_EVENT:
        tag = f"smp/{Path(rel).stem}"
        add(tag, moment_thumbs(ROOT / "data/samples" / rel, tag))

    # Extra true pair: the owner's real ingest thumbs of the laundry clip (made from the proxy)
    # vs the spike's thumbs of the same file, to check the spike behaves like ingest.
    laundry = ROOT / "data/samples/myway/laundry-task-720.mp4"
    if laundry.exists():
        add("smp/laundry_spike", moment_thumbs(laundry, "smp/laundry_spike"))

    # Blank moments never take part in matching (recommended rule); counted here.
    clips = {k: v[~blank[k]] for k, v in full.items()}
    print("moments per clip (blank):",
          {k: f"{len(v)}({int(blank[k].sum())})" for k, v in full.items()})

    hdr = "| row | n | max | min best | mean best | " + " | ".join(f"{t:.2f}" for t in THRESHOLDS) + " |"
    sep = "|" + "---|" * (5 + len(THRESHOLDS))

    # (a) kit pairs vs base
    base = clips["kit/base"]
    print("\n## (a) kit rows vs base\n\ncell = coverage/ordered: share of the shorter clip's"
          " moments whose best match in the other clip is >= T / share that also keeps time"
          " order (longest increasing run)\n")
    print(hdr)
    print(sep)
    kit_best = {}
    for name in KIT_FILES[1:]:
        s = pair_stats(clips[f"kit/{name}"], base)
        kit_best[name] = s["best"]
        print(cov_row(name, s))
    real_laundry = None
    if "smp/laundry_spike" in clips:
        for k in [k for k in clips if k.startswith("real/")]:
            s = pair_stats(clips["smp/laundry_spike"], clips[k])
            if s["max"] > 0.9:
                real_laundry = s
                print(cov_row(f"laundry spike vs ingest ({k})", s))
    print("\nper-moment best sims vs base:")
    for name, b in kit_best.items():
        print(f"  {name:16s}", " ".join(f"{x:.3f}" for x in b))
    if real_laundry is not None:
        print("  laundry          ", " ".join(f"{x:.3f}" for x in real_laundry["best"]))

    # (b) unrelated: every pair of distinct clips among real + unrelated samples, plus every kit
    # file of the base family against them and against the kit's unrelated rows.
    pool = [k for k in clips if k.startswith("real/")] + [f"smp/{Path(r).stem}" for r in UNRELATED]
    kit_family = ["kit/base", "kit/reencode", "kit/resized", "kit/trimmed", "kit/reexport",
                  "kit/shuffled", "kit/angle_b"]
    pairs = [(a, b) for i, a in enumerate(pool) for b in pool[i + 1:]]
    pairs += [(k, p) for k in kit_family for p in pool]
    pairs += [(k, o) for k in kit_family for o in ("kit/same_time_other", "kit/other")]
    real_ids = [k for k in clips if k.startswith("real/")]
    all_mb, pair_max, worst, real_max = [], [], [], 0.0
    cov_hits = {t: 0 for t in THRESHOLDS}
    for a, b in pairs:
        s = pair_stats(clips[a], clips[b])
        all_mb.append(s["best"])
        pair_max.append(s["max"])
        worst.append((s["max"], a, b, s["cov"]))
        if a in real_ids and b in real_ids:
            real_max = max(real_max, s["max"])
        for t in THRESHOLDS:
            if s["ordered"][t] >= 0.8:
                cov_hits[t] += 1
        if s["ordered"][0.80] >= 0.8:
            print(f"unrelated pair with >= 80% ordered coverage at 0.80: {a} vs {b},"
                  f" n {s['n_short']}, mean best {s['best'].mean():.3f}")
    mb, pm = np.concatenate(all_mb), np.array(pair_max)
    bl = np.concatenate([full[k][blank[k]] for k in full if blank[k].any()] or [np.zeros((0, 1))])
    nb = np.concatenate([full[k][~blank[k]] for k in full])
    blank_note = "none found"
    if len(bl):
        bb = bl @ bl.T
        np.fill_diagonal(bb, -1)
        blank_note = (f"{len(bl)} blank moments; blank vs blank max {bb.max():.3f}, "
                      f"blank vs any non-blank max {float((bl @ nb.T).max()):.3f}")

    true_best = np.concatenate([kit_best[n] for n in ("reencode", "resized", "trimmed", "reexport")])
    angle_best = kit_best["angle_b"]
    edges = [0.0, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, 1.01]
    print(f"\n## (b) unrelated: {len(pairs)} clip pairs, {len(mb)} moment best-matches"
          " (blank moments excluded)\n")
    print("| sim bin | near-copy moments | angle_b moments | unrelated moments | unrelated pair max |")
    print("|---|---|---|---|---|")
    for (lo, hi), c1, c2, c3, c4 in zip(zip(edges, edges[1:]), hist(true_best, edges),
                                         hist(angle_best, edges), hist(mb, edges), hist(pm, edges)):
        print(f"| {lo:.2f}-{min(hi, 1.0):.2f} | {c1} | {c2} | {c3} | {c4} |")
    print(f"\nmax unrelated moment sim: {mb.max():.3f}; p99.9 {np.quantile(mb, 0.999):.3f};"
          f" p99 {np.quantile(mb, 0.99):.3f}; owner's real clips among themselves: {real_max:.3f}")
    print(f"blank moments (excluded from matching): {blank_note}")
    print(f"near-copy moments: min {true_best.min():.3f}, p5 {np.quantile(true_best, 0.05):.3f}")
    print("unrelated clip pairs with >= 80% ordered coverage at T:",
          {f"{t:.2f}": cov_hits[t] for t in THRESHOLDS})
    print("\ntop 8 unrelated pairs by max moment sim:")
    for m, a, b, cov in sorted(worst, reverse=True)[:8]:
        print(f"  {m:.3f}  {a} vs {b}  cov@0.85={cov[0.85]:.0%} cov@0.90={cov[0.90]:.0%}")

    print("\n## same event, different parts of one video (A1_943308 a/c/d), hard negatives\n")
    print(hdr)
    print(sep)
    se = [f"smp/{Path(r).stem}" for r in SAME_EVENT]
    for i, a in enumerate(se):
        for b in se[i + 1:]:
            print(cov_row(f"{a[-1]} vs {b[-1]}", pair_stats(clips[a], clips[b])))


if __name__ == "__main__":
    main()
