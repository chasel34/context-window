// Shared pieces of scenes s01–s04, s15, s16 (owner: the s01/s02/s03/s04/s15/s16 author).
//   - BOOT: the loop seam. s01 frame 0 and the last frames of s16 show the same lit cursor at the
//     same spot with the same post settings.
//   - Camera: a 2D camera (focus point, zoom, roll) applied as a Canvas2D transform.
//   - The system prompt block "You are a helpful assistant!" in giant Cormorant italic: s02 and s16
//     share the layout (BEATSHEET: s16 repeats s02's typography exactly) and the fold into one line
//     that becomes the chat's system message.
import type { Timeline } from '../timeline';
import type { PostOverrides } from '../engine/scene';
import { W, H } from '../engine/gl';
import { F, font, measure, glyphX } from '../engine/type';
import { rgba, mixRGBA } from '../engine/palette';
import { clamp, ease, lerp, prog } from '../engine/util';
import { cursorOn } from './cursor';

// ------------------------------------------------------------------------------------ loop seam

/** The boot cursor: left edge x, baseline y, font size (the rect is centred on the frame). */
export const BOOT = { size: 72, x: W / 2 - 72 * 0.16, y: H / 2 + 72 * 0.28 };

/**
 * Is the boot cursor lit at t? Beat blink, forced on before the first beat (s01 frame 0) and for the
 * last 0.3 s of the song, so the last frame and frame 0 agree.
 */
export function bootLit(t: number, tl: Timeline) {
  if (t < tl.timeOfBeat(0) || t > tl.duration - 0.3) return true;
  return cursorOn(t, tl);
}

/** Post settings at the seam (s01 head, s16 tail). */
export const BOOT_POST: PostOverrides = { counter: 0, bloom: 0.55, bloomThreshold: 0.8, vignette: 0.4, halation: 0.22 };

// ------------------------------------------------------------------------------------ camera

export interface Cam {
  /** World point at the frame centre. */
  x: number;
  y: number;
  zoom: number;
  /** Roll (radians). */
  rot?: number;
}

export const CAM0: Cam = { x: W / 2, y: H / 2, zoom: 1, rot: 0 };

/** Set the Canvas2D transform so world (cam.x, cam.y) lands at the frame centre. */
export function applyCam(c: CanvasRenderingContext2D, cam: Cam) {
  const r = cam.rot ?? 0;
  const cs = Math.cos(r) * cam.zoom, sn = Math.sin(r) * cam.zoom;
  c.setTransform(cs, sn, -sn, cs, W / 2 - (cs * cam.x - sn * cam.y), H / 2 - (sn * cam.x + cs * cam.y));
}

export function toScreen(cam: Cam, x: number, y: number) {
  const r = cam.rot ?? 0;
  const cs = Math.cos(r) * cam.zoom, sn = Math.sin(r) * cam.zoom;
  return { x: cs * (x - cam.x) - sn * (y - cam.y) + W / 2, y: sn * (x - cam.x) + cs * (y - cam.y) + H / 2 };
}

export function lerpCam(a: Cam, b: Cam, k: number): Cam {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)), rot: lerp(a.rot ?? 0, b.rot ?? 0, k) };
}

// ------------------------------------------------------------------------------------ system prompt block

export const SYS_TEXT = 'You are a helpful assistant!';
export const SYS = {
  family: F.oracle(500),
  size: 212,
  rows: ['You are a helpful', 'assistant!'],
  /** Baselines of the two rows. */
  y: [498, 690],
  /** Single-line width the fold squeezes the text into. */
  foldW: 1640,
};

export interface SysWord { text: string; row: number; x: number; y: number; w: number }

let sysCache: { words: SysWord[]; rows: { x: number; y: number; w: number }[]; line: { x: number[]; w: number; scale: number } } | null = null;

