// s02 · system (3.6 – 14.6 s). BEATSHEET: 巨大的衬线斜体 "You are a helpful assistant!"。"helpful" 重复时
// 开始口吃、错位，复制出 3 层 → 文字折叠成一行，被推到画面顶端，成为第一条消息.
//
//   pass 1 (3.58)  the prompt is a ghost; each sung word lights signal with a pop, then cools to bone
//   pass 2 (6.78)  lit again; on "helpful" the word starts to stutter (frame jitter); when it ends,
//                  "assistant!" is backspaced away and a dash cuts the sentence: "helpful—"
//   pass 3 (8.26)  "helpful—helpful—" is typed on row 2; each "helpful" adds a misregistered layer
//                  (signal fill, bone outline): 3 layers. Through the ad-libs the layers slip out of
//                  register on every vocal hit, wider each time
//   13.39          everything snaps back into register, "assistant!" is retyped (the prompt restores)
//   13.79 → 14.59  the fold: the two rows fold into one line, which is pushed to the top of the frame
//                  and becomes the chat's system message (s03's first frame)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, prog } from '../engine/util';
import { drawCursor } from '../shared/cursor';
import { VerseConvo } from '../shared/a_convo';
import {
  applyCam, drawSysFold, drawSysMeta, drawSysWords, kOf, SYS, sysLayout, sysPop, sysWordColor, type SysWordTiming,
} from '../shared/a_ui';

export default class S02System extends Scene {
  layer = new Layer2D();
  convo!: VerseConvo;
  L0!: Line; L1!: Line; L2!: Line;
  /** Misregistration events (layer offsets snap on each). */
  hits: number[] = [];
  tBreak = 0; // "assistant!" backspaced, dash appears
  tFix = 0; // back into register
  tFold0 = 0; tFold1 = 0; tFold2 = 0;
  target = { x: 0, y: 0, w: 0 };

  override init() {
    const { lyrics, tl, audio, end } = this.ctx;
    this.convo = new VerseConvo(this.ctx);
    this.L0 = lyrics.get('You are a helpful assistant!', 0);
    this.L1 = lyrics.get('You are a helpful—', 0);
    this.L2 = lyrics.get('helpful—helpful—', 0);
    this.tBreak = this.L1.words[3]!.end;
    // the fold sits on the last two beats; re-register one beat before it
    this.tFold1 = tl.timeOfBeat(Math.round(tl.beat(end)) - 1);
    this.tFold0 = tl.timeOfBeat(Math.round(tl.beat(end)) - 2);
    this.tFix = tl.timeOfBeat(Math.round(tl.beat(end)) - 3);
    this.tFold2 = end - 0.08;
    const vox = audio.events('vocal', this.L2.end, this.tFix - 0.1).filter(([, s]) => s >= 0.3).map(([t]) => t);
    this.hits = [...this.L2.words.map((w) => w.start), ...vox];
    this.target = this.convo.systemTarget(end);
  }

  /** Timing of block word i (0..4) at t: the latest pass that has sung it. */
  private timing(i: number, t: number): SysWordTiming | undefined {
    let tm: SysWordTiming | undefined;
    const w0 = this.L0.words[i];
    if (w0 && t >= w0.start) tm = w0;
    const w1 = i < 4 ? this.L1.words[i] : undefined;
    if (w1 && t >= w1.start) tm = w1;
    if (i === 3) for (const w of this.L2.words) if (t >= w.start) tm = w;
    return tm;
  }

  /** Magenta cools back to bone: after pass 1, and before the fold. */
  private coolAt(i: number, t: number) {
    if (t < this.L1.words[0]!.start - 0.05) return this.L0.end + 0.35;
    // once the layers split, the base layer cools to bone and the signal layer carries the colour
    if (t >= this.L2.words[0]!.start) return this.L2.words[0]!.start + 0.1;
    return this.tFix;
  }

