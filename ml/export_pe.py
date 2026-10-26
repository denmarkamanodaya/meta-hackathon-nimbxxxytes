"""Export Perception Encoder PE-Core-B16-224 to ONNX for the nimbytes API.

Writes into api/models/pe/:
  image.onnx      image tower: pixel_values f32 [N,3,224,224] -> embeddings f32 [N,1024], L2-normalised
  text.onnx       text tower:  input_ids i64 [N,32]          -> embeddings f32 [N,1024], L2-normalised
  tokenizer.json  CLIP BPE tokenizer for the Rust `tokenizers` crate (truncation + padding built in)
  meta.json       everything the Rust side needs to preprocess inputs and read outputs

Usage (from ml/, see README.md):
  .venv/bin/python -I export_pe.py           export only
  .venv/bin/python -I export_pe.py --check   export, then compare ONNX Runtime against PyTorch
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
VENDOR_DIR = ML_DIR / "vendor"
UPSTREAM_DIR = VENDOR_DIR / "perception_models"
TEST_IMAGE_DIR = VENDOR_DIR / "testimages"
OUT_DIR = ML_DIR.parent / "api" / "models" / "pe"

# Weights and code download into ml/vendor/ only (git-ignored).
os.environ.setdefault("HF_HOME", str(VENDOR_DIR / "hf"))

MODEL_NAME = "PE-Core-B16-224"
HF_REPO = "facebook/PE-Core-B16-224"
HF_REVISION = "a16450b46fef32363459920c2685a1b4ef13dcd9"
UPSTREAM_REPO = "https://github.com/facebookresearch/perception_models.git"
UPSTREAM_COMMIT = "3e352cca660658d4b5c90f42a7808b11469e4c66"
OPSET = 18
MAX_ABS_DIFF = 1e-3
USER_AGENT = "nimbytes-ml-export/0.1"

# CC0 images from Wikimedia Commons (500 px thumbnails), used only by --check.
TEST_IMAGES = {
    "coffee": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/"
        "Coffee_cup_on_coffee_beans.jpg/500px-Coffee_cup_on_coffee_beans.jpg",
        "3dc833d77e86d56bad67e734db37dd610d725b5a7e39aa9ac4b03bdf1afeb4c3",
    ),
    "bicycles": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/"
        "Bicycles_parked_in_Amsterdam.jpg/500px-Bicycles_parked_in_Amsterdam.jpg",
        "573fc43266805e664f3895103420dcc71cefad866c0bae837999e2af8c68ba95",
    ),
    "lake": (
        "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/"
        "Lake_Mountain_Landscape.jpg/500px-Lake_Mountain_Landscape.jpg",
        "c890731b51ca476de0a6c3d49b6655733ffd0c3e960cc90f756ce5d7afcffe6d",
    ),
}
TEST_TEXTS = ["a cup of coffee", "bicycles parked on a street", "a lake in the mountains", "a dog"]
TOKENIZER_PARITY_TEXTS = TEST_TEXTS + [
    "",
    "   Two   SPACES\tand a tab\n",
    "it's what we've got, isn't it?",
    "Person 2 laughing at 00:01:23 near the café",
    "emoji 🎉🔥 and ümlauts, naïve façade",
    "C++ / Rust & TypeScript (v1.2.3) -- 100% done!!!",
    "the quick brown fox jumps over the lazy dog " * 6,  # longer than the context, tests truncation
]


def ensure_upstream() -> None:
    """Clone the upstream PE code at the pinned commit into ml/vendor/ (not into our tree)."""
    if not UPSTREAM_DIR.exists():
        UPSTREAM_DIR.mkdir(parents=True)
        git = ["git", "-C", str(UPSTREAM_DIR)]
        subprocess.run([*git, "init", "-q"], check=True)
        subprocess.run([*git, "fetch", "-q", "--depth", "1", UPSTREAM_REPO, UPSTREAM_COMMIT], check=True)
        subprocess.run([*git, "checkout", "-q", "FETCH_HEAD"], check=True)
    head = subprocess.run(
        ["git", "-C", str(UPSTREAM_DIR), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    ).stdout.strip()
    if head != UPSTREAM_COMMIT:
        sys.exit(f"{UPSTREAM_DIR} is at {head}, expected {UPSTREAM_COMMIT}")
    sys.path.insert(0, str(UPSTREAM_DIR))


def load_model():
    from huggingface_hub import hf_hub_download

    import core.vision_encoder.pe as pe

    ckpt = hf_hub_download(repo_id=HF_REPO, filename=f"{MODEL_NAME}.pt", revision=HF_REVISION)
    return pe.CLIP.from_config(MODEL_NAME, pretrained=True, checkpoint_path=ckpt).eval()


def build_tokenizer(context_length: int):
    """Build a `tokenizers` tokenizer from the upstream CLIP BPE vocab, matching SimpleTokenizer ids."""
    from tokenizers import Regex, Tokenizer, models, normalizers, pre_tokenizers, processors

    from core.vision_encoder.tokenizer import SimpleTokenizer

    st = SimpleTokenizer(context_length=context_length)
    merges = sorted(st.bpe_ranks, key=st.bpe_ranks.get)
    tok = Tokenizer(models.BPE(vocab=st.encoder, merges=merges, end_of_word_suffix="</w>"))
    tok.normalizer = normalizers.Sequence(
        [normalizers.NFC(), normalizers.Replace(Regex(r"\s+"), " "), normalizers.Strip(), normalizers.Lowercase()]
    )
    # Same split pattern as SimpleTokenizer.pat; the text is already lower-cased by the normalizer.
    pattern = r"""<start_of_text>|<end_of_text>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+"""
    tok.pre_tokenizer = pre_tokenizers.Sequence(
        [
            pre_tokenizers.Split(Regex(pattern), behavior="removed", invert=True),
            pre_tokenizers.ByteLevel(add_prefix_space=False, use_regex=False),
        ]
    )
    tok.add_special_tokens(["<start_of_text>", "<end_of_text>"])
    tok.post_processor = processors.TemplateProcessing(
        single="<start_of_text> $A <end_of_text>",
        special_tokens=[("<start_of_text>", st.sot_token_id), ("<end_of_text>", st.eot_token_id)],
    )
    tok.enable_truncation(max_length=context_length)
    tok.enable_padding(length=context_length, pad_id=0, pad_token=st.decoder[0])
    return st, tok


def export_onnx(module, example, input_name: str, path: Path) -> None:
    import onnx
    import torch

    batch = torch.export.Dim("batch", min=1, max=64)
    program = torch.onnx.export(
        module,
        (example,),
        dynamo=True,
        opset_version=OPSET,
        input_names=[input_name],
        output_names=["embeddings"],
        dynamic_shapes={"x": {0: batch}},
    )
    program.save(str(path), external_data=False)
    onnx.checker.check_model(str(path))


def towers(model):
    import torch

    class ImageTower(torch.nn.Module):
        def __init__(self, clip):
            super().__init__()
            self.clip = clip

        def forward(self, x):
            return self.clip.encode_image(x, normalize=True)

    class TextTower(torch.nn.Module):
        def __init__(self, clip):
            super().__init__()
            self.clip = clip

        def forward(self, x):
            return self.clip.encode_text(x, normalize=True)

    return ImageTower(model).eval(), TextTower(model).eval()


def write_meta(model, st) -> None:
    import onnx
    import onnxruntime
    import torch

    meta = {
        "model": MODEL_NAME,
        "licence": "Apache-2.0",
        "source": {
            "hf_repo": HF_REPO,
            "hf_revision": HF_REVISION,
            "code_repo": UPSTREAM_REPO,
            "code_commit": UPSTREAM_COMMIT,
        },
        "embedding_dim": model.visual.proj.shape[1] if model.visual.proj is not None else None,
        "embeddings_l2_normalised": True,
        "logit_scale": float(model.logit_scale.detach().exp()),
        "image": {
            "file": "image.onnx",
            "input": "pixel_values",
            "input_shape": ["batch", 3, model.image_size, model.image_size],
            "input_dtype": "float32",
            "layout": "NCHW",
            "colour": "RGB",
            "resize": "squash: resize straight to image_size x image_size, no crop, aspect not kept",
            "interpolation": "bilinear",
            "scale": "pixel / 255",
            "mean": [0.5, 0.5, 0.5],
            "std": [0.5, 0.5, 0.5],
            "output": "embeddings",
        },
        "text": {
            "file": "text.onnx",
            "input": "input_ids",
            "input_dtype": "int64",
            "context_length": model.context_length,
            "pad_id": 0,
            "sot_id": st.sot_token_id,
            "eot_id": st.eot_token_id,
            "pooling": "token at argmax(input_ids) = the end-of-text token, so pad must stay 0",
            "output": "embeddings",
        },
        "tokenizer": {
            "file": "tokenizer.json",
            "kind": "CLIP byte-level BPE (bpe_simple_vocab_16e6), lower-case",
            "vocab_size": st.vocab_size,
            "usage": "tokenizers::Tokenizer::from_file(path)?.encode(text, true)?.get_ids(): "
            "always context_length ids, truncation and zero padding are configured in the file",
            "known_difference": "upstream also runs ftfy.fix_text and html.unescape before tokenising; "
            "tokenizer.json does not, so only mojibake or HTML entities can tokenise differently",
        },
        "opset": OPSET,
        "exported_with": {
            "torch": torch.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
        },
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")


def fetch_test_images() -> dict:
    from PIL import Image

    TEST_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    images = {}
    for name, (url, sha256) in TEST_IMAGES.items():
        path = TEST_IMAGE_DIR / f"{name}.jpg"
        if not path.exists():
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                path.write_bytes(resp.read())
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != sha256:
            sys.exit(f"{path}: sha256 {digest} does not match {sha256}")
        images[name] = Image.open(path)
    return images


def mean_latency_ms(session, feed: dict, runs: int = 20) -> float:
    for _ in range(3):
        session.run(None, feed)
    start = time.perf_counter()
    for _ in range(runs):
        session.run(None, feed)
    return (time.perf_counter() - start) / runs * 1000


def check(st) -> bool:
    import numpy as np
    import onnxruntime as ort
    import torch

    import core.vision_encoder.transforms as transforms

    # The exporter leaves the exported module returning tensor subclasses, so compare against a fresh copy.
    model = load_model()
    ok = True

    # 1. Tokenizer parity: tokenizer.json (what Rust loads) vs the upstream SimpleTokenizer.
    from tokenizers import Tokenizer

    rust_tok = Tokenizer.from_file(str(OUT_DIR / "tokenizer.json"))
    for text in TOKENIZER_PARITY_TEXTS:
        want = st([text])[0].tolist()
        got = rust_tok.encode(text, add_special_tokens=True).ids
        if got != want:
            ok = False
            print(f"FAIL tokenizer {text!r}\n  upstream {want}\n  json     {got}")
    print(f"tokenizer parity: {len(TOKENIZER_PARITY_TEXTS)} strings checked")

    # 2. Embedding parity: ONNX Runtime vs PyTorch on the same input tensors.
    preprocess = transforms.get_image_transform(model.image_size)
    images = fetch_test_images()
    pixels = torch.stack([preprocess(img) for img in images.values()])
    ids = torch.tensor([e.ids for e in rust_tok.encode_batch(TEST_TEXTS)], dtype=torch.long)

    with torch.no_grad():
        torch_img = model.encode_image(pixels, normalize=True).numpy()
        torch_txt = model.encode_text(ids, normalize=True).numpy()

    opts = ort.SessionOptions()
    img_sess = ort.InferenceSession(str(OUT_DIR / "image.onnx"), opts, providers=["CPUExecutionProvider"])
    txt_sess = ort.InferenceSession(str(OUT_DIR / "text.onnx"), opts, providers=["CPUExecutionProvider"])
    ort_img = img_sess.run(None, {"pixel_values": pixels.numpy()})[0]
    ort_txt = txt_sess.run(None, {"input_ids": ids.numpy()})[0]

    for label, a, b in (("image", torch_img, ort_img), ("text", torch_txt, ort_txt)):
        diff = float(np.abs(a - b).max())
        verdict = "ok" if diff <= MAX_ABS_DIFF else "FAIL"
        ok &= diff <= MAX_ABS_DIFF
        print(f"{label} embeddings {a.shape}: max abs diff {diff:.2e} ({verdict}, limit {MAX_ABS_DIFF})")

    # 3. Sanity: the coffee caption must be closest to the coffee image (ONNX outputs).
    sims = ort_txt @ ort_img.T
    names = list(images)
    print("cosine text x image (ONNX):")
    print("  " + " " * 30 + "".join(f"{n:>10}" for n in names))
    for text, row in zip(TEST_TEXTS, sims):
        print(f"  {text:<30}" + "".join(f"{v:>10.4f}" for v in row))
    coffee = sims[0]
    sane = coffee[names.index("coffee")] > max(coffee[names.index("bicycles")], coffee[names.index("lake")])
    ok &= bool(sane)
    print(f"sanity cos('a cup of coffee', coffee) > unrelated: {'ok' if sane else 'FAIL'}")

    # 4. CPU latency, batch 1, default ONNX Runtime threads.
    img_ms = mean_latency_ms(img_sess, {"pixel_values": pixels[:1].numpy()})
    txt_ms = mean_latency_ms(txt_sess, {"input_ids": ids[:1].numpy()})
    print(f"ONNX Runtime CPU latency (batch 1, mean of 20): image {img_ms:.1f} ms, text {txt_ms:.1f} ms")
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="after export, compare ONNX Runtime with PyTorch")
    args = parser.parse_args()

    import torch

    ensure_upstream()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    model = load_model()
    st, tok = build_tokenizer(model.context_length)
    tok.save(str(OUT_DIR / "tokenizer.json"))

    image_tower, text_tower = towers(model)
    start = time.perf_counter()
    with torch.no_grad():
        export_onnx(image_tower, torch.randn(2, 3, model.image_size, model.image_size), "pixel_values",
                    OUT_DIR / "image.onnx")
        export_onnx(text_tower, torch.tensor([e.ids for e in tok.encode_batch(TEST_TEXTS[:2])]), "input_ids",
                    OUT_DIR / "text.onnx")
    print(f"export time: {time.perf_counter() - start:.1f} s")
    write_meta(model, st)
    for path in sorted(OUT_DIR.iterdir()):
        print(f"{path.relative_to(ML_DIR.parent)}: {path.stat().st_size / 1e6:.1f} MB")

    if args.check and not check(st):
        sys.exit(1)


if __name__ == "__main__":
    main()
