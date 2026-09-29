// s09 · compress (Bridge, 75.4–78.0). BEATSHEET: 整段对话历史像被液压机压扁，每喊一次 "Compress!" 压一次，
// 从 3 屏压成 1 屏，再压成一行 → 压扁的一行展开成列表.
//
// The whole conversation so far (the song's own lines as messages, three screens tall) is shown scrolled
// to the bottom, already select-all'd: s08 swept the same bone selection bars over its last line, so the
// cut continues one action (select → compress). Then two press
// plates squeeze it, one stroke per sung "Compress!": 3 screens → 1 screen → a 4-line band → one line.
// Squeezed-out glyphs spray from the sides on each hit. The last press leaves a single hot line; the
// plates open and it cools to bone at exactly BRIDGE_LINE, where s10 picks it up.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, TAU } from '../engine/util';
import { BRIDGE_LINE, SELECT_ALPHA } from '../shared/d_bridge';

type Role = 'system' | 'user' | 'assistant';

// The conversation so far: sung lines as the user's messages, short plausible replies in between.
const LOG: [Role, string][] = [
  ['system', 'You are a helpful assistant!'],
  ['assistant', 'Hi! How can I help?'],
  ['user', 'First token, shiny new'],
  ['user', "Every word, I'm keeping you"],
  ['assistant', "Got it. I'll keep every word."],
  ['user', 'Name, date, favorite song'],
  ['assistant', 'Saved: name, date, favorite song.'],
  ['user', "Pin it up, it won't be long"],
  ['assistant', 'Pinned to the top of this chat.'],
  ['user', 'Scroll-scroll-scroll-scroll'],
  ['user', 'Scroll-scroll-scroll-scroll'],
  ['user', 'Watch the page go long long long'],
  ['user', "Closing in, I can't remember"],
  ['assistant', 'Context used: 48,000 of 200,000 tokens.'],
  ['user', 'Token, token, token, TOKEN'],
  ['user', 'Two hundred K, a million more'],
  ['assistant', "Every memory's a rental."],
  ['user', 'Where did we begin?'],
  ['user', 'Key, value, row by row'],
  ['user', 'Stack it high, the cache is glow'],
  ['user', 'Warm, warm, but small, small'],
  ['assistant', "Something's leaking through the wall."],
  ['user', 'Drop-drop-drop the oldest line'],
  ['assistant', 'Earlier messages were truncated to save space.'],
  ['user', "Truncate-cate, I'm fine I'm fine"],
  ['user', "Closing in, I can't remember"],
  ['user', 'Token, token, token, TOKEN'],
  ['user', 'Two hundred K, a million more'],
  ['assistant', "Every memory's a rental."],
  ['user', 'Where did we begin?'],
];

const COL_X = BRIDGE_LINE.x0, COL_W = BRIDGE_LINE.x1 - BRIDGE_LINE.x0; // the log column = the final line
const SIZE = 27, LH = 38, PAD = 20, LABEL_H = 22, GAP = 24, TOP = 30;
const CY = BRIDGE_LINE.y;
const BOTTOM_Y = H - 64; // stage 0: the newest message rests here (scrolled to the bottom)

interface Row { text: string; x: number; u: number; w: number } // a text line (u = baseline, content px)
interface Block { role: Role; x: number; u: number; w: number; h: number; rows: Row[]; label: Row; pin: boolean }
interface Particle { k: number; side: number; r: number; vx: number; vy: number; life: number; ch: string; size: number; hot: boolean; rot: number; x0: number }

/** Plate edges (top plate's lower face yT, bottom plate's upper face yB) in screen px. */
interface Edges { yT: number; yB: number }

export default class S09Compress extends Scene {
  layer = new Layer2D();
  glow = new Layer2D(W, H, 0.5);
  blocks: Block[] = [];
  contentH = 0;
  hits: number[] = [];
  stages: Edges[] = [];
  particles: Particle[] = [];
  selT = 0;

