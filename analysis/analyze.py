"""Music analysis -> data/audio.json + data/sections.json (adapted from source-repo)

  * constant-tempo beat grid (tempo + phase fitted to drum / mix onsets, phase
    refined on kick attacks), downbeats (bar phase from snare-on-2&4 and the
    2-bar chord changes), sections on downbeats,
  * 100 fps normalized envelopes (mix rms / low / mid / high, stem rms),
  * kick / snare / hat onsets from the drums stem, vocal note onsets.

All times are in the gapless-mp3 timeline (Demucs stems are shifted by
common.STEM_OFFSET_SEC, see common.py).

Run:  uv run python analyze.py [--plots]
"""
import common
import json
import math
import sys

import numpy as np
import librosa
from scipy.ndimage import maximum_filter1d, median_filter, uniform_filter1d
from scipy.signal import butter, find_peaks, sosfiltfilt

SR = 44100
FPS = 100

# Sections: derived from the aligned lyric lines (data/lyrics.json 'section'
# key) and snapped to downbeats. Rule (as in the reference): a section starts on
# the downbeat of the bar in which its first lyric word starts, unless that word
# is a pickup less than 2 beats before the next downbeat, in which case the
# section starts at that next downbeat. 'Drop' has no lyrics: it runs from the
# end of Break to the start of Final Chorus.
SECTION_ORDER = ["Intro", "Verse 1", "Pre-Chorus", "Chorus", "Verse 2", "Pre-Chorus", "Chorus",
                 "Bridge", "Break", "Drop", "Final Chorus", "Outro"]


# ---------------------------------------------------------------------------
def band_sos(lo, hi, sr):
    if lo and hi:
        return butter(4, [lo, hi], btype="band", fs=sr, output="sos")
    if hi:
        return butter(4, hi, btype="low", fs=sr, output="sos")
    return butter(4, lo, btype="high", fs=sr, output="sos")


