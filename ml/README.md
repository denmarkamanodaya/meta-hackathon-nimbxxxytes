# ml/ — Perception Encoder export

Offline tooling. Converts Meta's Perception Encoder **PE-Core-B16-224** (Apache-2.0) into ONNX files
that the Rust API runs on CPU with ONNX Runtime. Nothing here runs at request time.

## Run

```bash
cd ml
uv venv --python 3.13 .venv            # or: python3.13 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/python -I export_pe.py --check                        # text tower fp32
.venv/bin/python -I export_pe.py --text-precision int8 --check   # text tower int8 weights
```

The script downloads the upstream code (pinned commit) and the weights (pinned revision, about
1.7 GB) into `ml/vendor/` (git-ignored), then writes `api/models/pe/` (git-ignored):

| File | Contents |
| --- | --- |
| `image.onnx` | `pixel_values` f32 `[N,3,224,224]` → `embeddings` f32 `[N,1024]`, L2-normalised (~377 MB) |
| `text.onnx` | `input_ids` i64 `[N,32]` → `embeddings` f32 `[N,1024]`, L2-normalised (~1.4 GB fp32, ~360 MB int8) |
| `tokenizer.json` | CLIP BPE tokenizer for the Rust `tokenizers` crate; truncation to 32 and zero padding built in |
| `meta.json` | preprocessing (squash resize, bilinear, mean/std 0.5), ids, opset, versions |

`--check` then verifies:

- `tokenizer.json` produces the same ids as the upstream Python tokenizer on a fixed set of strings;
- ONNX Runtime and PyTorch embeddings differ by at most 1e-3 (image tower, and the text tower when
  fp32);
- for 20 captions over 11 photos, the best-matching photo per caption is the same as with PyTorch
  fp32, and no caption-photo cosine moves by more than 0.02 (this is the gate for int8);
- the caption "a cup of coffee" scores higher against a coffee photo than against unrelated photos.

## Using the outputs from Rust

- Text: `Tokenizer::from_file("tokenizer.json")?.encode(text, true)?.get_ids()` gives exactly 32
  ids; cast to `i64` and feed `input_ids`. Keep pad id 0: the text tower pools at the highest id
  (the end-of-text token).
- Image: decode, convert to RGB, resize to 224×224 without cropping (bilinear), scale to `[0,1]`,
  then `(x - 0.5) / 0.5`, NCHW.
- Both outputs are unit vectors, so cosine similarity is a dot product.

Licences: see `NOTICE`.
