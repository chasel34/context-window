// The hook, one parametric module for scenes 5, 8 and 14 (BEATSHEET). Full-frame signal magenta, ink
// Unbounded 900. Everything is cut on the sung data (word onsets), not snapped to the grid.
//
// Shots (one per lyric line in the scene window, hard cut on its first word):
//   stutter  "C-C-Context!": one hard cut per syllable. The C-s build up a row (older ones outlined),
//            "Context!" lands as a stacked CON/TEXT! poster and re-slams on the drum re-entry (the
//            hook's second downbeat: its first bar is vocal-only).
//   line     big left-set lyric: unsung words are outlines (tokens still in the future), sung words fill
//            in with a slam; each sung word gets a token bracket and a token id; a caret follows.
//   tokens / hundred   "Token, token, token, TOKEN" / "Two hundred K…": the counter takes the frame
//            (rolling drums, the context bar filling toward 1,048,576), the line set as tokenizer boxes.
//   "(window!)" cue: the whole frame shrinks into an app window on ink (title bar, scrollbar).
// Furniture (header, beat squares, usage bar, type guides) is ink hairline on the magenta.
//
// `damage` (timeline params: 0 / 0.4 / 1) scales every kind of corruption:
//   ▒ glyphs (future outlines most, the active word least), 1–2 frame layout offsets, torn slices,
//   RGB split, outline echoes, counter corruption. Hook 1 only gets a whisper of RGB split on the cuts.
// Subclasses override `windowRect`, `drawOutside`, `drawOverlay`, `drawTail`, `post` for their exits.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { HEX, LIN, rgba } from '../engine/palette';
import { F, font, layout, measure, plain, type TextLayout } from '../engine/type';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, pulse } from '../engine/util';
import type { Line } from '../engine/lyrics';
import { layoutLyric, type LyricLayout } from './lyric';
import { TokenCounter, formatTokens, LIMIT } from './counter';
export { LIMIT };
import { drawOdometer, shownValue, MONO_ADV, MONO_CAP } from './b_odometer';
import { SELECT_ALPHA } from './d_bridge';

export type HookKind = 'stutter' | 'tokens' | 'hundred' | 'line';
export interface Shot { line: Line; kind: HookKind; t0: number; t1: number; n: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Unbounded cap height / em. */
export const U_CAP = 0.75;
/** Cuts land one frame (60 fps) before the sung onset: the picture is there when the syllable is. */
export const CUT_LEAD = 1 / 60;
/** Left text margin. */
export const PAD = 150;

const DISPLAY = F.display(900);

export class HookScene extends Scene {
  layer = new Layer2D();
  /** 0 (hook1) … 0.4 (hook2) … 1 (hook3). Defaults to ctx.params.damage. */
  damage = 0;
  hookNo = 1;
  counter!: TokenCounter;
  shots: Shot[] = [];
  /** '(window!)' cues in this scene: in at start, out at `out`. */
  windows: { start: number; end: number; out: number }[] = [];
  /** C- / Context! onsets (zoom punches) and every hard cut (shot starts + syllables). */
  stutters: number[] = [];
  cuts: number[] = [];
  /** Vocal onsets in the tail after the last line (ad-libs). */
  adlib: number[] = [];
  /** Drum re-entry after the vocal-only first bar. */
  hitT = -1;
  /** Start of the tail (after the last line has been sung and held). */
  tailT = Infinity;
  /** Unused (kept for API compatibility with the phase-1 module). */
  label = false;
  /** Per-frame colours: ground and type (swapped on punch frames). */
  bg: string = HEX.signal;
  fg: string = HEX.ink;
  private layouts = new Map<string, TextLayout>();

  override init() {
    const { start, end, lyrics, audio, tl } = this.ctx;
    this.damage = this.ctx.params.damage ?? this.damage;
    this.hookNo = this.damage < 0.2 ? 1 : this.damage < 0.7 ? 2 : 3;
    this.counter = new TokenCounter(tl);
    const lines = lyrics.lines.filter((l) => l.start >= start - 0.05 && l.start < end - 0.05);
    this.shots = lines.map((line, n) => ({ line, kind: this.kindOf(line), t0: line.words[0]!.start - CUT_LEAD, t1: end, n }));
    for (let i = 0; i + 1 < this.shots.length; i++) this.shots[i]!.t1 = this.shots[i + 1]!.t0;
    const starts = this.shots.map((s) => s.t0);
    this.windows = lyrics.cues('window').filter((x) => x.start >= start && x.start < end).map((x) => {
      const next = starts.find((s) => s > x.start) ?? end;
      return { start: x.start, end: x.end, out: Math.min(x.end + 0.35, next - 0.01) };
    });
    this.stutters = this.shots.filter((s) => s.kind === 'stutter').flatMap((s) => s.line.words.map((w) => w.start));
    this.cuts = [...new Set([...starts.map((s) => s + CUT_LEAD), ...this.stutters])].sort((a, b) => a - b);
    // the drum re-entry: the strongest kick in the hook's second bar
    const bar1 = tl.timeOfBar(Math.round(tl.bar(start)) + 1);
    const kicks = audio.events('kick', bar1 - 0.1, bar1 + 0.1);
    this.hitT = kicks.length ? kicks.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : -1;
    const last = lines[lines.length - 1];
    if (last) {
      this.tailT = last.end + 0.5;
      this.adlib = audio.events('vocal', last.end + 0.1, end - 0.05).filter(([, s]) => s >= 0.08).map(([x]) => x);
    }
  }

