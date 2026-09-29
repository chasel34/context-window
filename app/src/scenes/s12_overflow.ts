// s12 · overflow (Break). BEATSHEET: 计数器数字超出位数，挤破画框，文字从窗口边缘溢出并层层堆叠；
// "O-O-O" 时画面三次故障重复；"Error: maximum length" 用红框报错对话框 → 对话框被点掉，画面全黑。
//
//   cut (break downbeat)  the counter is back, in a bone frame sized for 9 characters, rolling up from
//                         1,048,576 and accelerating; behind it the conversation keeps arriving in a window,
//                         its lines running out past the window's edges. Every 8th note appends a line.
//   ~89.8                 the digits no longer fit: the frame's right edge bulges under them
//   "Overflow!" (#2)      the frame bursts (its border flies apart), the digits run off the right edge
//                         (×10 per beat, counter mode 'overflow'); OVERFLOW! is set wider than the screen;
//                         windows start to stack, one more per beat, each one's text spilling further
//   O- O- O-              three glitch repeats: the whole frame tiles 2×2 / 3×3 / 4×4, torn and split
//   "Overflow!"           counter → OVERFLOW; the text keeps piling up from the bottom of the frame
//   "Error:"              everything freezes and dims; the dialog (signal frame) pops; "maximum", "length"
//                         type in as sung; the pointer comes in and clicks OK on the 8th after "length";
//                         the dialog is dismissed and the frame is black by the cut.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, measure, plain } from '../engine/type';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, pulse } from '../engine/util';
import { TokenCounter } from '../shared/counter';
import { drawOdometer, MONO_ADV, MONO_CAP, shownValue } from '../shared/b_odometer';
import { drawWindow, drawErrorDialog, drawPointer } from '../shared/b_ui';

const DISPLAY = F.display(900);
/** The counter frame: sized for 9 characters ('1,048,576'). */
const DIG = 200;
const BOX = { w: 9 * DIG * MONO_ADV + 96, h: DIG * 1.25 };
const BOX_X = (W - BOX.w) / 2, BOX_Y = H / 2 - BOX.h / 2 + 60;
const WIN = { x: 250, y: 150, w: 1080, h: 580 };

export default class S12Overflow extends Scene {
  L = new Layer2D();
  counter!: TokenCounter;
  /** The sung "Overflow!"s, O- syllables, and "Error: maximum length" words. */
  ovT: number[] = [];
  oT: number[] = [];
  errT: number[] = [];
  burstT = 0; overflowTextT = 0;
  /** 1,048,576 holds for the first bar; then the digits run past the limit. */
  rollT = 0;
  clickT = 0;
  /** The conversation so far (earlier lyrics, as user/assistant lines). */
  history: string[] = [];
  /** 8th-note grid from the cut. */
  e0 = 0;
  private snap: HTMLCanvasElement | null = null;

