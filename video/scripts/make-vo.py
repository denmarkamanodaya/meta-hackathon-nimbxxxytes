"""Speaks every line of src/vo-lines.json in a British female voice (Kokoro-82M, voice bf_emma,
run locally through mlx-audio; lines marked "voice": "device" use the Mac's own voice, as the app does) into public/audio/vo/<id>.wav, and writes each line's length to
src/vo.generated.json. Only lines whose text changed are spoken again.

Usage: python3 scripts/make-vo.py [--all] [--lines src/demo/vo-lines.json --generated src/demo/vo.generated.json --out public/audio/demo-vo] [--speed 1.25]
(the three paths default to the promo's: src/vo-lines.json, src/vo.generated.json, public/audio/vo;
the speed defaults to the promo's 1.12)
Needs mlx-audio 0.5.8 (pip install mlx-audio==0.5.8 "misaki[en]"); set MLX_AUDIO_TTS to its
mlx_audio.tts.generate if it is not on PATH. Lines marked "device" use macOS `say`."""

import hashlib
import os
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TTS_BIN = os.environ.get("MLX_AUDIO_TTS", "mlx_audio.tts.generate")  # mlx-audio 0.5.8 CLI, on PATH or set by env
MODEL = "mlx-community/Kokoro-82M-bf16"
VOICE = "bf_emma"  # British English, female
LANG = "b"

def arg(flag: str, default: str) -> str:
    """The value after `flag` on the command line, or `default`."""
    return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default


lines = json.loads((ROOT / arg("--lines", "src/vo-lines.json")).read_text())
out_dir = ROOT / arg("--out", "public/audio/vo")
out_dir.mkdir(parents=True, exist_ok=True)
work = ROOT / "work/vo-tmp"
work.mkdir(parents=True, exist_ok=True)
generated_path = ROOT / arg("--generated", "src/vo.generated.json")
SPEED = arg("--speed", "1.12")
previous = json.loads(generated_path.read_text()) if generated_path.exists() else {}
force = "--all" in sys.argv

result = {}
for line in lines:
    key = hashlib.sha1(f"{line.get('voice', VOICE)}|{SPEED}|loudnorm|{line['text']}".encode()).hexdigest()[:12]
    wav = out_dir / f"{line['id']}.wav"
    old = previous.get(line["id"], {})
    if force or old.get("key") != key or not wav.exists():
        for f in work.glob("*"):
            f.unlink()
        if line.get("voice") == "device":
            # The app reads aloud in the Mac's own voice (Web Speech), so its lines use `say`.
            subprocess.run(["say", "-o", str(work / "line.aiff"), line["text"]], check=True)
            made = [work / "line.aiff"]
        else:
          subprocess.run(
            [TTS_BIN, "--model", MODEL, "--voice", VOICE, "--lang_code", LANG, "--speed", SPEED,
             "--text", line["text"], "--output_path", str(work), "--file_prefix", "line", "--join_audio"],
            check=True, capture_output=True,
          )
          made = sorted(work.glob("*.wav"))
        # Trim leading and trailing silence so the timeline holds only speech, and even out loudness.
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(made[-1]), "-af",
             "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
             "loudnorm=I=-16:TP=-1.5:LRA=11",
             "-ar", "48000", "-ac", "1", str(wav)],
            check=True,
        )
        print(f"spoke {line['id']}")
    seconds = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)],
        check=True, capture_output=True, text=True).stdout.strip())
    result[line["id"]] = {"key": key, "seconds": round(seconds, 3)}

generated_path.write_text(json.dumps(result, indent=2) + "\n")
print(f"total speech {sum(v['seconds'] for v in result.values()):.1f} s over {len(result)} lines")