  kindOf(l: Line): HookKind {
    if (/^C-C-/i.test(l.text)) return 'stutter';
    if (/^Token, token/i.test(l.text)) return 'tokens';
    if (/^Two hundred K/i.test(l.text)) return 'hundred';
    return 'line';
  }

  shotAt(t: number): Shot | null {
    let s: Shot | null = null;
    for (const x of this.shots) if (t >= x.t0) s = x;
    return s;
  }

  lay(text: string, fam: string, size: number): TextLayout {
    const k = `${fam}|${size}|${text}`;
    let l = this.layouts.get(k);
    if (!l) { l = layout(text, fam, size); this.layouts.set(k, l); }
    return l;
  }

  // ------------------------------------------------------------------ timing

  /** 0..1: the "(window!)" amount. */
  windowAmount(t: number) {
    let k = 0;
    for (const w of this.windows) k = Math.max(k, prog(t, w.start - 0.03, w.start + 0.16, (x) => ease.outBack(x, 1.4)) * (1 - prog(t, w.out - 0.14, w.out, ease.inCubic)));
    return k;
  }

  /** Zoom punch: 1.06 on every C- (1.08 on Context!), decaying fast. */
  zoomPunch(t: number) {
    return 1 + 0.06 * this.ctx.tl.pulseAt(t, this.stutters, 0.07);
  }

  /** Punch frames (inverted: ink ground, magenta type): 3 frames on the cut. */
  punchTimes(): number[] {
    if (this.hookNo === 1) return [...this.shots.filter((s) => s.kind === 'stutter').map((s) => s.line.words[s.line.words.length - 1]!.start), ...(this.hitT > 0 ? [this.hitT] : [])];
    return [...this.stutters, ...(this.hitT > 0 ? [this.hitT] : [])];
  }
  isPunch(t: number) { return this.punchTimes().some((x) => t >= x - CUT_LEAD && t < x + 0.05); }

  /** The content rect (16:9) for a window amount k. Subclasses extend it for their exits. */
  windowRect(t: number, k: number): Rect {
    void t;
    const s = lerp(1, 0.64, k);
    const w = W * s, h = H * s;
    return { x: (W - w) / 2, y: (H - h) / 2 + 26 * clamp(k), w, h };
  }

  // ------------------------------------------------------------------ render

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t, D = this.damage;
    this.tNow = t;
    const punch = this.isPunch(t);
    this.bg = punch ? HEX.ink : HEX.signal;
    this.fg = punch ? HEX.signal : HEX.ink;
    const wk = this.windowAmount(t);
    const r = this.windowRect(t, wk);
    const full = r.w >= W - 0.5;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    if (!full) this.drawOutside(c, f, r, wk);

    const fi = frameIdx(t) >> 1;
    const jolt = D > 0 && hash(fi, 17) < D * 0.1;
    const shot = this.shotAt(t);
    c.save();
    c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
    c.translate(r.x, r.y); c.scale(r.w / W, r.h / H);
    c.fillStyle = this.bg; c.fillRect(0, 0, W, H);
    if (jolt) c.translate((hash(fi, 5) - 0.5) * 220 * D, (hash(fi, 6) - 0.5) * 50 * D);
    const counterShot = !!shot && (shot.kind === 'tokens' || shot.kind === 'hundred') && t < this.tailT;
    this.drawFurniture(c, f, shot, counterShot);
    if (this.interject(c, f, shot)) { /* a subclass took the frame */ }
    else if (!shot) this.drawPre(c, f);
    else if (t >= this.tailT) this.drawTail(c, f, shot);
    else if (shot.kind === 'stutter') this.drawStutter(c, f, shot);
    else if (counterShot) this.drawCounterFull(c, f, shot);
    else this.drawLine(c, f, shot);
    c.restore();
    if (wk > 0.001) this.drawChrome(c, f, r, wk);
    this.drawOverlay(c, f, r);
    if (D > 0) this.tear(c, t);
    comp.draw(renderer, L.upload(), out);
    return this.post(f, { counterShot, wk, jolt, full, punch });
  }