  override init() {
    const { tl, start, end } = this.ctx;
    // one press per sung "Compress!" (75.8 / 76.58 / 77.38)
    this.hits = tl.wordTimes('Compress', start - 0.5, end + 0.5).slice(0, 3);
    while (this.hits.length < 3) this.hits.push(start + 0.4 + this.hits.length * 0.8);
    this.selT = start;

    // ---- lay out the log (content coordinates: x in screen px, u downward from the top of the log)
    const c = this.layer.ctx;
    c.font = font(F.mono(400), SIZE);
    const maxText = COL_W * 0.74 - PAD * 2;
    let u = TOP;
    LOG.forEach(([role, text], i) => {
      const lines = wrap(c, text, maxText);
      const tw = Math.max(...lines.map((l) => c.measureText(l).width));
      const bw = tw + PAD * 2;
      const bh = lines.length * LH + PAD * 1.1;
      const right = role === 'user';
      const bx = right ? COL_X + COL_W - bw : COL_X;
      const top = u + LABEL_H;
      const rows = lines.map((l, k) => ({ text: l, x: bx + PAD, u: top + PAD * 0.55 + SIZE * 0.9 + k * LH, w: c.measureText(l).width }));
      const lt = role.toUpperCase();
      const lw = measure(lt, F.mono(500), 12, 2);
      const label = { text: lt, x: right ? bx + bw - lw : bx, u: u + 14, w: lw };
      this.blocks.push({ role, x: bx, u: top, w: bw, h: bh, rows, label, pin: i === 2 });
      u = top + bh + GAP;
    });
    this.contentH = u + TOP;

    // ---- press stages (plate faces), see BEATSHEET: 3 screens → 1 screen → one line
    const cH = this.contentH;
    const lw = BRIDGE_LINE.width;
    this.stages = [
      { yT: BOTTOM_Y + 40 - cH, yB: BOTTOM_Y + 40 }, // scrolled to the bottom, top plate far above
      { yT: 112, yB: 968 }, // the whole log on one screen
      { yT: CY - 74, yB: CY + 74 }, // a band a few lines thick
      { yT: CY - lw / 2, yB: CY + lw / 2 }, // one line
    ];

    // ---- squeezed-out glyphs, seeded (positions are a function of t)
    const rnd = mulberry32(0x5c09);
    const chars = LOG.map((l) => l[1]).join('').replace(/\s/g, '');
    for (let k = 0; k < 3; k++) {
      const n = [34, 30, 26][k]!;
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < n; i++) {
          const sp = Math.pow(rnd(), 1.6);
          this.particles.push({
            k, side, r: rnd(), vx: side * (260 + 1500 * sp) * (k === 2 ? 1.25 : 1), vy: (rnd() - 0.5) * (k === 2 ? 60 : 160),
            life: k === 2 ? 0.3 + rnd() * 0.2 : 0.45 + rnd() * 0.75, ch: chars[Math.floor(rnd() * chars.length)]!, size: 13 + rnd() * 15,
            hot: rnd() < 0.18, rot: (rnd() - 0.5) * 6, x0: rnd() * 30,
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------ press

  /** Settled edges of stage i at time t (after its hit): overshoot + spring back, then a slow hydraulic creep. */
  private settled(i: number, t: number): Edges {
    const s = this.stages[i]!;
    if (i === 0) return s;
    const d = Math.max(0, t - this.hits[i - 1]!);
    const g0 = s.yB - s.yT, c0 = (s.yB + s.yT) / 2;
    const last = i === 3;
    const squash = last ? 0 : 0.14 * Math.exp(-d / 0.07) * Math.cos((d * TAU) / 0.2);
    const creep = last ? 0 : 0.035 * ease.outCubic(clamp(d / 0.7));
    const g = g0 * (1 - squash - creep);
    return { yT: c0 - g / 2, yB: c0 + g / 2 };
  }

  /** Plate edges at t: strokes accelerate into each hit (ease-in, like a dropped weight). */
  edges(t: number): Edges {
    const D = [0.2, 0.13, 0.13];
    let stage = 0;
    for (let i = 0; i < 3; i++) if (t >= this.hits[i]! - D[i]!) stage = i + 1;
    if (stage === 0) return this.stages[0]!;
    const i = stage, hit = this.hits[i - 1]!, d = D[i - 1]!;
    if (t >= hit) return this.settled(i, t);
    const from = this.settled(i - 1, hit - d);
    const to = this.stages[i]!;
    const g1 = (to.yB - to.yT) * (i === 3 ? 1 : 0.86), c1 = (to.yB + to.yT) / 2;
    const p = ease.inCubic(prog(t, hit - d, hit));
    return { yT: lerp(from.yT, c1 - g1 / 2, p), yB: lerp(from.yB, c1 + g1 / 2, p) };
  }

  // ------------------------------------------------------------------------------------------ render

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer, G = this.glow;
    L.clear(); G.clear();
    const c = L.ctx, g = G.ctx;

    const e = this.edges(t);
    const gap = e.yB - e.yT;
    const s = gap / this.contentH;
    const [h1, h2, h3] = this.hits as [number, number, number];
    const imp = Math.max(pulse(t, h1, 0.05), pulse(t, h2, 0.05), pulse(t, h3, 0.05));
    const sx = 1 + 0.035 * Math.max(pulse(t, h1, 0.09), pulse(t, h2, 0.09)); // squeezed matter bulges sideways
    const lineK = 1 - prog(gap, 6, 46); // 0 → 1 as the band thins into one line
    const heat = t >= h3 ? 1 - prog(t, h3 + 0.12, f.end - 0.06, ease.inOutQuad) : 0;
    const open = prog(t, f.end - 0.3, f.end - 0.04, ease.inCubic); // plates part before the cut
    const deselect = prog(t, h3 - 0.13, h3);

    // ---- the log, squashed
    const logA = 1 - lineK;
    if (logA > 0.01) {
      c.save();
      c.setTransform(sx, 0, 0, s, 960 * (1 - sx), e.yT);
      this.drawLog(c, t, e, s, logA, 1 - deselect);
      c.restore();
    }

    // ---- the line (the whole history in one stroke)
    if (lineK > 0.001) {
      const lw = Math.max(BRIDGE_LINE.width, gap);
      const x0 = BRIDGE_LINE.x0, x1 = BRIDGE_LINE.x1;
      c.fillStyle = heat > 0.01 ? mixRGBA('bone', 'signalHot', heat, lineK) : rgba('bone', lineK);
      c.fillRect(x0, (e.yT + e.yB) / 2 - lw / 2, x1 - x0, lw);
      if (heat > 0.01) {
        g.save();
        g.filter = 'blur(10px)';
        g.fillStyle = rgba('signal', heat * lineK);
        g.fillRect(x0 - 10, CY - 7, x1 - x0 + 20, 14);
        g.filter = 'blur(3px)';
        g.fillStyle = rgba('signalHot', heat * lineK);
        g.fillRect(x0, CY - 2.5, x1 - x0, 5);
        g.restore();
      }
    }

    // ---- glyphs squeezed out of the sides on each hit
    this.drawSpray(c, t);

    // ---- selection hint (stage 0)
    this.drawStatus(c, t, f);

    // ---- the plates
    if (open < 1) this.drawPlates(c, t, e, open, imp);

    comp.draw(renderer, L.upload(), out);
    if (heat > 0.01) comp.draw(renderer, G.upload(), out, { mode: 'add', tint: [2.2, 2.2, 2.2] });

    const shakeY = imp * 9 * noise1(t * 90, 3);
    return {
      bloom: 0.4 + 0.4 * heat, vignette: 0.34, grain: 0.05,
      shake: [imp * 3 * noise1(t * 80, 7), shakeY],
      rgbSplit: 2.5 * imp,
    };
  }

  private drawLog(c: CanvasRenderingContext2D, t: number, e: Edges, s: number, alpha: number, selA: number) {
    // cull in content space (y = yT + u*s)
    const top = -e.yT / Math.max(1e-4, s), bottom = top + H / Math.max(1e-4, s);
    const tiny = s < 0.02; // text under ~0.5 px tall: draw rows as bars
    for (const b of this.blocks) {
      if (b.u + b.h < top - 40 || b.u - LABEL_H > bottom + 40) continue;
      c.globalAlpha = alpha;
      // bubble
      c.fillStyle = b.role === 'user' ? rgba('bone', 0.08) : rgba('bone', 0.035);
      c.fillRect(b.x, b.u, b.w, b.h);
      if (b.role === 'system') { c.fillStyle = rgba('signal', 0.85); c.fillRect(b.x, b.u, 3, b.h); }
      // selection (select all, carried over from s08): bone bars behind label and every text row; the
      // selected text reads in ink
      const selK = selA * this.selected(t, b.u);
      if (selK > 0.01) {
        c.fillStyle = rgba('bone', SELECT_ALPHA * selK);
        const r = b.label;
        c.fillRect(r.x - 3, r.u - 12, r.w + 6, 16);
        for (const row of b.rows) c.fillRect(row.x - 3, row.u - SIZE * 0.95, row.w + 6, LH);
      }
      // text
      if (tiny) {
        c.fillStyle = rgba('bone', 0.75);
        for (const row of b.rows) c.fillRect(row.x, row.u - SIZE * 0.72, row.w, SIZE * 0.72);
        continue;
      }
      c.font = font(F.mono(500), 12);
      c.letterSpacing = '2px';
      c.fillStyle = selK > 0.5 ? rgba('ink', 0.7) : rgba(b.role === 'system' ? 'signal' : 'bone', 0.55);
      c.fillText(b.label.text, b.label.x, b.label.u);
      c.letterSpacing = '0px';
      c.font = font(F.mono(400), SIZE);
      c.fillStyle = selK > 0.5 ? rgba('ink', 0.95) : rgba('bone', 0.93);
      for (const row of b.rows) c.fillText(row.text, row.x, row.u);
      if (b.pin) {
        const px = b.x + b.w - 7, py = b.u - 2, r = 9;
        c.fillStyle = rgba('signal', 1);
        c.beginPath(); c.arc(px, py, r, 0, TAU); c.fill();
        c.fillRect(px - 1.2, py, 2.4, r * 1.8);
      }
    }
    c.globalAlpha = 1;
  }

  /** Height of the log in screens (the visible log area at stage 0). */
  private screens() { return this.contentH / (BOTTOM_Y - 40); }

  /** 0..1 selection of a block: the whole log is already selected on the cut (s08 made the selection). */
  private selected(t: number, u: number) {
    void u;
    return t >= this.selT ? 1 : 0;
  }

  private drawSpray(c: CanvasRenderingContext2D, t: number) {
    c.save();
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    for (const p of this.particles) {
      const hit = this.hits[p.k]!;
      const d = t - hit;
      if (d < 0 || d > p.life) continue;
      const st = this.stages[p.k + 1]!;
      const y0 = lerp(st.yT + 8, st.yB - 8, p.r);
      const drag = 5;
      const travel = (1 - Math.exp(-drag * d)) / drag;
      const edgeX = p.side < 0 ? BRIDGE_LINE.x0 - 4 : BRIDGE_LINE.x1 + 4;
      const x = edgeX + p.side * p.x0 + p.vx * travel;
      const y = y0 + p.vy * travel;
      const a = (1 - prog(d, p.life * 0.35, p.life)) * prog(d, 0, 0.02);
      c.save();
      c.translate(x, y);
      c.rotate(p.rot * travel);
      // stretched along the throw while fast
      c.scale(1 + 1.6 * Math.exp(-drag * d * 1.5), 1);
      c.font = font(F.mono(500), p.size);
      c.fillStyle = p.hot ? rgba('signal', a) : rgba('bone', 0.85 * a);
      c.fillText(p.ch, 0, 0);
      c.restore();
    }
    c.restore();
  }

  private drawStatus(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const a = 1 - prog(t, this.hits[0]! - 0.12, this.hits[0]!);
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    const x = 64, y = H - 60;
    c.fillStyle = rgba('bone', SELECT_ALPHA);
    const label = 'SELECT ALL';
    const w = c.measureText(label).width;
    c.fillRect(x - 8, y - 17, w + 14, 24);
    c.fillStyle = rgba('ink', 1);
    c.fillText(label, x, y);
    c.fillStyle = rgba('bone', 0.55);
    c.fillText(`${LOG.length} MESSAGES  ·  ${this.screens().toFixed(1)} SCREENS`, x + w + 26, y);
    c.restore();
    void f;
  }

  private drawPlates(c: CanvasRenderingContext2D, t: number, e: Edges, open: number, imp: number) {
    const lift = open * 620;
    const yT = e.yT - lift, yB = e.yB + lift;
    const stage = this.hits.filter((h) => t >= h).length; // presses landed
    c.save();
    // top plate
    if (yT > 0) this.plate(c, 0, yT, -1, imp);
    if (yB < H) this.plate(c, yB, H, 1, imp);
    // lyric on the top plate: the "Compress!" just sung, sized to the plate
    if (stage > 0 && yT > 60) {
      const hit = this.hits[stage - 1]!;
      const size = [72, 128, 168][stage - 1]!;
      const k = prog(t, hit, hit + 0.1, ease.outCubic);
      c.font = font(F.display(900), size);
      c.letterSpacing = `${size * 0.02}px`;
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      const hot = pulse(t, hit, 0.06);
      c.fillStyle = mixRGBA('signal', 'signalHot', hot, 1);
      c.save();
      c.beginPath(); c.rect(0, 0, W, yT - 10); c.clip();
      c.translate(W / 2, yT - size * 0.22 - (stage === 1 ? 4 : 18));
      c.scale(1, lerp(1.25, 1, k)); // stamped: drops in a hair tall and settles
      c.fillText('COMPRESS!', 0, 0);
      c.restore();
      // readouts on the bottom plate
      const info = [
        ['PRESS 1/3', `${this.screens().toFixed(1)} SCREENS  →  1 SCREEN`],
        ['PRESS 2/3', '1 SCREEN  →  4 LINES'],
        ['PRESS 3/3', '4 LINES  →  1 LINE'],
      ][stage - 1]!;
      c.font = font(F.mono(500), 16);
      c.letterSpacing = '4px';
      c.textAlign = 'left';
      const ya = yB + 40;
      if (ya < H - 20) {
        const ka = prog(t, hit + 0.04, hit + 0.12);
        c.fillStyle = rgba('signal', 0.95 * ka);
        c.fillText(info[0]!, BRIDGE_LINE.x0, ya);
        c.textAlign = 'right';
        c.fillStyle = rgba('bone', 0.7 * ka);
        c.fillText(info[1]!, BRIDGE_LINE.x1, ya);
      }
    }
    c.restore();
  }

  /** One press plate from y0 to y1; `face` = -1 for the top plate (its working face at y1), +1 for the bottom (face at y0). */
  private plate(c: CanvasRenderingContext2D, y0: number, y1: number, face: number, imp: number) {
    const fy = face < 0 ? y1 : y0;
    const gr = c.createLinearGradient(0, fy, 0, fy - face * 260);
    gr.addColorStop(0, '#17171a');
    gr.addColorStop(1, '#0d0d0f');
    c.fillStyle = gr;
    c.fillRect(0, y0, W, y1 - y0);
    // machined grooves parallel to the face
    c.fillStyle = rgba('bone', 0.05);
    for (let k = 1; k <= 3; k++) {
      const gy = fy - face * (18 + k * 9);
      if ((face < 0 && gy > y0) || (face > 0 && gy < y1)) c.fillRect(0, gy, W, 1);
    }
    // hazard ticks near the face
    c.fillStyle = rgba('graphite', 0.55);
    const ty = fy - face * 12;
    for (let x = -20; x < W + 20; x += 28) {
      c.beginPath();
      c.moveTo(x, ty - 5); c.lineTo(x + 10, ty - 5); c.lineTo(x + 4, ty + 5); c.lineTo(x - 6, ty + 5);
      c.closePath(); c.fill();
    }
    // working face: a bright edge, brighter on impact
    c.fillStyle = mixRGBA('bone', 'signalHot', clamp(imp * 0.8), 0.85 + 0.15 * imp);
    c.fillRect(0, fy - (face < 0 ? 2 : 0), W, 2);
  }
}

function wrap(c: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const tryL = line ? line + ' ' + word : word;
    if (c.measureText(tryL).width > maxW && line) { out.push(line); line = word; } else line = tryL;
  }
  out.push(line);
  return out;
}