def frame_rms(x, sr, fps=FPS, win=2048):
    hop = sr / fps
    n = int(math.ceil(len(x) / sr * fps))
    pad = np.pad(x, (win // 2, win // 2 + int(hop) + 2))
    idx = (np.arange(n) * hop).astype(int)
    c = np.concatenate([[0.0], np.cumsum(pad.astype(np.float64) ** 2)])
    e = (c[idx + win] - c[idx]) / win
    return np.sqrt(np.maximum(e, 0))


def smooth_env(x, fps=FPS, attack=0.010, release=0.090):
    """One-pole follower: fast attack, slower release (visual friendly)."""
    aa = math.exp(-1 / (attack * fps))
    ar = math.exp(-1 / (release * fps))
    y = np.empty_like(x)
    s = 0.0
    for i, v in enumerate(x):
        a = aa if v > s else ar
        s = a * s + (1 - a) * v
        y[i] = s
    return y


def norm01(x, pct=99.0):
    ref = np.percentile(x, pct)
    return np.clip(x / (ref + 1e-12), 0, 1)


# ---------------------------------------------------------------------------
def fit_grid(drums, mix, sr, duration):
    """Constant-tempo grid: coarse tempo/phase search on spectral-flux onset
    envelopes, then phase refinement on kick attack times."""
    hop = 64
    fps = sr / hop
    od = librosa.onset.onset_strength(y=librosa.resample(drums, orig_sr=sr, target_sr=22050),
                                      sr=22050, hop_length=hop // 2, lag=1, max_size=1)
    om = librosa.onset.onset_strength(y=librosa.resample(mix, orig_sr=sr, target_sr=22050),
                                      sr=22050, hop_length=hop // 2, lag=1, max_size=1)
    o = od / (np.percentile(od, 99) + 1e-9) + om / (np.percentile(om, 99) + 1e-9)
    ofps = 22050 / (hop // 2)

    def score(P, off):
        ts = off + P * np.arange(int(duration / P) + 1)
        idx = np.round(ts * ofps).astype(int)
        idx = idx[(idx > 2) & (idx < len(o) - 2)]
        return np.maximum.reduce([o[idx - 1], o[idx], o[idx + 1]]).mean()

    best = (0, None, None)
    for bpm in np.arange(140.0, 160.0, 0.02):
        P = 60 / bpm
        for off in np.arange(0, P, 0.004):
            s = score(P, off)
            if s > best[0]:
                best = (s, bpm, off)
    _, bpm, off = best
    for b2 in np.arange(bpm - 0.02, bpm + 0.02, 0.001):  # fine
        P = 60 / b2
        for o2 in np.arange(off - 0.01, off + 0.01, 0.001):
            s = score(P, o2)
            if s > best[0]:
                best = (s, b2, o2)
    _, bpm, off = best
    P = 60 / bpm
    # refine phase on kick attacks (steepest rise of low-band log energy)
    kick_t, _ = band_onsets(drums, sr, None, 120, win=0.012, min_gap=0.2, rel_db=12)
    n = np.round((kick_t - off) / P)
    res = kick_t - (off + n * P)
    res = res[np.abs(res) < 0.06]
    off = off + float(np.median(res))
    # first beat >= 0
    off = off - P * math.floor(off / P)
    return bpm, P, off, res


def band_onsets(x, sr, lo, hi, win=0.010, hop_s=0.002, min_gap=0.08, rel_db=10.0,
                decay_win=None):
    """Onsets in a frequency band: steepest rise of the band's log-energy
    envelope; strength = peak dB rise.  Returns (times, rise_db[, decay_db])."""
    xb = sosfiltfilt(band_sos(lo, hi, sr), x)
    h = int(hop_s * sr)
    w = int(win * sr)
    e = np.convolve(xb.astype(np.float64) ** 2, np.ones(w) / w, mode="same")[::h]
    db = 10 * np.log10(e + 1e-10)
    fps = sr / h  # exact frame rate (h is an integer number of samples)
    d = np.diff(db, prepend=db[0])
    d = uniform_filter1d(d, 3)
    # rise over ~20 ms
    lag = int(0.02 * fps)
    rise = db - np.concatenate([np.full(lag, db[0]), db[:-lag]])
    floor = median_filter(db, int(1.0 * fps) | 1)
    pk, _ = find_peaks(rise, height=rel_db, distance=int(min_gap * fps))
    times, strength = [], []
    for p in pk:
        a = max(0, p - lag)
        # attack time: steepest slope within the rise window
        q = a + int(np.argmax(d[a:p + 1]))
        peak_db = db[p:p + int(0.03 * fps)].max()
        if peak_db < floor[p] + 3:
            continue
        times.append(q / fps)
        strength.append(peak_db)
    return np.array(times), np.array(strength)


def drum_onsets(d, sr, grid_P, grid_off):
    """Kick / snare / hat onsets from the drums stem."""
    # KICK: <120 Hz
    kt, kdb = band_onsets(d, sr, None, 120, win=0.012, min_gap=0.15, rel_db=12)
    # SNARE (and the clap-like snare of the quiet chorus): candidates are
    # 1.5-5 kHz attacks; a snare has a long noisy 0.5-5 kHz tail 40-120 ms after
    # the attack.  Keep candidates whose tail is within 8 dB of the loudest tail
    # in +-2.5 s and within 25 dB of the song-wide level (rejects stem bleed).
    # Kick-only beats / hats have tails 12-30 dB lower.
    st, sdb = band_onsets(d, sr, 1500, 5000, win=0.010, min_gap=0.15, rel_db=10)
    xb = sosfiltfilt(band_sos(500, 5000, sr), d)
    e = np.sqrt(np.convolve(xb.astype(np.float64) ** 2, np.ones(441) / 441, mode="same"))
    # (guard: onsets in the last 120 ms have an empty tail slice -> NaN, which
    # made every comparison False; fixed vs. the reference script)
    tail = np.array([20 * np.log10(e[int((t + 0.04) * sr):int((t + 0.12) * sr)].mean() + 1e-9)
                     if int((t + 0.12) * sr) <= len(e) else -200.0 for t in st])
    rel = np.array([tail[i] - tail[np.abs(st - st[i]) < 2.5].max() for i in range(len(st))])
    thr = np.percentile(tail, 95) - 25
    keep = (rel > -8) & (tail > thr)
    st, sdb, stail = st[keep], sdb[keep], tail[keep]
    # HAT: >7 kHz, short; drop those coinciding with snares (snare noise also
    # reaches 7k+)
    ht, hdb = band_onsets(d, sr, 7000, None, win=0.006, min_gap=0.06, rel_db=9)
    # (and those within 30 ms of a kick: the kick's beater click reaches 10 kHz)
    for other, gap in ((st, 0.04), (kt, 0.03)):
        if len(other) and len(ht):
            dist = np.min(np.abs(ht[:, None] - other[None, :]), axis=1)
            keep = dist > gap
            ht, hdb = ht[keep], hdb[keep]
    return (kt, kdb), (st, stail), (ht, hdb), thr


def strength01(db_vals, lo_pct=5, hi_pct=95):
    if len(db_vals) == 0:
        return db_vals
    lo, hi = np.percentile(db_vals, lo_pct), np.percentile(db_vals, hi_pct)
    return np.clip((db_vals - lo) / (hi - lo + 1e-9) * 0.8 + 0.2, 0, 1)


def vocal_onsets(v, sr):
    """Vocal note onsets: log-mel spectral flux peaks (5 ms hop) plus pitch
    jumps > 0.8 semitone while voiced, restricted to active vocal frames."""
    f = dict(np.load(common.WORK / "vocal_feats.npz"))
    hop = float(f["hop_s"])
    on = f["onset"]
    rms = f["rms_db"]
    loc = maximum_filter1d(rms, int(2.0 / hop))
    active = (rms > -45) & (rms > loc - 25)
    thr = uniform_filter1d(on, int(0.4 / hop)) * 1.5 + 0.15 * np.percentile(on, 99)
    pk, _ = find_peaks(on, height=0, distance=int(0.09 / hop))
    pk = [p for p in pk if on[p] > thr[p] and active[min(len(active) - 1, p + int(0.03 / hop))]]
    t_flux = np.array(pk) * hop
    s_flux = np.array([on[p] for p in pk])
    # pitch jumps (legato note changes that have little spectral flux)
    f0 = f["f0"]
    midi = librosa.hz_to_midi(np.where(f["voiced"] > 0, f0, np.nan))
    med = median_filter(np.nan_to_num(midi, nan=0), 9)
    jumps = []
    w = int(0.04 / hop)
    for i in range(w, len(med) - w):
        a, b = med[i - w], med[i + w]
        if a > 0 and b > 0 and abs(b - a) > 0.8 and active[i]:
            jumps.append(i)
    # collapse runs
    t_pitch, last = [], -1e9
    for i in jumps:
        if i - last > int(0.1 / hop):
            t_pitch.append(i * hop)
        last = i
    t_pitch = np.array(t_pitch)
    ts = list(zip(t_flux, s_flux / (np.percentile(s_flux, 95) + 1e-9)))
    for t in t_pitch:
        if len(t_flux) == 0 or np.min(np.abs(t_flux - t)) > 0.08:
            ts.append((t, 0.35))
    ts.sort()
    return [(float(t), float(min(1.0, max(0.1, s)))) for t, s in ts]


# ---------------------------------------------------------------------------
def main(plots=False):
    mix, _ = common.load_mix(SR)
    duration = len(mix) / SR
    stems = {n: common.load_stem(n, sr=SR)[0][: len(mix)] for n in ("vocals", "drums", "bass", "other")}
    for n in stems:
        if len(stems[n]) < len(mix):
            stems[n] = np.pad(stems[n], (0, len(mix) - len(stems[n])))

    bpm, P, off, kick_res = fit_grid(stems["drums"], mix, SR, duration)
    print(f"tempo {bpm:.3f} BPM  period {P:.5f}s  first beat {off:.4f}s  kick residual sd {kick_res.std()*1000:.1f} ms")
    beats = off + P * np.arange(int((duration - off) / P) + 1)
    # bar phase: beat index 0 is a downbeat (see NOTES / qa/drums_pattern.png)
    phase = bar_phase(stems["drums"], stems["bass"], beats)
    downbeats = beats[phase::4]
    first_db = float(downbeats[0])
    if first_db - 4 * P > -P / 2:
        first_db -= 4 * P  # allow a (partial) bar before the first full downbeat
    bar_t = lambda k: float(first_db + 4 * P * k)

    # envelopes -------------------------------------------------------------
    n = int(math.ceil(duration * FPS))
    env = {}
    env["rms"] = frame_rms(mix, SR)[:n]
    for name, (lo, hi) in {"low": (None, 150), "mid": (150, 2000), "high": (4000, None)}.items():
        env[name] = frame_rms(sosfiltfilt(band_sos(lo, hi, SR), mix), SR)[:n]
    for s in ("vocal", "drums", "bass", "other"):
        env[s] = frame_rms(stems["vocals" if s == "vocal" else s], SR)[:n]
    for k in env:
        e = smooth_env(env[k])
        env[k] = [round(float(x), 3) for x in norm01(e)]
        assert len(env[k]) == n

    # onsets -------------------------------------------------------------------
    (kt, kdb), (st, sdb), (ht, hdb), sn_thr = drum_onsets(stems["drums"], SR, P, off)
    onsets = {
        "kick": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(kt, strength01(kdb))],
        "snare": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(st, strength01(sdb))],
        "hat": [[round(float(t), 3), round(float(s), 3)] for t, s in zip(ht, strength01(hdb))],
        "vocal": [[round(t, 3), round(s, 3)] for t, s in vocal_onsets(stems["vocals"], SR)],
    }
    # snare / kick position statistics -> bar phase evidence
    def pos_hist(ts):
        ph = np.round((np.asarray(ts) - off) / (P / 2)).astype(int) % 8
        return np.bincount(ph, minlength=8).tolist()
    print("kick   8th-positions in bar:", pos_hist(kt))
    print("snare  8th-positions in bar:", pos_hist(st))
    print("hat    8th-positions in bar:", pos_hist(ht))

    # sections -------------------------------------------------------------------
    sections, display = lyric_sections(downbeats, P, duration)
    doc = dict(
        duration=round(duration, 3),
        bpm=round(bpm, 3),
        beat_period=round(P, 5),
        time_signature=4,
        beats=[round(float(t), 3) for t in beats],
        downbeats=[round(float(t), 3) for t in downbeats],
        sections=sections,
        fps=FPS,
        **env,
        onsets=onsets,
        notes=NOTES.format(bpm=bpm, off=off, P=P, first_db=float(downbeats[0]), phase=phase,
                           sn=len(st), kk=len(kt), hh=len(ht)),
    )
    (common.DATA / "sections.json").write_text(json.dumps(dict(
        bpm=round(bpm, 3), beat_period=round(P, 5), sections=display,
        notes="start/end in seconds on the downbeat grid of data/audio.json; bars = downbeat indices [start, end). "
              "Rule: section starts at the downbeat of the bar containing its first sung word, unless that word is a "
              "<2-beat pickup (then next downbeat). Drop = end of Break .. start of Final Chorus (no lyrics)."),
        indent=2))
    (common.DATA / "audio.json").write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", common.DATA / "audio.json", f"{len(beats)} beats, {len(downbeats)} downbeats, "
          f"{len(kt)} kicks, {len(st)} snares, {len(ht)} hats, {len(onsets['vocal'])} vocal onsets")
    if plots:
        make_plots(doc, stems)
    return doc


def bar_phase(drums, bass, beats):
    """Which of the 4 beat phases is the downbeat: kick + bass-note energy is
    highest on beat 1 and snare/clap sits on 2 & 4; pick the phase maximising
    (energy on phase) - (energy on phase+1, phase+3) using low-band RMS of
    drums+bass sampled at the beats, plus a bonus for section-length changes."""
    lo = sosfiltfilt(band_sos(None, 150, SR), drums + bass)
    e = np.array([np.sqrt(np.mean(lo[int(t * SR): int((t + 0.08) * SR)] ** 2) + 1e-12) for t in beats])
    ch = np.abs(np.diff(np.log(e + 1e-6), prepend=np.log(e[0] + 1e-6)))  # novelty at beats
    score = []
    for p in range(4):
        idx = np.arange(p, len(beats), 4)
        score.append(e[idx].mean() + 0.5 * ch[idx].mean())
    print("bar-phase scores", np.round(score, 4))
    return int(np.argmax(score))


def lyric_sections(downbeats, P, duration):
    lyr = json.loads((common.DATA / "lyrics.json").read_text())["lines"]
    groups = []
    for l in lyr:
        if groups and groups[-1]["section"] == l["section"]:
            groups[-1]["end_word"] = l["end"]
        else:
            groups.append(dict(section=l["section"], first_word=l["start"], end_word=l["end"]))
    # insert Drop (no lyrics) before Final Chorus
    k = [g["section"] for g in groups].index("Final Chorus")
    groups.insert(k, dict(section="Drop", first_word=groups[k - 1]["end_word"] + 0.3,
                          end_word=groups[k]["first_word"]))
    assert [g["section"] for g in groups] == SECTION_ORDER, [g["section"] for g in groups]
    db = np.asarray(downbeats)

    def snap(t):
        i = int(np.searchsorted(db, t, side="right") - 1)
        i = max(i, 0)
        if i + 1 < len(db) and db[i + 1] - t < 2 * P:
            i += 1
        return i
    starts = [0] + [snap(g["first_word"]) for g in groups[1:]]
    counts, out, disp = {}, [], []
    for j, g in enumerate(groups):
        name = g["section"]
        counts[name] = counts.get(name, 0) + 1
        a = 0.0 if j == 0 else float(db[starts[j]])
        b = duration if j == len(groups) - 1 else float(db[starts[j + 1]])
        key = name.lower().replace(" ", "").replace("-", "")
        key = {"prechorus": "pre", "finalchorus": "chorus_final"}.get(key, key)
        if SECTION_ORDER.count(name) > 1:
            key += str(counts[name])
        out.append(dict(name=key, start=round(a, 3), end=round(b, 3)))
        disp.append(dict(name=name if SECTION_ORDER.count(name) == 1 else f"{name} {counts[name]}",
                         key=key, start=round(a, 3), end=round(b, 3),
                         bars=[None if j == 0 else starts[j], None if j == len(groups) - 1 else starts[j + 1]],
                         first_word=round(g["first_word"], 3), last_word=round(g["end_word"], 3)))
    return out, disp


NOTES = (
    "Timeline = original WAV 'song/Context Window.wav' (identical to the gapless decode of "
    "song/context-window.mp3 up to the encoder delay handled by browsers); Demucs htdemucs_ft stems "
    "from the WAV, no offset. Tempo is constant: {bpm:.3f} BPM (period {P:.5f} s), fitted over the whole "
    "song on drum+mix onset envelopes, phase refined on kick attack times; first beat {off:.3f} s. "
    "Bar phase {phase} chosen by low-band (kick+bass) energy on beats; first downbeat {first_db:.3f} s. "
    "Sections: see data/sections.json (from lyric alignment, snapped to downbeats). "
    "Envelopes: 100 fps, 46 ms RMS window, one-pole smoothing (10 ms attack / 90 ms release), "
    "normalised by 99th percentile, 0..1. low <150 Hz, mid 150-2000 Hz, high >4 kHz of the mix; "
    "vocal/drums/bass/other = stem RMS. Onsets [time, strength]: kick ({kk}), snare/clap ({sn}), "
    "hat ({hh}) from the drums stem; vocal = note onsets from the vocal stem."
)


def make_plots(doc, stems):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    wins = [(0, 12), (14, 26), (28, 36), (56, 64), (86, 98), (106, 114), (136, 146), (148, 156.6)]
    t = np.arange(len(doc["rms"])) / FPS
    for (t0, t1) in wins:
        fig, ax = plt.subplots(3, 1, figsize=(22, 11), sharex=True,
                               gridspec_kw=dict(height_ratios=[2, 1.6, 1.4]))
        d = stems["drums"][int(t0 * SR):int(t1 * SR)]
        S = librosa.amplitude_to_db(np.abs(librosa.stft(d, n_fft=1024, hop_length=128)), ref=np.max)
        ax[0].imshow(S, origin="lower", aspect="auto", cmap="magma", vmin=-60, vmax=0,
                     extent=[t0, t0 + S.shape[1] * 128 / SR, 0, SR / 2])
        ax[0].set_ylim(0, 12000)
        ax[0].set_ylabel("drums stem")
        m = (t >= t0) & (t <= t1)
        for k, c in [("rms", "k"), ("low", "tab:red"), ("mid", "tab:green"), ("high", "tab:blue")]:
            ax[1].plot(t[m], np.array(doc[k])[m], color=c, lw=1, label=k)
        ax[1].legend(loc="upper left", fontsize=8)
        for k, c in [("vocal", "tab:purple"), ("drums", "tab:orange"), ("bass", "tab:brown"), ("other", "tab:olive")]:
            ax[2].plot(t[m], np.array(doc[k])[m], color=c, lw=1, label=k)
        ax[2].legend(loc="upper left", fontsize=8)
        for b in doc["beats"]:
            if t0 <= b <= t1:
                for a_ in ax:
                    a_.axvline(b, color="gray", lw=0.6, alpha=0.6)
        for b in doc["downbeats"]:
            if t0 <= b <= t1:
                for a_ in ax:
                    a_.axvline(b, color="c" if a_ is ax[0] else "k", lw=1.8)
        for name, y, c in [("kick", 1500, "tab:red"), ("snare", 5000, "w"), ("hat", 9500, "yellow")]:
            for (ot, s) in doc["onsets"][name]:
                if t0 <= ot <= t1:
                    ax[0].plot([ot], [y], marker="v", color=c, ms=4 + 8 * s)
        for (ot, s) in doc["onsets"]["vocal"]:
            if t0 <= ot <= t1:
                ax[2].plot([ot], [1.02], marker="v", color="tab:purple", ms=3 + 6 * s)
        for s in doc["sections"]:
            if t0 <= s["start"] <= t1:
                ax[1].text(s["start"], 1.02, s["name"], fontsize=14, color="tab:red")
                for a_ in ax:
                    a_.axvline(s["start"], color="tab:red", lw=2.5)
        ax[2].set_xlim(t0, t1)
        ax[2].set_xticks(np.arange(np.ceil(t0), t1, 0.5))
        fig.tight_layout()
        fig.savefig(common.QA / f"audio_{int(t0):03d}.png", dpi=65)
        plt.close(fig)
    # overview
    fig, ax = plt.subplots(2, 1, figsize=(24, 7), sharex=True)
    for k, c in [("rms", "k"), ("low", "tab:red"), ("high", "tab:blue")]:
        ax[0].plot(t, doc[k], color=c, lw=0.6, label=k)
    for k, c in [("vocal", "tab:purple"), ("drums", "tab:orange"), ("bass", "tab:brown"), ("other", "tab:olive")]:
        ax[1].plot(t, doc[k], color=c, lw=0.6, label=k)
    for s in doc["sections"]:
        for a_ in ax:
            a_.axvline(s["start"], color="tab:red", lw=1.5)
        ax[0].text(s["start"] + 0.2, 1.03, s["name"], fontsize=10, color="tab:red")
    for a_ in ax:
        a_.legend(loc="upper right", fontsize=8)
    ax[1].set_xticks(np.arange(0, 157, 5))
    fig.tight_layout()
    fig.savefig(common.QA / "audio_overview.png", dpi=65)
    plt.close(fig)


if __name__ == "__main__":
    main(plots="--plots" in sys.argv)