  post(f: Frame, s: { counterShot: boolean; wk: number; jolt: boolean; full: boolean; punch: boolean }): PostOverrides {
    const t = f.t, D = this.damage, tl = this.ctx.tl;
    const hit = this.hitT > 0 ? pulse(t, this.hitT, 0.07) : 0;
    const sh = (6 + 18 * D) * hit + 10 * D * tl.pulseAt(t, this.stutters, 0.05);
    return {
      paper: s.wk < 0.3 && s.full ? 1 : 0,
      bloom: 0.22,
      bloomThreshold: 1.3,
      halation: 0.08,
      vignette: 0.2,
      grain: 0.05,
      zoom: this.zoomPunch(t) * (1 + 0.035 * hit),
      shake: sh > 0.2 ? [noise1(t * 60, 1) * sh, noise1(t * 60, 2) * sh] : [0, 0],
      rgbSplit: 1.5 * tl.pulseAt(t, this.cuts, 0.05) + D * (2 + 10 * tl.beatPulse(t, 0.06)) + (s.jolt ? 16 * D : 0),
      counter: s.counterShot ? 0 : 1,
      counterCorruption: D * 0.5,
    };
  }

  // ------------------------------------------------------------------ furniture

  drawFurniture(c: CanvasRenderingContext2D, f: Frame, shot: Shot | null, counterShot: boolean) {
    const t = f.t, tl = this.ctx.tl, fg = this.fg;
    c.save();
    // header
    c.font = font(F.mono(600), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba(fg, 0.85);
    c.fillText(`CONTEXT WINDOW`, 96, 76);
    c.fillStyle = rgba(fg, 0.5);
    c.fillText(`HOOK ${this.hookNo}/3`, 96 + measure('CONTEXT WINDOW', F.mono(600), 15, 3) + 28, 76);
    c.font = font(F.mono(400), 13);
    c.letterSpacing = '2px';
    if (shot) {
      const ln = String(shot.line.i + 1).padStart(3, '0');
      c.fillStyle = rgba(fg, 0.55);
      c.fillText(`L${ln}  ${plain(shot.line.text).toUpperCase()}`, 96, 100);
    }
    // beat squares (bottom left): the bar, beat by beat
    const bib = tl.beatInBar(t), bar = Math.floor(tl.bar(t) + 1e-6);
    const bp = tl.beatPulse(t, 0.08);
    for (let i = 0; i < 4; i++) {
      const x = 96 + i * 24, y = H - 78;
      if (i === bib) { c.fillStyle = rgba(fg, 0.9); c.fillRect(x - 2 * bp, y - 2 * bp, 14 + 4 * bp, 14 + 4 * bp); }
      else { c.strokeStyle = rgba(fg, 0.45); c.lineWidth = 1.5; c.strokeRect(x + 0.75, y + 0.75, 12.5, 12.5); }
    }
    c.fillStyle = rgba(fg, 0.55);
    c.fillText(`BAR ${String(bar + 1).padStart(3, '0')}`, 96 + 4 * 24 + 14, H - 66);
    // usage bar (bottom right)
    if (!counterShot) {
      const st = this.counter.state(t);
      const v = shownValue(this.counter, t);
      const frac = Number.isFinite(v) ? clamp(v / LIMIT) : st.text === 'NaN' ? 0 : 1;
      const x0 = W - 96 - 520, y = H - 72;
      c.fillStyle = rgba(fg, 0.3); c.fillRect(x0, y, 520, 2);
      for (let i = 0; i <= 8; i++) c.fillRect(x0 + i * 65, y - (i % 4 === 0 ? 10 : 5), 1.5, i % 4 === 0 ? 10 : 5);
      c.fillStyle = rgba(fg, 0.9); c.fillRect(x0, y - 3, 520 * frac, 8);
      c.fillStyle = rgba(fg, 0.55);
      c.textAlign = 'right';
      const pct = Number.isFinite(v) ? `${(100 * v / LIMIT).toFixed(1)}%` : st.text;
      c.fillText(`CTX ${pct}`, x0 - 18, y + 6);
      c.textAlign = 'left';
    }
    c.restore();
  }

  /** Hairline type-specimen guides at a baseline and cap height. */
  guides(c: CanvasRenderingContext2D, base: number, capH: number, a = 1) {
    c.save();
    c.fillStyle = rgba(this.fg, 0.2 * a);
    c.fillRect(0, Math.round(base), W, 1.5);
    c.fillRect(0, Math.round(base - capH), W, 1.5);
    c.font = font(F.mono(400), 12);
    c.letterSpacing = '2px';
    c.fillStyle = rgba(this.fg, 0.5 * a);
    c.fillText('BASELINE', W - 96 - measure('BASELINE', F.mono(400), 12, 2), Math.round(base) + 20);
    c.fillText(`CAP ${U_CAP.toFixed(3)} EM`, W - 96 - measure(`CAP ${U_CAP.toFixed(3)} EM`, F.mono(400), 12, 2), Math.round(base - capH) - 10);
    c.restore();
  }

  // ------------------------------------------------------------------ glyphs

  /**
   * Draw `text` at (x, baseline y) in Unbounded, filled or outlined; `frac` of the glyphs (re-rolled every
   * 2 frames) are ▒ instead (damage). Kerning-correct (per-glyph at the run's layout positions).
   */
  word(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, o: { stroke?: number; frac?: number; seed?: number; alpha?: number; color?: string } = {}) {
    const col = rgba(o.color ?? this.fg, o.alpha ?? 1);
    c.font = font(DISPLAY, size);
    const frac = o.frac ?? 0;
    if (frac <= 0) {
      if (o.stroke) { c.strokeStyle = col; c.lineWidth = o.stroke; c.lineJoin = 'round'; c.strokeText(text, x, y); }
      else { c.fillStyle = col; c.fillText(text, x, y); }
      return;
    }
    const lay = this.lay(text, DISPLAY, size);
    const fi = frameIdx(this.tNow) >> 1;
    for (const g of lay.glyphs) {
      if (g.ch === ' ') continue;
      const hit = hash(fi, g.i, o.seed ?? 0) < frac;
      if (hit) {
        const top = y - size * U_CAP;
        this.shade(c, x + g.x, top - size * 0.02, g.w, size * U_CAP + size * 0.04, o.color ?? this.fg, o.alpha ?? 1);
        c.font = font(DISPLAY, size);
      } else if (o.stroke) { c.strokeStyle = col; c.lineWidth = o.stroke; c.lineJoin = 'round'; c.strokeText(g.ch, x + g.x, y); }
      else { c.fillStyle = col; c.fillText(g.ch, x + g.x, y); }
    }
  }
  /** ▒: a medium-shade dither (fixed 4 px pitch at any type size) filling a glyph cell. */
  shade(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, alpha = 1) {
    c.save();
    c.fillStyle = this.bg; c.fillRect(x, y, w, h);
    c.globalAlpha *= alpha;
    c.fillStyle = shadePattern(c, color);
    c.translate(x, y);
    c.fillRect(0, 0, w, h);
    c.restore();
  }
  /** Time of the frame being drawn (for the ▒ re-roll). */
  tNow = 0;

  // ------------------------------------------------------------------ shots

  /** Before the first line: the cursor waits where the first C will be typed. */
  drawPre(c: CanvasRenderingContext2D, f: Frame) {
    const first = this.shots[0];
    const size = 880, capH = size * U_CAP;
    const base = H / 2 + capH / 2;
    const x = first ? (W - this.lay('C-', DISPLAY, size).width) / 2 : W / 2;
    const k = prog(f.t, this.ctx.start, this.ctx.start + 0.22, ease.outExpo);
    this.guides(c, base, capH, k);
    const on = this.ctx.tl.beatPhase(f.t) < 0.5 || (first !== undefined && first.t0 - f.t < 0.2);
    if (on) { c.fillStyle = rgba(this.fg, 1); c.fillRect(x, base - capH, capH * 0.42 * k, capH); }
  }

  drawStutter(c: CanvasRenderingContext2D, f: Frame, shot: Shot) {
    const t = f.t, D = this.damage, ws = shot.line.words;
    let i = 0;
    for (let j = 0; j < ws.length; j++) if (t >= ws[j]!.start - CUT_LEAD) i = j;
    const last = ws.length - 1;
    const t0 = ws[i]!.start;
    const since = Math.max(0, t - t0);
    if (i < last) {
      // the C-s build up a row; older ones are outlines
      const n = i + 1;
      const unit = this.lay('C-', DISPLAY, 100).width / 100;
      const size = Math.min(880, (W - 2 * PAD) / (n * unit));
      const capH = size * U_CAP, base = H / 2 + capH / 2;
      const x0 = (W - n * unit * size) / 2;
      this.guides(c, base, capH);
      for (let j = 0; j < n; j++) {
        const x = x0 + j * unit * size;
        const cur = j === i;
        const s = cur ? 1 + 0.1 * (1 - ease.outExpo(clamp(since / 0.14))) : 1;
        c.save();
        c.translate(x + (unit * size) / 2, base - capH / 2); c.scale(s, s); c.translate(-(x + (unit * size) / 2), -(base - capH / 2));
        if (cur) this.word(c, 'C-', x, base, size, { frac: D * 0.08, seed: j });
        else this.word(c, 'C-', x, base, size, { stroke: 3, frac: D * 0.3, seed: j + 7 });
        c.restore();
      }
      if (D > 0) this.echo(c, 'C-', x0 + i * unit * size, base, size, t, t0);
      return;
    }
    // Context!: stacked CON / TEXT! poster
    const rows = ['CON', 'TEXT!'];
    const wMax = Math.max(...rows.map((r) => this.lay(r, DISPLAY, 100).width / 100));
    const size = Math.min((W - 2 * PAD) / wMax, (H - 300) / (2 * U_CAP + 0.25));
    const capH = size * U_CAP, lead = capH + size * 0.25;
    const base0 = H / 2 - lead / 2 + capH / 2;
    const reslam = this.hitT > t0 && t >= this.hitT ? this.hitT : t0;
    const age = t - reslam;
    const s = (1 + 0.12 * (1 - ease.outExpo(clamp(age / 0.16)))) * (1 + 0.012 * Math.max(0, t - t0));
    c.save();
    c.translate(W / 2, H / 2); c.scale(s, s); c.translate(-W / 2, -H / 2);
    this.guides(c, base0 + lead, capH, 0.8);
    rows.forEach((r, k) => {
      if (D > 0) this.echo(c, r, PAD, base0 + k * lead, size, t, reslam);
      this.word(c, r, PAD, base0 + k * lead, size, { frac: D * 0.1, seed: 20 + k });
    });
    // syllable ledger: the sung stutter, small, under the poster
    c.font = font(F.mono(500), 16);
    c.letterSpacing = '4px';
    c.fillStyle = rgba(this.fg, 0.6);
    c.fillText(ws.map((w) => plain(w.w).toUpperCase()).join(' '), PAD + 6, base0 + lead + 58);
    c.restore();
  }

  /** Outline echoes of a slammed word, drifting out (damage ≥ 0.4). */
  echo(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, t: number, t0: number) {
    const D = this.damage;
    const n = D >= 0.9 ? 4 : 2;
    const age = Math.max(0, t - t0);
    for (let j = 1; j <= n; j++) {
      const off = j * (10 + 90 * D) * (0.3 + ease.outExpo(clamp(age / 0.3)));
      const a = (0.45 - j * 0.08) * (1 - 0.5 * clamp(age / 1.2));
      if (a <= 0) continue;
      this.word(c, text, x + off * (j % 2 ? 1 : -0.6), y + (j % 2 ? -1 : 1) * off * 0.12, size, { stroke: 2, alpha: a });
    }
  }

  /** Size for a lyric line: as big as fits in two rows. */
  private styles = new Map<Line, { size: number; style: { size: number; maxWidth: number; lineHeight: number; align: 'left' } }>();
  lineStyle(line: Line) {
    let r = this.styles.get(line);
    if (r) return r;
    const maxWidth = W - 2 * PAD - 40;
    let size = Math.min(230, (100 * 2 * maxWidth * 0.9) / measure(line.text, DISPLAY, 100));
    for (let i = 0; i < 12; i++) {
      const lay = layoutLyric(line, 0, 0, 0, { size, maxWidth, lineHeight: 1.1 });
      if (lay.rows.length <= 2) break;
      size *= 0.94;
    }
    r = { size, style: { size, maxWidth, lineHeight: 1.1, align: 'left' } };
    this.styles.set(line, r);
    return r;
  }

  /** A normal lyric line: big, left-set, word by word. */
  drawLine(c: CanvasRenderingContext2D, f: Frame, shot: Shot, o: { evict?: number } = {}): LyricLayout {
    const t = f.t, D = this.damage;
    const line = shot.line;
    const { size, style } = this.lineStyle(line);
    const probe = layoutLyric(line, t, PAD, 0, style);
    const capH = size * U_CAP;
    const lh = size * style.lineHeight;
    const y0 = H / 2 - ((probe.rows.length - 1) * lh) / 2 + capH / 2 - 10;
    const lay = layoutLyric(line, t, PAD, y0, style);
    for (const row of lay.rows) this.guides(c, row.y, capH, 0.55);
    const sel = this.selectAmount(t);
    if (sel > 0) {
      // text selection (select-all): bone bars behind the rows, swept left to right, row by row (s09 opens
      // on the same bars: shared/d_bridge.ts SELECT_ALPHA)
      lay.rows.forEach((row, k) => {
        const e = prog(sel * lay.rows.length - k, 0, 1, ease.outCubic);
        if (e <= 0) return;
        c.fillStyle = rgba('bone', SELECT_ALPHA);
        c.fillRect(row.x - 18, row.y - capH - size * 0.2, (row.w + 36 + size * 0.3) * e, capH + size * 0.44);
      });
    }
    const evict = o.evict ?? 0; // tail: words turn back into outlines, first to last
    lay.words.forEach((wb, wi) => {
      const st = wb.state;
      const text = lay.text.slice(wb.i0, wb.i1);
      const gone = wi < evict;
      if (!st.on || gone) {
        this.word(c, text, wb.x, wb.y, size, { stroke: 2.5, alpha: gone ? 0.35 : 0.55, frac: D * 0.35, seed: wi + 40 });
        return;
      }
      const e = ease.outExpo(clamp(st.since / 0.14));
      const dy = (1 - e) * size * 0.22;
      const s = 1 + 0.08 * (1 - e);
      c.save();
      const cx = wb.x + wb.w / 2, cy = wb.y - capH / 2;
      c.translate(cx, cy + dy); c.scale(s, s); c.translate(-cx, -cy);
      this.word(c, text, wb.x, wb.y, size, { frac: D * (st.phase === 'active' ? 0.04 : 0.14), seed: wi + 60 });
      c.restore();
      // token bracket + id
      const ba = prog(st.since, 0.02, 0.16, ease.outCubic);
      const by = wb.y + size * 0.16;
      c.fillStyle = rgba(this.fg, 0.8);
      c.fillRect(wb.x, by, wb.w * ba, 3);
      c.fillRect(wb.x, by - 10, 2, 10);
      if (ba > 0.99) c.fillRect(wb.x + wb.w - 2, by - 10, 2, 10);
      const chars = wb.i1 - wb.i0;
      if (chars > 5 && ba > 0.6) {
        const split = Math.floor(chars * (0.4 + 0.2 * hash(line.i, wi)));
        const sx = wb.x + measure(text.slice(0, split), DISPLAY, size);
        c.fillRect(sx, by - 7, 2, 7);
      }
      c.font = font(F.mono(500), 14);
      c.letterSpacing = '1px';
      c.fillStyle = rgba(this.fg, 0.6 * ba);
      const id = 1000 + Math.floor(hash(line.i * 31 + wi, 9) * 98000);
      c.fillText(`#${id}`, wb.x + 2, by + 30);
      c.letterSpacing = '0px';
    });
    // caret
    const singing = !!f.lyric.word && f.lyric.line === line;
    const lit = singing || this.ctx.tl.beatPhase(t) < 0.5;
    if (lit) { c.fillStyle = rgba(this.fg, 1); c.fillRect(lay.caret.x + size * 0.05, lay.caret.y - capH, size * 0.085, capH); }
    return lay;
  }

  /** "Token ×4" / "Two hundred K…": the counter fills the frame. */
  drawCounterFull(c: CanvasRenderingContext2D, f: Frame, shot: Shot) {
    const t = f.t, D = this.damage, fg = this.fg;
    const line = shot.line;
    const st = this.counter.state(t);
    const v = shownValue(this.counter, t);
    // --- the line as tokenizer boxes (fitted to the width)
    const gapEm = 0.42;
    const w100 = line.words.reduce((a, w) => a + this.lay(w.w, DISPLAY, 100).width, 0) + (line.words.length - 1) * gapEm * 100;
    const size = Math.min(104, Math.floor((100 * (W - 2 * PAD - 20)) / w100)), capH = size * U_CAP, by = 250;
    let x = PAD;
    line.words.forEach((w, wi) => {
      const text = w.w;
      const wd = this.lay(text, DISPLAY, size).width;
      const on = t >= w.start - CUT_LEAD, since = t - w.start;
      const active = on && (wi === line.words.length - 1 || t < line.words[wi + 1]!.start - CUT_LEAD);
      const e = ease.outExpo(clamp(since / 0.14));
      const pad = 16;
      c.save();
      if (on) {
        const s = 1 + 0.18 * (1 - e);
        c.translate(x + wd / 2, by - capH / 2); c.scale(s, s); c.translate(-(x + wd / 2), -(by - capH / 2));
        if (active) { c.fillStyle = rgba(fg, 1); c.fillRect(x - pad, by - capH - pad, wd + 2 * pad, capH + 2 * pad); }
        else { c.strokeStyle = rgba(fg, 0.7); c.lineWidth = 2; c.strokeRect(x - pad, by - capH - pad, wd + 2 * pad, capH + 2 * pad); }
        this.word(c, text, x, by, size, { color: active ? this.bg : fg, frac: D * 0.1, seed: wi + 80 });
        c.font = font(F.mono(500), 13);
        c.fillStyle = rgba(fg, 0.6);
        c.fillText(`${String(wi + 1).padStart(2, '0')}`, x - pad, by - capH - pad - 10);
      } else this.word(c, text, x, by, size, { stroke: 2, alpha: 0.5, frac: D * 0.3, seed: wi + 90 });
      c.restore();
      x += wd + size * gapEm;
    });
    // --- digits
    const chars = Number.isFinite(v) ? formatTokens(Math.max(v, 100000)).length : st.text.length;
    const dsize = Math.min(400, Math.floor((W - 2 * PAD - 330) / (chars * MONO_ADV))), base = 690;
    const tokenHit = this.ctx.tl.pulseAt(t, line.words.map((w) => w.start), 0.06);
    c.save();
    c.font = font(F.mono(500), 22);
    c.letterSpacing = '6px';
    c.fillStyle = rgba(fg, 0.7);
    c.fillText('CONTEXT · TOKENS IN WINDOW', PAD, base - dsize * MONO_CAP - 40);
    c.restore();
    const s = 1 + 0.05 * tokenHit;
    c.save();
    c.translate(PAD, base - dsize * MONO_CAP / 2); c.scale(s, s); c.translate(-PAD, -(base - dsize * MONO_CAP / 2));
    const dw = this.drawCounterValue(c, f, shot, v, PAD - 10, base, dsize);
    if (D > 0) this.corruptDigits(c, PAD - 10, base, dsize, dw, t);
    c.restore();
    c.font = font(F.mono(400), 44);
    c.fillStyle = rgba(fg, 0.6);
    c.fillText(`/ ${formatTokens(LIMIT)}`, PAD + dw + 24, base);
    // --- the bar
    const bx = PAD, bw = W - 2 * PAD, y = 850;
    const frac = Number.isFinite(v) ? clamp(v / LIMIT) : 1;
    c.fillStyle = rgba(fg, 0.35);
    c.fillRect(bx, y, bw, 2);
    c.font = font(F.mono(400), 14);
    c.letterSpacing = '2px';
    for (let i = 0; i <= 16; i++) {
      const hh = i % 4 === 0 ? 16 : 7;
      c.fillRect(bx + (bw * i) / 16, y - hh, 1.5, hh);
      if (i % 4 === 0) {
        const lab = ['0', '256K', '512K', '768K', '1M'][i / 4]!;
        c.fillText(lab, bx + (bw * i) / 16 - (i === 16 ? measure(lab, F.mono(400), 14, 2) : 0), y + 34);
      }
    }
    c.fillStyle = rgba(fg, 1);
    c.fillRect(bx, y - 6, bw * frac, 14);
    // "a million more": the rest of the window, flashing as the ask
    if (shot.kind === 'hundred') {
      const more = line.words.find((w) => /million/i.test(w.w));
      if (more && t >= more.start - CUT_LEAD) {
        const blink = Math.floor((t - more.start) / 0.1) % 2 === 0 ? 1 : 0.4;
        c.strokeStyle = rgba(fg, 0.9 * blink);
        c.lineWidth = 2;
        c.setLineDash([10, 8]);
        c.strokeRect(bx + bw * frac, y - 6, bw * (1 - frac), 14);
        c.setLineDash([]);
        c.font = font(F.mono(600), 14);
        c.fillStyle = rgba(fg, blink);
        c.fillText('+1,000,000 REQUESTED', bx + bw * frac + 12, y - 20);
      }
    }
  }

  /** The counter's value in the counter shot, at (x, baseline). Returns its width. */
  drawCounterValue(c: CanvasRenderingContext2D, f: Frame, shot: Shot, v: number, x: number, base: number, size: number): number {
    void shot;
    if (Number.isFinite(v)) return drawOdometer(c, x, base, v, { size, color: rgba(this.fg, 1), minDigits: 6 });
    const text = this.counter.state(f.t).text;
    c.font = font(F.mono(500), size); c.fillStyle = rgba(this.fg, 1); c.fillText(text, x, base);
    return measure(text, F.mono(500), size);
  }

  /** Subclasses may take the whole frame (flash cuts): draw and return true to skip the shot. */
  interject(c: CanvasRenderingContext2D, f: Frame, shot: Shot | null): boolean { void c; void f; void shot; return false; }

  /** ▒ over some digit cells (damage). */
  corruptDigits(c: CanvasRenderingContext2D, x: number, base: number, size: number, w: number, t: number) {
    const adv = size * MONO_ADV, n = Math.round(w / adv), fi = frameIdx(t) >> 1;
    for (let i = 0; i < n; i++) {
      if (hash(fi, i, 77) >= this.damage * 0.12) continue;
      this.shade(c, x + i * adv, base - size * MONO_CAP - 4, adv, size * MONO_CAP + 8, this.fg);
    }
  }

  /** After the last line: it stays, its words turning back into outlines on each ad-lib onset. */
  drawTail(c: CanvasRenderingContext2D, f: Frame, shot: Shot) {
    if (shot.kind !== 'line') { this.drawLine(c, f, shot); return; }
    let n = 0;
    for (const x of this.adlib) if (f.t >= x) n++;
    this.drawLine(c, f, shot, { evict: n });
  }

  // ------------------------------------------------------------------ window

  /** Outside the shrunken window: the interface (a faint dot grid on ink). */
  drawOutside(c: CanvasRenderingContext2D, f: Frame, r: Rect, k: number) {
    void f; void r;
    c.save();
    c.fillStyle = rgba('graphite', 0.35 * clamp(k * 2));
    for (let y = 30; y < H; y += 40) for (let x = 30; x < W; x += 40) c.fillRect(x, y, 2, 2);
    c.restore();
  }

  /** Title bar, border and scrollbar of the window. */
  drawChrome(c: CanvasRenderingContext2D, f: Frame, r: Rect, k: number) {
    const a = clamp(k * 3);
    const bar = 38;
    c.save();
    c.globalAlpha = a;
    c.fillStyle = rgba('ink2', 1);
    c.fillRect(r.x, r.y - bar, r.w, bar);
    c.strokeStyle = rgba('bone', 0.55);
    c.lineWidth = 1.5;
    c.strokeRect(r.x - 0.75, r.y - bar - 0.75, r.w + 1.5, r.h + bar + 1.5);
    c.fillRect(r.x, r.y - 1, r.w, 1);
    for (let i = 0; i < 3; i++) c.strokeRect(r.x + 16 + i * 22, r.y - bar / 2 - 6, 12, 12);
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '2px';
    c.fillStyle = rgba('bone', 0.9);
    c.textAlign = 'center';
    c.fillText('context_window', r.x + r.w / 2, r.y - bar / 2 + 5);
    c.textAlign = 'right';
    c.fillStyle = rgba('bone', 0.55);
    const st = this.counter.state(f.t);
    c.fillText(`${st.text} / ${formatTokens(LIMIT)}`, r.x + r.w - 16, r.y - bar / 2 + 5);
    c.textAlign = 'left';
    // scrollbar: the thumb sits near the end of the context
    const v = shownValue(this.counter, f.t);
    const frac = Number.isFinite(v) ? clamp(v / LIMIT) : 1;
    c.fillStyle = rgba('ink', 0.25);
    c.fillRect(r.x + r.w - 12, r.y + 6, 6, r.h - 12);
    const th = Math.max(24, (r.h - 12) * 0.12);
    c.fillStyle = rgba('ink', 0.85);
    c.fillRect(r.x + r.w - 12, r.y + 6 + (r.h - 12 - th) * frac, 6, th);
    c.restore();
  }

  /** 0..1 text selection over the line (hook2's exit). */
  selectAmount(t: number) { void t; return 0; }

  /** Drawn over everything (after the window). Subclasses: exits, fragments. */
  drawOverlay(c: CanvasRenderingContext2D, f: Frame, r: Rect) { void c; void f; void r; }

  // ------------------------------------------------------------------ damage

  /** Torn slices: horizontal bands of the finished frame shifted sideways for 2 frames. */
  tear(c: CanvasRenderingContext2D, t: number) {
    const D = this.damage, fi = frameIdx(t) >> 1;
    if (hash(fi, 41) >= 0.2 * D) return;
    const s = c.canvas.width / W;
    const n = 1 + Math.floor(hash(fi, 42) * (1 + 3 * D));
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < n; k++) {
      const y = Math.floor(hash(fi, 43, k) * H), h = Math.floor(10 + hash(fi, 44, k) * 130 * D);
      const dx = (hash(fi, 45, k) - 0.5) * 2 * (60 + 260 * D);
      c.drawImage(c.canvas, 0, y * s, W * s, h * s, dx, y, W, h);
    }
    c.restore();
  }
}

const patterns = new Map<string, CanvasPattern>();
/** A 4 px checker in `color` (cached per colour). */
function shadePattern(c: CanvasRenderingContext2D, color: string): CanvasPattern {
  let p = patterns.get(color);
  if (!p) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const g = cv.getContext('2d')!;
    g.fillStyle = rgba(color, 1);
    g.fillRect(0, 0, 4, 4); g.fillRect(4, 4, 4, 4);
    p = c.createPattern(cv, 'repeat')!;
    patterns.set(color, p);
  }
  return p;
}
