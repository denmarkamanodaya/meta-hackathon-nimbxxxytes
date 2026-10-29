# ml/ — Perception Encoder export (offline only)

Rules: `/CLAUDE.md`. Facts about PE: `docs/meta-api.md` ("Perception Encoder"). Spike: Phase 0
task 0.4.

## Scope

- `export_pe.py`: load PE-Core-B16-224, export the image tower and the text tower to ONNX (opset 17),
  write `api/models/pe/image.onnx`, `api/models/pe/text.onnx` and `api/models/pe/meta.json`
  (embedding dim, image mean/std, input size, tokenizer info).
- Verify after export: cosine similarity of a few text/image pairs matches PyTorch within 1e-3.
- `requirements.txt` with exact pinned versions; run in a venv (`python -m venv .venv`).
- `NOTICE`: Apache-2.0 attribution for the PE weights.
- Output ONNX files are git-ignored; `make models` re-creates them.

Never runs at request time. If the ONNX route fails, the fallback sidecar (FastAPI) lives in
`ml/sidecar/` and is added to compose — decided by spike 0.4.

## Gates

`python -I export_pe.py --check` (re-exports and compares ONNX output against PyTorch within 1e-3).
This is a one-off parity check run after each export, not part of the fast suite.
