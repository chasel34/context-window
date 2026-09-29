"""Shared paths / cache setup for the Context Window analysis scripts
(adapted from source-repo/analysis/common.py).

Import FIRST so model downloads land in analysis/.cache/.
Time reference = the original WAV (48 kHz). Demucs was run on the WAV, so the
stems need no encoder-delay offset (the reference repo needed -23 ms for mp3).
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
CACHE = ROOT / ".cache"
for var, sub in [("TORCH_HOME", "torch"), ("HF_HOME", "hf"), ("HF_HUB_CACHE", "hf/hub"),
                 ("XDG_CACHE_HOME", "xdg"), ("HUGGINGFACE_HUB_CACHE", "hf/hub"),
                 ("MPLCONFIGDIR", "mpl"), ("NUMBA_CACHE_DIR", "numba")]:
    os.environ.setdefault(var, str(CACHE / sub))
    (CACHE / sub).mkdir(parents=True, exist_ok=True)

AUDIO = PROJECT / "song" / "Context Window.wav"
STEMS = PROJECT / "song" / "stems" / "htdemucs_ft" / "context-window"
SUNO = PROJECT / "docs" / "SUNO.md"
DATA = PROJECT / "data"
QA = ROOT / "qa"
WORK = ROOT / "work"
for d in (QA, WORK, DATA):
    d.mkdir(exist_ok=True)

STEM_OFFSET_SAMPLES = 0
STEM_OFFSET_SEC = 0.0


def load_lyrics():
    """SUNO.md '## Lyrics' -> list of dict(section, text). [Tags] and
    (parenthetical cues) stripped; repeated section names numbered by caller."""
    md = SUNO.read_text(encoding="utf-8")
    body = md.split("## Lyrics", 1)[1].split("```")[1]
    out, sec = [], None
    for raw in body.splitlines():
        s = raw.strip()
        m = re.fullmatch(r"\[(.+)\]", s)
        if m:
            sec = m.group(1)
            continue
        cues = [c.strip(" !") for c in re.findall(r"\(([^)]*)\)", s)]
        s = re.sub(r"\([^)]*\)", "", s).strip()
        s = s.replace("“", "").replace("”", "").replace('"', "")
        s = re.sub(r"\s+", " ", s)
        if s:
            out.append(dict(section=sec, text=s, cues=cues))
    return out


def load_stem(name, sr=None, mono=True):
    import soundfile as sf
    import numpy as np
    y, s = sf.read(STEMS / f"{name}.wav", dtype="float32", always_2d=True)
    y = y.mean(axis=1) if mono else y.T
    if sr and sr != s:
        import soxr
        y = soxr.resample(y, s, sr) if mono else np.stack([soxr.resample(c, s, sr) for c in y])
        s = sr
    return y, s


def load_vocal_source(name, sr=None):
    if name in ("vocL", "vocR"):
        y, s = load_stem("vocals", sr=sr, mono=False)
        return y[0 if name == "vocL" else 1], s
    return load_stem("vocals", sr=sr)


def load_mix(sr=44100, mono=True):
    import librosa
    return librosa.load(str(AUDIO), sr=sr, mono=mono)
