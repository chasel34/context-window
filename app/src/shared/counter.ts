// The token counter (BEATSHEET: top right, IBM Plex Mono). Its value is a pure function of song time,
// anchored to sung words, and it never goes down until the NaN → 0 reset:
//   0 → 200,000 → 1,000,000 → OVERFLOW → ∞ → NaN → 0.
//
//   0.0 – first word      0
//   Intro                 +tokens for each sung word of the system prompt (tens)
//   Verse 1               steps on every sung word, up to 4,096 at the pre-chorus
//   Pre-Chorus 1 (scroll) rolls continuously, accelerating, to 48,000
//   Chorus 1              steps on words; the four "token"s jump; rolls from "Two" and lands on 200,000 on "K"
//   → Chorus 2            creeps up on every word, 640,000 at Chorus 2
//   Chorus 2              "Two hundred K, a million more": rolls from "K" and lands on 1,000,000 on "million"
//   Bridge                creeps to exactly 1,048,575 (2^20 − 1) by the first "Overflow!" (≈87.9; s11 hides the
//                         counter and flashes counterText '1,048,575' there)
//   Break (s12)           ticks to 1,048,576 (2^20, the limit) on the cut and holds for a bar; then runs past
//                         the limit, accelerating, to 99,999,999 on the second "Overflow!"; then the digits
//                         run past the frame (mode 'overflow', ×10 per beat); on "O-O-O-Overflow!" → OVERFLOW
//   Drop, Final Chorus    OVERFLOW; "a million more" (final chorus) → ∞; "Where did we begin?" → NaN
//   s16 start (the cut on "New chat!", a 16th before the outro downbeat)   0
//
// (BEATSHEET's "999,999 at the Break" would step backwards after 1,000,000 in Chorus 2: the Break opens
// on 1,048,576 instead.) Change the anchors in TokenCounter.constructor; everything else follows.
import type { Timeline } from '../timeline';
import type { Word } from '../engine/lyrics';
import { F, font } from '../engine/type';
import { rgba, mixRGBA } from '../engine/palette';
import { clamp, ease, frameIdx, hash, prog } from '../engine/util';

export type CounterMode = 'count' | 'overflow' | 'text';

/** The context limit: 2^20 (the "1M" window). */
export const LIMIT = 1_048_576;

export interface CounterState {
  /** Numeric value (Infinity for ∞, NaN for NaN). */
  value: number;
  /** Display text: '200,000', '∞', 'NaN', 'OVERFLOW'. */
  text: string;
  mode: CounterMode;
  /** Time of the last step (a word onset or an anchor), and a 0..1 pulse decaying from it. */
  stepT: number;
  bump: number;
}