  /** Layer offset (px) for misregistration layer `layer` (1 or 2) at t. */
  private offset(layer: number, t: number): [number, number] {
    let j = -1;
    for (let k = 0; k < this.hits.length; k++) if (this.hits[k]! <= t) j = k;
    if (j < 0) return [0, 0];
    const amp = lerp(1, 1.5, prog(t, this.hits[0]!, this.tFix)) * (1 - ease.inOutExpo(prog(t, this.tFix, this.tFix + 0.3)));
    const tgt = (k: number): [number, number] => {
      if (k < 0) return [0, 0];
      const sx = hash(k, layer, 1) < 0.5 ? -1 : 1;
      return [sx * (12 + 26 * hash(k, layer, 2)) * (layer === 2 ? -1 : 1), (hash(k, layer, 3) - 0.5) * 30];
    };
    const a = tgt(j - 1), b = tgt(j);
    const e = ease.outExpo(clamp((t - this.hits[j]!) / 0.07));
    return [lerp(a[0], b[0], e) * amp, lerp(a[1], b[1], e) * amp];
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl, start } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const lay = sysLayout();
    const fi = frameIdx(t);

    // camera: a slow push, a punch on every misregistration hit, released for the fold
    const k1 = kOf(t, this.tFold0, this.tFold1), k2 = kOf(t, this.tFold1, this.tFold2);
    const punch = 0.035 * tl.pulseAt(t, this.hits, 0.09) + 0.02 * tl.pulseAt(t, [this.L1.words[3]!.start], 0.08);
    const push = 0.07 * ease.inOutQuad(prog(t, start, this.tFix)) * (1 - ease.inOutExpo(prog(t, this.tFix, this.tFold1)));
    const cy = (SYS.y[0]! + SYS.y[1]!) / 2 - SYS.size * 0.3;
    applyCam(c, { x: 960, y: lerp(cy, 540, ease.inOutCubic(prog(t, this.tFix, this.tFold0))), zoom: 1 + push + punch });

    const nTok = this.L0.words.filter((w) => t >= w.start).length + this.L1.words.filter((w) => t >= w.start).length + this.L2.words.filter((w) => t >= w.start).length;
    const coolAll = (i: number) => this.coolAt(i, t);
    const color = (i: number, ghost = 0.16, alpha = 1) => sysWordColor(this.timing(i, t), t, ghost, coolAll(i), alpha);