/** Layout of the block (same in s02 and s16): per word box, rows, and the folded single-line positions. */
export function sysLayout() {
  if (sysCache) return sysCache;
  const { family, size } = SYS;
  const words: SysWord[] = [];
  const rows = SYS.rows.map((txt, r) => {
    const w = measure(txt, family, size);
    const x = W / 2 - w / 2;
    let i = 0;
    for (const wd of txt.split(' ')) {
      const x0 = x + glyphX(txt, i, family, size), x1 = x + glyphX(txt, i + wd.length, family, size);
      words.push({ text: wd, row: r, x: x0, y: SYS.y[r]!, w: x1 - x0 });
      i += wd.length + 1;
    }
    return { x, y: SYS.y[r]!, w };
  });
  // folded: one line, fitted to foldW, centred on the block's middle
  const lw = measure(SYS_TEXT, family, size);
  const scale = Math.min(1, SYS.foldW / lw);
  let i = 0;
  const lx: number[] = [];
  for (const wd of SYS_TEXT.split(' ')) { lx.push(W / 2 - (lw * scale) / 2 + glyphX(SYS_TEXT, i, family, size) * scale); i += wd.length + 1; }
  sysCache = { words, rows, line: { x: lx, w: lw * scale, scale } };
  return sysCache;
}

/** Word state for the block: when each of the 5 words is sung (start, end), or undefined. */
export interface SysWordTiming { start: number; end: number }

/**
 * Colour of block word i at t: a ghost (bone at `ghost` alpha) before it's sung, hot magenta on its
 * start, magenta while/after sung; `coolAt` returns sung words to bone over 0.6 s.
 */
export function sysWordColor(tm: SysWordTiming | undefined, t: number, ghost: number, coolAt = Infinity, alpha = 1): string | null {
  if (!tm || t < tm.start) return ghost > 0 ? rgba('bone', ghost * alpha) : null;
  const flash = Math.pow(0.5, (t - tm.start) / 0.06);
  const cool = prog(t, coolAt, coolAt + 0.6, ease.inOutQuad);
  if (cool > 0) return mixRGBA('signal', 'bone', cool, alpha);
  return flash > 0.25 ? mixRGBA('signal', 'signalHot', flash, alpha) : rgba('signal', alpha);
}

/** Pop scale of a word on its start (1.07 → 1, outBack). */
export function sysPop(tm: SysWordTiming | undefined, t: number) {
  if (!tm || t < tm.start) return 1;
  const k = clamp((t - tm.start) / 0.3);
  return 1 + 0.07 * (1 - ease.outBack(k, 2.2));
}

/**
 * Draw the block's words. `color(i)` gives each word's fill (null = skip); `mode` 'fill' | 'stroke';
 * `off` offsets everything (misregistration layers); `scale(i)` per-word pop; `rise(i)` per-word y offset.
 */
export function drawSysWords(c: CanvasRenderingContext2D, color: (i: number) => string | null, o: { mode?: 'fill' | 'stroke'; off?: [number, number]; scale?: (i: number) => number; rise?: (i: number) => number; text?: (i: number) => string; lineWidth?: number } = {}) {
  const lay = sysLayout();
  const { family, size } = SYS;
  c.save();
  c.font = font(family, size);
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  if (o.mode === 'stroke') { c.lineWidth = o.lineWidth ?? 2; c.lineJoin = 'round'; }
  const [ox, oy] = o.off ?? [0, 0];
  lay.words.forEach((w, i) => {
    const col = color(i);
    if (!col) return;
    const s = o.scale ? o.scale(i) : 1;
    const txt = o.text ? o.text(i) : w.text;
    const cx = w.x + w.w / 2 + ox, cy = w.y - size * 0.3 + oy + (o.rise ? o.rise(i) : 0);
    c.save();
    c.translate(cx, cy);
    if (s !== 1) c.scale(s, s);
    if (o.mode === 'stroke') { c.strokeStyle = col; c.strokeText(txt, -w.w / 2, size * 0.3); } else { c.fillStyle = col; c.fillText(txt, -w.w / 2, size * 0.3); }
    c.restore();
  });
  c.restore();
}