  override init() {
    const { lyrics, tl, start } = this.ctx;
    this.counter = new TokenCounter(tl);
    const ov = lyrics.get('Overflow! Overflow!');
    const ooo = lyrics.get('O-O-O-Overflow!');
    const err = lyrics.get('Error: maximum length');
    this.ovT = [...ov.words.map((w) => w.start), ooo.words[3]!.start];
    this.oT = ooo.words.slice(0, 3).map((w) => w.start);
    this.errT = err.words.map((w) => w.start);
    this.burstT = ov.words[1]!.start;
    this.overflowTextT = ooo.words[3]!.start;
    // the click lands on the first 8th note after "length" (≈ 99.19), always before the cut
    this.clickT = Math.min(tl.timeOfBeat(Math.ceil(tl.beat(this.errT[2]!) * 2 - 1e-3) / 2), this.ctx.end - 0.16);
    if (this.clickT < this.errT[2]! + 0.005) this.clickT = Math.min(this.errT[2]! + 0.05, this.ctx.end - 0.16);
    const lines = lyrics.lines.filter((l) => l.end < start - 1);
    this.history = lines.map((l, i) => `${i % 3 === 2 ? 'assistant' : 'user'}: ${plain(l.text)}`);
    this.e0 = start;
    this.rollT = tl.timeOfBar(Math.round(tl.bar(start)) + 1);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.L;
    L.clear();
    const c = L.ctx;
    c.textBaseline = 'alphabetic';
    const errOn = t >= this.errT[0]! - 1 / 60;
    const tb = errOn ? this.errT[0]! - 1 / 60 - 1e-3 : t; // the background freezes on "Error:"
    const gone = t >= this.clickT + 0.07; // dismissed: black
    const o: PostOverrides = { counter: 0, bloom: 0.32, bloomThreshold: 0.95, halation: 0.14, vignette: 0.35, grain: 0.06 };

    if (!gone) {
      c.save();
      if (errOn) c.globalAlpha = lerp(1, 0.22, prog(t, this.errT[0]!, this.errT[0]! + 0.12));
      this.drawStack(c, tb);
      this.drawBigWord(c, tb);
      this.drawCounter(c, tb);
      c.restore();
      if (!errOn) this.repeatGlitch(c, t);
      if (errOn) this.drawDialog(c, t);
    }
    comp.draw(renderer, L.upload(), out);

    // post: hits on the Overflow!s, heavy on the O-s, a punch on "Error:"
    const ovHit = tl.pulseAt(t, this.ovT, 0.08);
    const oHit = tl.pulseAt(t, this.oT, 0.06);
    const eHit = errOn ? pulse(t, this.errT[0]!, 0.06) : 0;
    const shake = errOn ? 8 * eHit : 14 * ovHit + 26 * oHit + 6 * this.ctx.audio.hit('kick', t, 0.08);
    o.shake = [noise1(t * 60, 1) * shake, noise1(t * 60, 2) * shake];
    o.zoom = 1 + 0.05 * ovHit + 0.08 * oHit + 0.03 * eHit;
    o.rgbSplit = errOn ? 3 * eHit : 3 + 10 * ovHit + 30 * oHit + 5 * this.ctx.audio.hit('vocal', t, 0.06) + (t > this.burstT ? 4 * tl.beatPulse(t, 0.06) : 0);
    o.flash = 0.25 * oHit;
    o.flashColor = LIN.signal;
    if (gone) { o.rgbSplit = 0; o.shake = [0, 0]; o.zoom = 1; }
    return o;
  }

  // ------------------------------------------------------------------ the windows and their overflowing text

  /** How many windows are stacked at t: 1, then one per "Overflow!" and per beat after the burst (max 11). */
  stackN(t: number) {
    let n = 1;
    if (t >= this.burstT) n += 1 + Math.floor((t - this.burstT) / this.ctx.tl.beatPeriod);
    return Math.min(11, n);
  }

  /** Lines appended so far (one per 8th note from the cut, faster after the burst). */
  linesAt(t: number) {
    const e = (t - this.e0) / (this.ctx.tl.beatPeriod / 2);
    const extra = t > this.burstT ? (t - this.burstT) / (this.ctx.tl.beatPeriod / 4) : 0;
    return 8 + Math.max(0, e) + extra;
  }

  drawStack(c: CanvasRenderingContext2D, t: number) {
    const n = this.stackN(t);
    const lines = this.linesAt(t);
    for (let k = 0; k < n; k++) {
      const age = k === 0 ? 9 : t - (this.burstT + (k - 1) * this.ctx.tl.beatPeriod);
      const pop = k === 0 ? 1 : ease.outBack(clamp(age / 0.12), 1.6);
      const x = WIN.x + k * 58 + (k % 2) * 14, y = WIN.y + k * 42;
      c.save();
      c.translate(x + WIN.w / 2, y + WIN.h / 2); c.scale(lerp(0.9, 1, pop), lerp(0.9, 1, pop)); c.translate(-(x + WIN.w / 2), -(y + WIN.h / 2));
      c.globalAlpha *= clamp(pop * 1.5);
      drawWindow(c, x, y, WIN.w, WIN.h, { title: k === 0 ? 'context_window' : `context_window (${k + 1})`, right: `${Math.min(100, 97 + k * 3)}%`, fill: 'ink2', borderAlpha: 0.5 });
      // the text: not clipped — it runs out of the right edge and below the bottom
      this.drawText(c, x + 26, y + 70, lines - k * 3, t, k);
      c.restore();
    }
    // overflow sediment after "OVERFLOW": lines landing at the bottom of the frame, piling up
    if (t >= this.overflowTextT) {
      const e = (t - this.overflowTextT) / (this.ctx.tl.beatPeriod / 2);
      const rows = Math.min(26, Math.floor(e * 1.5));
      c.font = font(F.mono(500), 26);
      for (let r = 0; r <= rows; r++) {
        const land = r === rows ? ease.outCubic(clamp(e * 1.5 - rows)) : 1;
        const yy = H - 20 - r * 30;
        const y = lerp(-40, yy, land);
        const s = this.history[(r * 7 + 3) % this.history.length]!;
        const txt = (s + '  ' + s + '  ' + s).slice(0, 160);
        const dx = -((r * 137) % 600);
        c.fillStyle = rgba(r % 5 === 0 ? 'signal' : 'bone', r === rows ? 0.9 : 0.35 + 0.25 * hash(r, 4));
        c.fillText(txt, dx, y);
      }
    }
  }