/** '1234567' → '1,234,567' (deterministic, no locale). */
export function formatTokens(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return '∞';
  // no exponent notation for huge values (Number#toString switches to '1e+21' at 1e21)
  const s = v >= 1e21 ? BigInt(Math.floor(v)).toString() : Math.floor(Math.max(0, v)).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

interface Seg {
  t0: number;
  t1: number;
  v0: number;
  v1: number;
  /** 'words': steps on word onsets inside the segment; 'roll': continuous (eased); 'hold'. */
  kind: 'words' | 'roll' | 'hold';
  ease?: (x: number) => number;
}

export class TokenCounter {
  private segs: Seg[] = [];
  private words: Word[];
  private overflowT: number;
  private overflowTextT: number;
  private infT: number;
  private nanT: number;
  private zeroT: number;
  /** Value where the overflow run starts (just above the Break's roll). */
  private static OVERFLOW_V0 = 100_000_000;

  constructor(private tl: Timeline) {
    const L = tl.lyrics;
    this.words = L.words;
    const first = L.words[0]!.start;
    const sec = (k: string) => tl.sectionByKey(k).start;
    const verse1 = sec('verse1'), pre1 = sec('pre1'), chorus1 = sec('chorus1'), chorus2 = sec('chorus2');
    const bridge = sec('bridge'), brk = sec('break'), outro = sec('outro');
    const tokenLine1 = L.get('Token, token, token, TOKEN', 0);
    const two1 = L.get('Two hundred K', 0).words[0]!.start; // "Two"
    const k1 = L.get('Two hundred K', 0).words[2]!.start; // "K,"
    const kEnd1 = L.get('Two hundred K', 0).end + 0.3; // 200,000 holds through "a million more"
    const k2 = L.get('Two hundred K', 1).words[2]!.start; // "K," in Chorus 2
    const million2 = L.get('Two hundred K', 1).words[4]!.start; // "million" in Chorus 2
    const kEnd2 = L.get('Two hundred K', 1).end + 0.3;
    const ov1 = L.get('Overflow! Overflow!').words[0]!.start; // the first "Overflow!" (sung in s11's last beat)
    this.overflowT = L.get('Overflow! Overflow!').words[1]!.start; // the second "Overflow!"
    this.overflowTextT = L.get('O-O-O-Overflow!').words[3]!.start; // "Overflow!" after the O-O-O
    this.infT = L.get('Two hundred K', 2).words[4]!.start; // "million" in the final chorus
    this.nanT = L.get('Where did we begin?', 2).words[0]!.start;
    // reset on s16's cut (anchored in timeline.ts), not the outro downbeat: s16 opens before it
    this.zeroT = tl.scenes.find((e) => e.id === 's16')?.start ?? outro;

    const limitHold = tl.timeOfBar(Math.round(tl.bar(brk)) + 1); // 1,048,576 holds for the Break's first bar
    this.segs = [
      { t0: -1, t1: first, v0: 0, v1: 0, kind: 'hold' },
      { t0: first, t1: verse1, v0: 0, v1: 14, kind: 'words' },
      { t0: verse1, t1: pre1, v0: 14, v1: 4096, kind: 'words' },
      { t0: pre1, t1: chorus1, v0: 4096, v1: 48000, kind: 'roll', ease: ease.inQuad },
      { t0: chorus1, t1: tokenLine1.words[0]!.start, v0: 48000, v1: 96000, kind: 'words' },
      { t0: tokenLine1.words[0]!.start, t1: two1, v0: 96000, v1: 164000, kind: 'words' },
      { t0: two1, t1: k1, v0: 164000, v1: 200000, kind: 'roll', ease: ease.inOutCubic },
      { t0: k1, t1: kEnd1, v0: 200000, v1: 200000, kind: 'hold' },
      { t0: kEnd1, t1: chorus2, v0: 200000, v1: 640000, kind: 'words' },
      { t0: chorus2, t1: k2, v0: 640000, v1: 880000, kind: 'words' },
      { t0: k2, t1: million2, v0: 880000, v1: 1_000_000, kind: 'roll', ease: ease.inOutCubic },
      { t0: million2, t1: kEnd2, v0: 1_000_000, v1: 1_000_000, kind: 'hold' },
      { t0: kEnd2, t1: bridge, v0: 1_000_000, v1: 1_024_000, kind: 'words' },
      { t0: bridge, t1: ov1, v0: 1_024_000, v1: LIMIT - 1, kind: 'words' },
      { t0: ov1, t1: brk, v0: LIMIT - 1, v1: LIMIT - 1, kind: 'hold' },
      { t0: brk, t1: limitHold, v0: LIMIT, v1: LIMIT, kind: 'hold' },
      { t0: limitHold, t1: this.overflowT, v0: LIMIT, v1: TokenCounter.OVERFLOW_V0 - 1, kind: 'roll', ease: ease.inQuart },
    ];
  }

  /** Word onsets in [t0, t1), for stepping. */
  private onsets(t0: number, t1: number) {
    return this.words.filter((w) => w.start >= t0 && w.start < t1).map((w) => w.start);
  }

  private segValue(s: Seg, t: number): { v: number; stepT: number } {
    if (s.kind === 'hold') return { v: s.v0, stepT: s.t0 };
    // a roll "steps" when it lands (the bump flashes on the landing)
    if (s.kind === 'roll') return { v: s.v0 + (s.v1 - s.v0) * (s.ease ?? ease.linear)(clamp((t - s.t0) / (s.t1 - s.t0))), stepT: t >= s.t1 ? s.t1 : s.t0 };
    // steps on word onsets; step sizes vary deterministically, sum to the segment's range
    const on = this.onsets(s.t0, s.t1);
    if (on.length === 0) return { v: s.v0 + (s.v1 - s.v0) * clamp((t - s.t0) / (s.t1 - s.t0)), stepT: s.t0 };
    const w = on.map((x, i) => 0.6 + hash(x * 100, i) * 0.8);
    const total = w.reduce((a, b) => a + b, 0);
    let acc = 0, stepT = s.t0;
    for (let i = 0; i < on.length && on[i]! <= t; i++) { acc += w[i]!; stepT = on[i]!; }
    return { v: s.v0 + (s.v1 - s.v0) * (acc / total), stepT };
  }

  state(t: number): CounterState {
    const mk = (value: number, mode: CounterMode, stepT: number, text?: string): CounterState => ({
      value, mode, stepT, text: text ?? formatTokens(value), bump: t >= stepT ? Math.pow(0.5, (t - stepT) / 0.09) : 0,
    });
    if (t >= this.zeroT) return mk(0, 'count', this.zeroT);
    if (t >= this.nanT) return mk(NaN, 'text', this.nanT, 'NaN');
    if (t >= this.infT) return mk(Infinity, 'text', this.infT, '∞');
    if (t >= this.overflowTextT) return mk(Infinity, 'text', this.overflowTextT, 'OVERFLOW');
    if (t >= this.overflowT) {
      // digits run past the frame: ×10 every beat from 100,000,000
      const beats = Math.floor((t - this.overflowT) / this.tl.beatPeriod + 1e-6);
      const v = TokenCounter.OVERFLOW_V0 * Math.pow(10, beats);
      return mk(v, 'overflow', this.overflowT + beats * this.tl.beatPeriod, formatTokens(v));
    }
    let seg = this.segs[0]!;
    for (const s of this.segs) if (t >= s.t0) seg = s;
    const r = this.segValue(seg, t);
    return mk(Math.round(r.v), 'count', r.stepT);
  }

  /** Anchor times (for scenes that stage the counter themselves). */
  get anchors() {
    return { overflow: this.overflowT, overflowText: this.overflowTextT, inf: this.infT, nan: this.nanT, zero: this.zeroT };
  }
}

export interface CounterStyle {
  /** Digit size in px (label is ~0.32×). */
  size?: number;
  /** 'right' (default: x is the right edge) or 'left'. */
  align?: 'left' | 'right';
  /** Draw in ink (for the magenta hook ground / light frames) instead of bone. */
  ink?: boolean;
  /** Label above the digits; '' for none. */
  label?: string;
  /** 0..1 glitch the digits. */
  corruption?: number;
  /** Replace the text. */
  text?: string;
  alpha?: number;
}

/**
 * Draw the counter at (x, baseline y). Returns the drawn width.
 * The digits flash to signal on each step (bump), and are signal outright in 'overflow'/'text' modes.
 */
export function drawCounter(c: CanvasRenderingContext2D, x: number, y: number, st: CounterState, t: number, o: CounterStyle = {}): number {
  const size = o.size ?? 34;
  const fg = o.ink ? 'ink' : 'bone';
  let s = o.text ?? st.text;
  if (o.corruption && o.corruption > 0) {
    const glyphs = '01#%?!▒∞';
    s = Array.from(s).map((ch, i) => (hash(i, frameIdx(t) >> 1) < o.corruption! * 0.7 ? glyphs[Math.floor(hash(i, frameIdx(t), 3) * glyphs.length)]! : ch)).join('');
  }
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = font(F.mono(500), size);
  const w = c.measureText(s).width;
  const x0 = (o.align ?? 'right') === 'right' ? x - w : x;
  const label = o.label ?? 'CONTEXT · TOKENS';
  if (label) {
    c.font = font(F.mono(500), Math.max(10, size * 0.32));
    c.letterSpacing = `${Math.max(2, size * 0.08)}px`;
    c.fillStyle = rgba(fg, 0.55);
    const lw = c.measureText(label).width;
    c.fillText(label, (o.align ?? 'right') === 'right' ? x - lw : x, y - size * 1.05);
    c.letterSpacing = '0px';
  }
  c.font = font(F.mono(500), size);
  const hot = st.mode !== 'count' || !!o.text;
  const k = hot ? 1 : clamp(st.bump * 1.4);
  c.fillStyle = o.ink ? rgba('ink', 0.92) : k > 0.02 ? mixRGBA('bone', 'signal', k) : rgba('bone', 0.92);
  c.fillText(s, x0, y);
  c.restore();
  return w;
}

/** Fraction of a step's roll animation done (for scenes that animate digits themselves). */
export const stepProgress = (st: CounterState, t: number, dur = 0.25) => prog(t, st.stepT, st.stepT + dur, ease.outCubic);