/** The small "system:" label above the block, a hairline rule and the prompt's token tally. */
export function drawSysMeta(c: CanvasRenderingContext2D, t: number, nTok: number, alpha = 1, build = 1) {
  const lay = sysLayout();
  const x0 = Math.min(lay.rows[0]!.x, lay.rows[1]!.x) - 10;
  const x1 = Math.max(lay.rows[0]!.x + lay.rows[0]!.w, lay.rows[1]!.x + lay.rows[1]!.w) + 10;
  const y = SYS.y[0]! - SYS.size * 0.98;
  c.save();
  c.globalAlpha *= alpha;
  c.font = font(F.mono(500), 26);
  c.letterSpacing = '5px';
  c.textBaseline = 'alphabetic';
  c.fillStyle = rgba('signal', 1);
  c.fillText('system:', x0, y);
  c.letterSpacing = '0px';
  c.fillStyle = rgba('bone', 0.22);
  const rx = x0 + 180;
  c.fillRect(rx, y - 9, (x1 - rx) * build, 1);
  c.font = font(F.mono(400), 17);
  c.fillStyle = rgba('ash', 0.7);
  c.textAlign = 'right';
  c.fillText(`${String(nTok).padStart(2, '0')} tok`, x1, y - 18);
  c.textAlign = 'left';
  // baseline hairlines under the rows
  c.fillStyle = rgba('bone', 0.06);
  for (const r of lay.rows) c.fillRect(x0, r.y + 2, (x1 - x0) * build, 1);
  // row numbers in the margin
  c.font = font(F.mono(400), 16);
  c.fillStyle = rgba('graphite', 0.9);
  lay.rows.forEach((r, i) => c.fillText(String(i + 1).padStart(2, '0'), x0 - 70, r.y));
  void t;
  c.restore();
}

/**
 * The fold (s02 end, s16): k1 0..1 folds the two rows into one fitted line at the block's centre;
 * k2 0..1 carries that line to `target` (text left x, baseline y, width) — where the chat's system
 * message sits — shrinking it. `color(i)` per word as in drawSysWords. Returns the line's current
 * width/alpha so the caller can cross-fade the real message in.
 */
export function drawSysFold(c: CanvasRenderingContext2D, color: (i: number) => string | null, k1: number, k2: number, target: { x: number; y: number; w: number }, alpha = 1) {
  const lay = sysLayout();
  const { family, size } = SYS;
  const e1 = ease.inOutExpo(clamp(k1));
  const e2 = ease.inOutExpo(clamp(k2));
  const midY = (SYS.y[0]! + SYS.y[1]!) / 2 + size * 0.02;
  // single line at the centre: scale lay.line.scale; then to the target
  const s1 = lerp(1, lay.line.scale, e1);
  const lineX0 = lay.line.x[0]!;
  const tScale = target.w / lay.line.w; // relative to the folded line
  c.save();
  c.globalAlpha *= alpha;
  c.font = font(family, size);
  c.textBaseline = 'alphabetic';
  lay.words.forEach((w, i) => {
    const col = color(i);
    if (!col) return;
    // block → centre line
    const fx = lay.line.x[i]!, fy = midY;
    let x = lerp(w.x, fx, e1), y = lerp(w.y, fy, e1);
    // row B folds up from below: a vertical squash while it travels
    const squash = 1 - 0.7 * Math.sin(Math.PI * e1) * (w.row === 1 ? 1 : 0.35);
    let s = s1;
    // centre line → target
    if (e2 > 0) {
      const tx = target.x + (fx - lineX0) * tScale, ty = target.y;
      x = lerp(fx, tx, e2); y = lerp(fy, ty, e2);
      s = lay.line.scale * Math.exp(lerp(0, Math.log(tScale), e2));
    }
    c.save();
    c.translate(x, y);
    c.scale(s, s * squash);
    c.fillStyle = col;
    c.fillText(w.text, 0, 0);
    c.restore();
  });
  c.restore();
}

/** Time-to-progress helper for folds: k over [t0, t1]. */
export const kOf = (t: number, t0: number, t1: number) => clamp((t - t0) / (t1 - t0));