  drawText(c: CanvasRenderingContext2D, x: number, y: number, count: number, t: number, k: number) {
    const size = 22, lh = 34;
    c.save();
    c.font = font(F.mono(400), size);
    const n = Math.floor(count);
    const first = Math.max(0, n - 30);
    for (let i = first; i < n; i++) {
      const s = this.history[(i + k * 5) % this.history.length]!;
      const row = i - first;
      // after a few lines the text runs long: repeats of itself past the window's right edge
      const long = i > 10 + k ? s + '  ' + s.toLowerCase() + '  ' + s : s;
      const typed = i === n - 1 ? long.slice(0, Math.floor(long.length * clamp(count - n + 0.2))) : long;
      const who = s.startsWith('assistant');
      c.fillStyle = rgba(who ? 'ash' : 'bone', i === n - 1 ? 0.95 : 0.62);
      c.fillText(typed, x, y + row * lh);
      if (who) { c.fillStyle = rgba('signal', 0.8); c.fillRect(x - 14, y + row * lh - size * 0.7, 4, size * 0.8); }
    }
    void t;
    c.restore();
  }

  // ------------------------------------------------------------------ OVERFLOW! set wider than the screen

  drawBigWord(c: CanvasRenderingContext2D, t: number) {
    let last = -1;
    for (const x of this.ovT) if (t >= x - 1 / 60) last = x;
    if (last < 0) return;
    const i = this.ovT.indexOf(last);
    const age = t - last;
    const size = [300, 330, 400][i] ?? 330;
    const text = 'OVERFLOW!';
    const w = measure(text, DISPLAY, size);
    const y = [H - 70, 330, H / 2 + size * 0.36][i] ?? 360;
    // slams in at 1.35× the frame width, then keeps running left (out of the frame)
    const x = W * 0.5 - w * 0.42 - age * 420 - (1 - ease.outExpo(clamp(age / 0.25))) * -300;
    const solid = age < 0.35;
    c.save();
    c.font = font(DISPLAY, size);
    if (solid) {
      c.fillStyle = rgba('signal', 1);
      c.fillText(text, x, y);
    } else {
      c.strokeStyle = rgba('signal', 0.8);
      c.lineWidth = 3;
      c.strokeText(text, x, y);
      // stacked outlines, the overflow piling behind
      for (let j = 1; j <= 3; j++) {
        c.strokeStyle = rgba('signal', 0.35 - j * 0.08);
        c.strokeText(text, x + j * 90, y + j * 26);
      }
    }
    c.restore();
  }

  // ------------------------------------------------------------------ the counter and its frame

