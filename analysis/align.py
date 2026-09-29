"""Word-level lyric alignment -> data/lyrics.json  (adapted from source-repo)

Pipeline (simplified vs. the reference: no karaoke lead stem, no manual FIX
pass yet):
  1. ctc_emissions.py : CTC log-probs (MMS_FA + wav2vec2 LV60K) of the Demucs
                        vocal stem, mono / left / right.
  2. whisper_run.py   : mlx-whisper large-v3-turbo word timestamps (cross-check).
  3. vocal_feats.py   : vocal RMS / onset features (5 ms hop).
  4. this script      : one global constrained Viterbi pass ('fused6') with a
                        garbage star token between lines (absorbs ad-libs, the
                        '(window!)' backing calls, extra repeats), light
                        end-trimming on vocal energy, confidence from agreement
                        with single-model alignments, QA flags.
Run: uv run python align.py
"""
import common
import json
import re
from difflib import SequenceMatcher

import numpy as np

from ctcalign import FRAME, align, emissions
from pron import tokens

ALTS = ("mms", "lv60k", "fused_vocL", "fused_vocR")
MIN_DUR = 0.06
# Per-line time windows (s) where the automatic path is wrong: the stutter
# "C-C-" of chorus 2 and the final chorus got stretched back over the
# pre-chorus tail / the instrumental drop. Windows set from whisper + QA plots.
LINE_WINDOWS = {24: (60.6, 63.6), 39: (113.8, 116.5)}


def load_feats():
    f = dict(np.load(common.WORK / "vocal_feats.npz"))
    return f


def trim_end(start, end, f):
    """End = where vocal RMS drops 15 dB below the word's peak (held notes keep length)."""
    hop = float(f["hop_s"]); r = f["rms_db"]
    a, b = int(start / hop), max(int(start / hop) + 1, int(end / hop))
    seg = r[a:b]
    if len(seg) < 4:
        return end
    pk = int(np.argmax(seg)); thr = seg[pk] - 15
    below = np.where(seg[pk:] < thr)[0]
    return end if len(below) == 0 else a * hop + (pk + below[0]) * hop


def norm(t):
    return re.sub(r"[^a-z0-9]", "", t.lower())


def whisper_words():
    W = json.loads((common.WORK / "whisper_turbo_prompt.json").read_text())
    return [dict(w=norm(w["word"]), start=w["start"], end=w["end"])
            for s in W["segments"] for w in s.get("words", [])]


