"""Exports Meta's MMS-TTS English voice (facebook/mms-tts-eng, VITS) to ONNX for nimbytes.

Offline only, like export_pe.py. Writes ml/out/mms-tts-eng/{model.onnx, tokenizer files, meta.json}
and a sample WAV from both PyTorch and ONNX Runtime, printing the time each took.

Usage: .venv/bin/python export_mms_tts.py ["sentence to speak"]
"""

import json
import sys
import time
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers import AutoTokenizer, VitsModel

MODEL_ID = "facebook/mms-tts-eng"
OUT = Path(__file__).parent / "out" / "mms-tts-eng"
SAMPLE = "Turn the dial to Quick Wash, then press the Start button."


class Wrapper(torch.nn.Module):
    """input_ids -> waveform, with the noise fixed so the export is deterministic."""

    def __init__(self, model: VitsModel):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids).waveform


def write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def main() -> None:
    text = sys.argv[1] if len(sys.argv) > 1 else SAMPLE
    OUT.mkdir(parents=True, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    model = VitsModel.from_pretrained(MODEL_ID).eval()
    model.noise_scale = 0.0
    model.noise_scale_duration = 0.0
    rate = model.config.sampling_rate
    ids = tok(text, return_tensors="pt").input_ids

    t0 = time.perf_counter()
    with torch.no_grad():
        wav = model(input_ids=ids).waveform[0].numpy()
    print(f"torch: {time.perf_counter() - t0:.2f}s for {len(wav) / rate:.1f}s of audio")
    write_wav(OUT / "sample_torch.wav", wav, rate)

    onnx_path = OUT / "model.onnx"
    torch.onnx.export(
        Wrapper(model),
        (ids,),
        str(onnx_path),
        input_names=["input_ids"],
        output_names=["waveform"],
        dynamic_axes={"input_ids": {1: "tokens"}, "waveform": {1: "samples"}},
        opset_version=17,
        dynamo=False,
    )
    tok.save_pretrained(OUT)
    (OUT / "meta.json").write_text(json.dumps({"model": MODEL_ID, "sampling_rate": rate}))

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    t0 = time.perf_counter()
    out = sess.run(None, {"input_ids": ids.numpy()})[0][0]
    print(f"onnx: {time.perf_counter() - t0:.2f}s for {len(out) / rate:.1f}s of audio")
    write_wav(OUT / "sample_onnx.wav", out, rate)
    print(f"size: {onnx_path.stat().st_size / 1e6:.0f} MB -> {OUT}")


if __name__ == "__main__":
    main()