  drawCounter(c: CanvasRenderingContext2D, t: number) {
    const st = this.counter.state(t);
    const cx = BOX_X + 48, base = BOX_Y + BOX.h / 2 + DIG * MONO_CAP / 2;
    const burst = t >= this.burstT;
    // label
    c.save();
    c.font = font(F.mono(600), 18);
    c.letterSpacing = '6px';
    c.fillStyle = rgba('bone', 0.7);
    c.fillText('CONTEXT · TOKENS', BOX_X, BOX_Y - 22);
    c.textAlign = 'right';
    c.fillStyle = rgba('signal', 0.9);
    const full = t < this.rollT;
    if (full && Math.floor((t - this.ctx.start) / (this.ctx.tl.beatPeriod / 2)) % 2 === 1) c.fillStyle = rgba('bone', 0.5);
    c.fillText(burst ? (st.mode === 'text' ? 'LIMIT EXCEEDED' : 'OVERFLOWING') : full ? 'LIMIT REACHED · 100%' : 'OVER LIMIT', BOX_X + BOX.w, BOX_Y - 22);
    c.restore();

    if (st.mode === 'text') {
      // OVERFLOW: signal, blinking on 8ths, set over the broken frame
      const e = Math.floor((t - this.overflowTextT) / (this.ctx.tl.beatPeriod / 2));
      const on = e % 2 === 0 || t - this.overflowTextT > 1.6;
      c.save();
      c.fillStyle = rgba('ink', 0.85);
      c.fillRect(BOX_X - 20, BOX_Y, BOX.w + 40, BOX.h);
      c.font = font(F.mono(600), DIG * 1.05);
      c.fillStyle = rgba(on ? 'signal' : 'bone', 1);
      c.textAlign = 'center';
      c.fillText('OVERFLOW', W / 2, base + 6);
      c.restore();
      return;
    }
    const v = burst ? st.value : shownValue(this.counter, t);
    const digits = st.text.length;
    const width = digits * DIG * MONO_ADV;
    const over = Math.max(0, cx + width - (BOX_X + BOX.w - 24));
    // the frame: fill, border (bulging right edge before the burst; flying segments after)
    if (!burst) {
      c.fillStyle = rgba('ink', 0.92);
      c.fillRect(BOX_X, BOX_Y, BOX.w, BOX.h);
      const bulge = Math.min(140, over * 0.9);
      c.strokeStyle = rgba('bone', 0.95);
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(BOX_X + BOX.w, BOX_Y);
      c.lineTo(BOX_X, BOX_Y); c.lineTo(BOX_X, BOX_Y + BOX.h); c.lineTo(BOX_X + BOX.w, BOX_Y + BOX.h);
      c.quadraticCurveTo(BOX_X + BOX.w + bulge * 2, BOX_Y + BOX.h / 2, BOX_X + BOX.w, BOX_Y);
      c.stroke();
      // stress ticks on the bulge
      if (bulge > 4) {
        c.strokeStyle = rgba('signal', clamp(bulge / 60));
        c.lineWidth = 2;
        for (let i = 1; i < 6; i++) {
          const yy = BOX_Y + (BOX.h * i) / 6;
          const bx = BOX_X + BOX.w + bulge * 2 * 2 * (i / 6) * (1 - i / 6);
          c.beginPath(); c.moveTo(bx + 6, yy); c.lineTo(bx + 16 + bulge * 0.2, yy); c.stroke();
        }
      }
    } else {
      this.drawShards(c, t);
    }
    // digits: clipped by nothing — past the frame, past the screen
    const s = 1 + 0.06 * pulse(t, st.stepT, 0.08);
    c.save();
    c.translate(cx, base - DIG * MONO_CAP / 2); c.scale(s, s); c.translate(-cx, -(base - DIG * MONO_CAP / 2));
    if (burst) {
      c.font = font(F.mono(500), DIG);
      c.fillStyle = rgba('bone', 1);
      c.fillText(st.text, cx, base);
      // the newest zeros arrive hot
      const k = pulse(t, st.stepT, 0.1);
      c.fillStyle = rgba('signal', k);
      c.fillText(st.text, cx, base);
    } else {
      drawOdometer(c, cx, base, v, { size: DIG, color: rgba(over > 0 ? 'signal' : 'bone', 1), minDigits: 7 });
    }
    c.restore();
  }