def main():
    lyr = common.load_lyrics()
    # sung in-line cues such as '(window!)' are aligned as extra tokens after
    # the line (so they don't get swallowed by the next word) and reported in
    # 'extras', not in the line's words.
    SUNG_CUES = {"window"}
    L = [tokens(l["text"]) + [c for c in l["cues"] if c in SUNG_CUES] for l in lyr]
    ncore = [len(tokens(l["text"])) for l in lyr]
    E = emissions("fused6")
    spans, score, _, _ = align(E, L, line_windows=LINE_WINDOWS)
    alt = {k: align(emissions(k), L, line_windows=LINE_WINDOWS)[0] for k in ALTS}
    f = load_feats()
    ww = whisper_words()

    flat = []
    for li, toks in enumerate(L):
        for ti, tok in enumerate(toks):
            sp = spans[(li, ti)]
            s, e = sp[0][0], sp[-1][1]
            p = float(np.mean([x[2] for x in sp]))
            agree = np.mean([abs(alt[k][(li, ti)][0][0] - s) < 0.12 for k in ALTS])
            # whisper support: a whisper word with similar spelling within 0.5 s
            wsup = any(abs(w["start"] - s) < 0.5 and SequenceMatcher(None, w["w"], norm(tok)).ratio() > 0.6
                       for w in ww)
            conf = round(float(0.35 + 0.35 * agree + 0.15 * min(1, p * 2) + 0.15 * wsup), 2)
            flat.append(dict(li=li, ti=ti, w=tok, start=s, end=e, conf=conf, p=p, whisper=wsup))
    # refine ends, enforce monotonic / min length
    for k, w in enumerate(flat):
        nxt = flat[k + 1]["start"] if k + 1 < len(flat) else w["end"] + 1
        w["end"] = min(max(trim_end(w["start"], w["end"], f), w["start"] + MIN_DUR), nxt)
        if k and w["start"] < flat[k - 1]["end"]:
            w["start"] = flat[k - 1]["end"]
        if w["end"] - w["start"] < MIN_DUR:
            w["end"] = w["start"] + MIN_DUR
    flags = []
    cues = [w for w in flat if w["ti"] >= ncore[w["li"]]]
    flat = [w for w in flat if w["ti"] < ncore[w["li"]]]
    for w in flat:
        if w["conf"] < 0.6:
            flags.append(dict(line=w["li"], w=w["w"], start=round(w["start"], 3), conf=w["conf"],
                              reason="low confidence: possibly skipped/garbled by singer"))

    lines = []
    for li, l in enumerate(lyr):
        ws = [dict(w=x["w"], start=round(x["start"], 3), end=round(x["end"], 3), conf=x["conf"])
              for x in flat if x["li"] == li]
        lines.append(dict(i=li, section=l["section"], text=l["text"], start=ws[0]["start"],
                          end=ws[-1]["end"], words=ws))
    extras = [dict(start=round(w["start"], 3), end=round(w["end"], 3), desc=f"sung cue '({w['w']}!)' after line {w['li']} (conf {w['conf']})")
              for w in cues]
    extras += detect_extras(lines, f)
    extras.sort(key=lambda e: e["start"])
    # sanity checks
    allw = [w for l in lines for w in l["words"]]
    assert all(w["end"] > w["start"] for w in allw), "zero-length word"
    assert all(b["start"] >= a["end"] - 1e-6 for a, b in zip(allw, allw[1:])), "non-monotonic"
    doc = dict(lines=lines, extras=extras, flags=flags, deviations=DEVIATIONS, notes=NOTES)
    (common.DATA / "lyrics.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False))
    print("wrote lyrics.json; score", score, "flags", len(flags), "extras", len(extras))


def detect_extras(lines, f):
    """Vocal activity (>1 s) outside any aligned line = ad-libs / added repeats."""
    hop = float(f["hop_s"]); r = f["rms_db"]
    act = r > (np.percentile(r, 95) - 22)
    cov = np.zeros_like(act)
    for l in lines:
        cov[int(l["start"] / hop): int(l["end"] / hop) + 1] = True
    m = act & ~cov
    out, k = [], 0
    from scipy.ndimage import binary_closing
    m = binary_closing(m, np.ones(int(0.3 / hop)))
    idx = np.flatnonzero(np.diff(np.r_[0, m.astype(int), 0]))
    for a, b in zip(idx[::2], idx[1::2]):
        if (b - a) * hop > 1.0:
            out.append(dict(start=round(a * hop, 2), end=round(b * hop, 2),
                            desc="unlisted vocal (ad-lib / backing call / added repeat)"))
    return out


# Differences between SUNO.md lyrics and the sung take, from the mlx-whisper
# transcript (work/whisper_turbo_prompt.json) and listening to the vocal stem.
DEVIATIONS = [
    dict(where="every chorus", kind="cue sung", desc="the '(window!)' cue is sung (whisper: 'Context window'); aligned as a hidden token, listed in extras, not in line words"),
    dict(where="Pre-Chorus 1 ~26.6-30.0", kind="added", desc="'scroll' sung more than 8 times (whisper hears ~13); extra repeats absorbed, the 8 lyric tokens are spread over the run"),
    dict(where="Pre-Chorus 1 ~31-32.7", kind="changed", desc="'long long long' sounds like 'on, on, on'"),
    dict(where="after Chorus 1 ~47.2-48.4", kind="added", desc="extra 'C-C-Context window' repeat not in lyrics (see extras)"),
    dict(where="Chorus 1 L10 / Chorus 2 L24", kind="changed", desc="stutter sung 'C-C-C-Context' (three C's)"),
    dict(where="Chorus 2 L25 ~63.0-64.6", kind="garbled", desc="'Closing in' slurred (whisper: 'we went out of clothes'); 'Closing' conf 0.40"),
    dict(where="Break L36 ~88-93", kind="garbled", desc="'Overflow' sung as 'Overfly', long gap before second one; second 'Overflow!' timing uncertain"),
    dict(where="Final Chorus L41", kind="changed", desc="second 'C-C-Context' merged into 'Context token token token token token' (whisper hears 5 x token)"),
    dict(where="Final Chorus L46-47", kind="changed", desc="'Where did we' sung 'Where do we'"),
    dict(where="Outro ~142.9", kind="added", desc="unlisted vocal tail (whisper: 'Thank you.', likely hallucination on reverb)"),
]

NOTES = ("Timeline = original WAV 'song/Context Window.wav' (= song/context-window.mp3 gapless decode); "
         "Demucs htdemucs_ft stems from the WAV, no offset. Method: CTC emissions (20 ms) from torchaudio "
         "MMS_FA and wav2vec2 LV60K-960h on the vocal stem mono/L/R, fused; one global constrained Viterbi "
         "with garbage star token between lines; ends trimmed where vocal drops 15 dB below word peak; "
         "conf = 0.35 + 0.35*model agreement + 0.15*CTC prob + 0.15*whisper (mlx-whisper large-v3-turbo) support. "
         "Lyric source: docs/SUNO.md with [tags] and (cues) stripped; stutters split into tokens "
         "(C- C- Context!). Line windows constrain chorus-2 and final-chorus openings (LINE_WINDOWS). 'section' key added per line; 'flags' lists "
         "low-confidence words.")

if __name__ == "__main__":
    main()