    if (k1 <= 0) {
      drawSysMeta(c, t, nTok, prog(t, start, start + 0.25), ease.outExpo(prog(t, start, start + 0.6)));
      // "assistant!": backspaced after pass 2's "helpful", retyped when the prompt restores
      const aTxt = 'assistant!';
      const erased = Math.floor(aTxt.length * clamp((t - this.tBreak) / 0.28));
      const retyped = Math.floor(aTxt.length * clamp((t - this.tFix) / 0.25));
      const aShown = t < this.tFix ? aTxt.slice(0, aTxt.length - erased) : aTxt.slice(0, retyped);
      const stut = t >= this.L1.words[3]!.start && t < this.tFix;
      const jitter = (i: number) => (i === 3 && stut && hash(fi >> 1, 7) < 0.55 ? (hash(fi >> 1, 9) - 0.5) * 26 : 0);
      const text = (i: number) => (i === 4 ? aShown : lay.words[i]!.text);
      const nLayers = 1 + (t >= this.L2.words[0]!.start ? 1 : 0) + (t >= this.L2.words[1]!.start ? 1 : 0);
      const regFade = 1 - prog(t, this.tFix, this.tFix + 0.3);
      // layer 3: bone outline
      if (nLayers >= 3 && regFade > 0) {
        drawSysWords(c, (i) => (i === 4 && !aShown ? null : rgba('bone', 0.55 * regFade)), { mode: 'stroke', lineWidth: 1.6, off: this.offset(2, t), text, scale: (i) => sysPop(this.timing(i, t), t) });
      }
      // layer 2: signal fill, added light
      if (nLayers >= 2 && regFade > 0) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        drawSysWords(c, (i) => (i === 4 && !aShown ? null : rgba('signal', 0.7 * regFade)), { off: this.offset(1, t), text, scale: (i) => sysPop(this.timing(i, t), t) });
        c.restore();
      }
      // base layer
      drawSysWords(c, (i) => (i === 4 && !aShown ? null : color(i)), { text, scale: (i) => sysPop(this.timing(i, t), t), off: [0, 0], rise: (i) => (i === 3 ? 0 : 0) });
      // jitter copy of "helpful" while it stutters (1–2 frame offsets)
      if (stut) {
        const jx = jitter(3);
        if (jx !== 0) drawSysWords(c, (i) => (i === 3 ? rgba('signal', 0.5) : null), { off: [jx, 0] });
      }
      // the cut: "helpful—" with a cursor sitting in the wound
      const dashK = t >= this.tBreak && t < this.tFix ? ease.outExpo(prog(t, this.tBreak, this.tBreak + 0.12)) : 0;
      const hw = lay.words[3]!;
      if (dashK > 0) {
        c.font = font(SYS.family, SYS.size);
        c.fillStyle = color(3) ?? rgba('bone');
        c.save();
        c.beginPath(); c.rect(hw.x + hw.w, hw.y - SYS.size, SYS.size * 0.9 * dashK, SYS.size * 1.3); c.clip();
        c.fillText('—', hw.x + hw.w + 6, hw.y);
        c.restore();
      }
      // row 2 while broken: "helpful—helpful—", typed on the sung words
      if (t >= this.L2.words[0]!.start && t < this.tFix) {
        const row2 = this.L2.words.map((w) => ({ w, txt: 'helpful—' }));
        c.font = font(SYS.family, SYS.size);
        const ww = c.measureText('helpful—').width;
        const x0 = 960 - ww;
        row2.forEach(({ w, txt }, k) => {
          if (t < w.start) return;
          const pop = sysPop(w, t);
          const col = sysWordColor(w, t, 0, w.end + 0.15) ?? rgba('bone');
          const bx = x0 + k * ww, by = SYS.y[1]!;
          for (const [layer, style] of [[2, 'stroke'], [1, 'lighter'], [0, 'fill']] as const) {
            if (layer > nLayers - 1) continue;
            const [ox, oy] = layer === 0 ? [0, 0] : this.offset(layer, t);
            c.save();
            c.translate(bx + ww / 2 + ox, by - SYS.size * 0.3 + oy);
            c.scale(pop, pop);
            if (style === 'stroke') { c.strokeStyle = rgba('bone', 0.55); c.lineWidth = 1.6; c.strokeText(txt, -ww / 2, SYS.size * 0.3); }
            else if (style === 'lighter') { c.globalCompositeOperation = 'lighter'; c.fillStyle = rgba('signal', 0.7); c.fillText(txt, -ww / 2, SYS.size * 0.3); }
            else { c.fillStyle = col; c.fillText(txt, -ww / 2, SYS.size * 0.3); }
            c.restore();
          }
        });
        // cursor after the last typed dash, blinking on the beat
        const last = row2.filter(({ w }) => t >= w.start).length;
        drawCursor(c, x0 + last * ww + 12, SYS.y[1]!, SYS.size * 0.8, t, tl, {});
      } else if (t >= this.tBreak && t < this.tFix) {
        drawCursor(c, hw.x + hw.w + SYS.size * 0.9 * dashK + 10, hw.y, SYS.size * 0.8, t, tl, { on: true });
      } else if (t < this.tBreak && t >= this.L0.end) {
        // between the passes the cursor waits after "assistant!"
        const aw = lay.words[4]!;
        drawCursor(c, aw.x + aw.w + 16, aw.y, SYS.size * 0.8, t, tl, {});
      }
    } else {
      // ---- the fold: two rows → one line → the system message at the top
      c.setTransform(1, 0, 0, 1, 0, 0);
      // hard swap serif → mono once the folded line has landed on the message (inOutExpo is ≥ 99% there
      // at k2 = 0.85): a crossfade between the two faces reads as ghosted, doubled text
      const msgK = t >= lerp(this.tFold1, this.tFold2, 0.85) ? 1 : 0;
      drawSysFold(c, (i) => color(i, 0), k1, k2, this.target, 1 - msgK);
      // flash line on the fold's crease
      const crease = Math.sin(Math.PI * clamp(k1)) * (1 - k2);
      if (crease > 0.01) {
        c.fillStyle = mixRGBA('signal', 'signalHot', 0.3, 0.5 * crease);
        c.fillRect(960 - 900 * crease, (SYS.y[0]! + SYS.y[1]!) / 2 - SYS.size * 0.28, 1800 * crease, 2);
      }
      if (msgK > 0) {
        c.save();
        c.globalAlpha = msgK;
        applyCam(c, this.convo.cam(this.ctx.end));
        this.convo.drawMessages(c, t, this.convo.cam(this.ctx.end));
        c.restore();
      }
    }

    comp.draw(renderer, L.upload(), out);
    const hit = tl.pulseAt(t, this.hits, 0.08);
    return {
      bloom: 0.75 + 0.5 * hit,
      rgbSplit: 5 * hit * (t < this.tFix ? 1 : 0),
      rgbSplitAngle: 0.3,
      vignette: 0.42,
    };
  }
}