  /** The frame's border in pieces, flying out from the burst. */
  drawShards(c: CanvasRenderingContext2D, t: number) {
    const age = t - this.burstT;
    const k = ease.outCubic(clamp(age / 0.9));
    const a = 1 - clamp((age - 0.3) / 0.8);
    if (a <= 0) return;
    const segs: [number, number, number, number][] = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const x0 = BOX_X + (BOX.w * i) / N, x1 = BOX_X + (BOX.w * (i + 1)) / N;
      segs.push([x0, BOX_Y, x1, BOX_Y], [x0, BOX_Y + BOX.h, x1, BOX_Y + BOX.h]);
    }
    for (let i = 0; i < 3; i++) {
      const y0 = BOX_Y + (BOX.h * i) / 3, y1 = BOX_Y + (BOX.h * (i + 1)) / 3;
      segs.push([BOX_X, y0, BOX_X, y1], [BOX_X + BOX.w, y0, BOX_X + BOX.w, y1]);
    }
    c.save();
    c.strokeStyle = rgba('bone', a);
    c.lineWidth = 4;
    segs.forEach(([x0, y0, x1, y1], i) => {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = mx - W / 2 + 200, dy = my - H / 2;
      const d = Math.hypot(dx, dy) || 1;
      const sp = 260 + 600 * hash(i, 11);
      const ox = (dx / d) * sp * k, oy = (dy / d) * sp * k + 300 * k * k;
      const rot = (hash(i, 12) - 0.5) * 4 * k;
      c.save();
      c.translate(mx + ox, my + oy); c.rotate(rot);
      c.beginPath(); c.moveTo(x0 - mx, y0 - my); c.lineTo(x1 - mx, y1 - my); c.stroke();
      c.restore();
    });
    c.restore();
  }

  // ------------------------------------------------------------------ O-O-O: three glitch repeats

  repeatGlitch(c: CanvasRenderingContext2D, t: number) {
    let i = -1;
    for (let j = 0; j < this.oT.length; j++) if (t >= this.oT[j]! - 1 / 60) i = j;
    if (i < 0) return;
    const age = t - this.oT[i]!;
    if (age > 0.16) {
      // between the Os and after: a big O ring left behind, fading
      if (t < this.overflowTextT) this.drawO(c, i, 0.35 * (1 - clamp((age - 0.16) / 0.3)));
      return;
    }
    const n = i + 2; // 2×2, 3×3, 4×4
    const s = c.canvas.width / W;
    if (!this.snap || this.snap.width !== c.canvas.width) {
      this.snap = document.createElement('canvas');
      this.snap.width = c.canvas.width; this.snap.height = c.canvas.height;
    }
    const snap = this.snap;
    const sc = snap.getContext('2d')!;
    sc.clearRect(0, 0, snap.width, snap.height);
    sc.drawImage(c.canvas, 0, 0);
    const fi = frameIdx(t);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = rgba('ink', 1); c.fillRect(0, 0, W, H);
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const jx = (hash(fi, gx, gy) - 0.5) * 40, jy = (hash(fi, gy, gx, 3) - 0.5) * 16;
      c.drawImage(snap, 0, 0, W * s, H * s, (gx * W) / n + jx, (gy * H) / n + jy, W / n, H / n);
    }
    // tears
    for (let k = 0; k < 4 + i * 2; k++) {
      const y = hash(fi, k, 7) * H, h = 8 + hash(fi, k, 8) * 70;
      c.drawImage(c.canvas, 0, y * s, W * s, h * s, (hash(fi, k, 9) - 0.5) * 300, y, W, h);
    }
    c.restore();
    this.drawO(c, i, 1);
  }

  drawO(c: CanvasRenderingContext2D, i: number, a: number) {
    if (a <= 0) return;
    const size = [520, 680, 860][i]!;
    c.save();
    c.font = font(DISPLAY, size);
    c.textAlign = 'center';
    c.lineWidth = 6;
    for (let j = 0; j <= i; j++) {
      const sz = 1 - j * 0.16;
      c.save();
      c.translate(W / 2, H / 2); c.scale(sz, sz);
      if (j === 0 && a >= 1) { c.fillStyle = rgba('signal', a); c.fillText('O', 0, size * 0.375); }
      else { c.strokeStyle = rgba('signal', a * (1 - j * 0.2)); c.strokeText('O', 0, size * 0.375); }
      c.restore();
    }
    c.restore();
  }

  // ------------------------------------------------------------------ Error: maximum length

  drawDialog(c: CanvasRenderingContext2D, t: number) {
    const t0 = this.errT[0]!;
    const words = this.errT.filter((x) => t >= x - 1 / 60).length;
    const pop = ease.outBack(clamp((t - t0 + 1 / 60) / 0.14), 1.8);
    const close = prog(t, this.clickT + 0.02, this.clickT + 0.07, ease.inCubic);
    const s = 1.3 * lerp(0.86, 1, pop) * (1 - 0.08 * close);
    const cx = W / 2, cy = H / 2 - 10;
    // the pointer: comes in after "maximum", reaches OK by the click
    const press = t >= this.clickT && t < this.clickT + 0.07 ? 1 : 0;
    c.save();
    c.globalAlpha = 1 - close;
    c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy);
    const ok = drawErrorDialog(c, cx, cy, { words, press, focus: prog(t, this.errT[2]!, this.errT[2]! + 0.05) });
    c.restore();
    // OK in screen space (the dialog is scaled about its centre)
    const tx = cx + (ok.x + ok.w * 0.55 - cx) * s, ty = cy + (ok.y + ok.h * 0.55 - cy) * s;
    const mv = prog(t, this.errT[1]! + 0.1, this.clickT - 0.02, ease.inOutCubic);
    if (mv > 0 && close < 1) {
      const px = lerp(W + 60, tx, mv) + Math.sin(mv * Math.PI) * -40;
      const py = lerp(H * 0.86, ty, mv) + Math.sin(mv * Math.PI) * 60;
      drawPointer(c, px, py, 1.2 * (1 - 0.1 * press));
    }
    // a system-font-free hairline shadow of the frozen counter, top right (the HUD is ours here)
    c.save();
    c.font = font(F.mono(500), 30);
    c.textAlign = 'right';
    c.fillStyle = rgba('signal', 0.8 * (1 - close));
    c.fillText('OVERFLOW', W - 64, 104);
    c.restore();
  }
}
