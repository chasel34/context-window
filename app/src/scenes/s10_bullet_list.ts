// s10 · bullet list (Bridge, 78.0–84.8). BEATSHEET: 一张用线条画的人脸（骨白描线）逐笔拆解成要点列表，
// "Your voice" 时一条声波被拉平成一条直线 → 镜头推进到剩下的唯一一行.
//
// Opens on s09's last line (BRIDGE_LINE): its pieces peel off and curl into a face, drawn in single bone
// strokes. On "is a bullet list" the face is pulled apart feature by feature: each stroke is drawn out like
// a string to a row of the summary on the right, straightens into an underline, and the line turns into
// the row's text. Only the mouth is left; on "voice" it flies to the last row and starts to oscillate with
// the singer's voice. "is / one / single" flatten it step by step while the other rows are squashed into
// it; on "line" the one remaining line is pushed into (a Canvas2D zoom, so the HUD counter stays put).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, keys, lerp, prog, TAU, type Key, type V2 } from '../engine/util';
import { drawLyricLine } from '../shared/lyric';
import { BRIDGE_LINE } from '../shared/d_bridge';
import { buildFace, morph, segment, strokePath, N, type FaceStroke } from './s10_face';

const FACE = { x: 600, y: 548 };
const LIST_X = 1010;
const ROW_Y0 = 372, ROW_DY = 64;
const MONO = 30;
const TEXT_X = LIST_X + 36;
const STROKE_W = 3.5;
const FLIGHT = 0.5; // a stroke's flight from the face to its row (s)
const STAGGER = 0.06; // between strokes of one row

interface RowDef { key: string; val: string; strokes: string[] }
const ROWS: RowDef[] = [
  { key: 'hair', val: 'not recorded', strokes: ['hair', 'fringe'] },
  { key: 'brows', val: 'raised, once', strokes: ['browL', 'browR'] },
  { key: 'eyes', val: 'two, warm', strokes: ['lidL', 'pupilL', 'lidR', 'pupilR'] },
  { key: 'ears', val: 'always listening', strokes: ['earL', 'earR'] },
  { key: 'nose', val: '—', strokes: ['nose'] },
  { key: 'face', val: 'oval, approx.', strokes: ['head'] },
];

interface Row extends RowDef {
  y: number;
  w: number; // text width
  t0: number; // strokes leave the face
  land: number; // last stroke lands
  targets: Map<string, V2[]>; // stroke id → its piece of the underline
}

export default class S10BulletList extends Scene {
  layer = new Layer2D();
  face = new Map<string, FaceStroke>();
  order: string[] = []; // strokes left→right (the unfold order)
  unfoldFrom = new Map<string, V2[]>();
  rows: Row[] = [];
  lf!: Line;
  lv!: Line;
  voice = { y: 0, x0: 0, x1: 0, t0: 0, land: 0, labelW: 0 };
  amp: Key[] = [];
  tIs = 0; tOne = 0; tSingle = 0; tLine = 0;

  override init() {
    const { lyrics, start } = this.ctx;
    this.lf = lyrics.get('Your face is a bullet list');
    this.lv = lyrics.get('Your voice is one single line');
    const wf = this.lf.words, wv = this.lv.words;
    this.face = buildFace();

    // ---- unfold: the incoming line is cut into pieces proportional to stroke length, in left→right order
    this.order = [...this.face.values()].sort((a, b) => a.cx - b.cx).map((s) => s.id);
    const total = [...this.face.values()].reduce((a, s) => a + s.len, 0);
    let acc = 0;
    for (const id of this.order) {
      const s = this.face.get(id)!;
      const x0 = lerp(BRIDGE_LINE.x0, BRIDGE_LINE.x1, acc / total);
      acc += s.len;
      const x1 = lerp(BRIDGE_LINE.x0, BRIDGE_LINE.x1, acc / total);
      this.unfoldFrom.set(id, segment(x0, x1, BRIDGE_LINE.y));
    }
    void start;

    // ---- rows: leave the face across "is a bullet list"
    const tA = wf[2]!.start - 0.06, tB = wf[5]!.start;
    ROWS.forEach((d, r) => {
      const y = ROW_Y0 + r * ROW_DY;
      const w = measure(`${d.key}: ${d.val}`, F.mono(400), MONO);
      const t0 = lerp(tA, tB, r / (ROWS.length - 1));
      const lens = d.strokes.map((id) => this.face.get(id)!.len);
      const sum = lens.reduce((a, b) => a + b, 0);
      const targets = new Map<string, V2[]>();
      let a = 0;
      d.strokes.forEach((id, k) => {
        const x0 = TEXT_X + (w * a) / sum; a += lens[k]!;
        const x1 = TEXT_X + (w * a) / sum;
        targets.set(id, segment(x0, x1, y + 11));
      });
      this.rows.push({ ...d, y, w, t0, land: t0 + FLIGHT + STAGGER * (d.strokes.length - 1), targets });
    });

    // ---- the voice row: the mouth flies on "voice"
    const labelW = measure('voice: ', F.mono(400), MONO);
    const vy = ROW_Y0 + ROWS.length * ROW_DY + 26;
    this.voice = { y: vy, x0: TEXT_X + labelW + 6, x1: 1800, t0: wv[1]!.start - 0.08, land: wv[1]!.start - 0.08 + FLIGHT, labelW };
    this.tIs = wv[2]!.start; this.tOne = wv[3]!.start; this.tSingle = wv[4]!.start; this.tLine = wv[5]!.start;
    const L = this.voice.land;
    // amplitude: swells as it lands, then each of "is / one / single" pulls it flatter
    this.amp = [
      [L - 0.05, 0], [L + 0.22, 1, ease.outCubic],
      [this.tIs, 1], [this.tIs + 0.2, 0.55, ease.outCubic],
      [this.tOne, 0.55], [this.tOne + 0.2, 0.24, ease.outCubic],
      [this.tSingle, 0.24], [this.tSingle + 0.28, 0, ease.outCubic],
    ];
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;

    // push-in on "line": a zoom about the frame centre (the line has been centred by then)
    const push = prog(t, this.tLine - 0.02, f.end, ease.inCubic);
    const Z = Math.exp(Math.log(26) * push);
    c.setTransform(Z, 0, 0, Z, (W / 2) * (1 - Z), (H / 2) * (1 - Z));

    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = STROKE_W;
    c.strokeStyle = rgba('bone', 0.94);

    this.drawFrameAndCaption(c, t);
    this.drawHeader(c, t);

    // ---- face strokes: unfold from the line, hold, then fly to their rows
    const t0 = f.start;
    this.order.forEach((id, i) => {
      if (id === 'mouth') return;
      const row = this.rows.find((r) => r.strokes.includes(id))!;
      const k = row.strokes.indexOf(id);
      const leave = row.t0 + STAGGER * k;
      if (t >= leave + FLIGHT + 0.02) return; // landed: the row draws it
      const face = this.placed(id);
      let pts: V2[];
      if (t < leave) pts = this.unfolded(id, i, t, t0, face);
      else pts = morph(face, row.targets.get(id)!, prog(t, leave, leave + FLIGHT), 0.28, 70, 'start');
      c.strokeStyle = rgba('bone', 0.94);
      strokePath(c, pts);
    });

    // ---- rows
    this.rows.forEach((r, ri) => this.drawRow(c, t, r, ri));

    // ---- the mouth → the voice
    this.drawVoice(c, t, f);

    c.setTransform(1, 0, 0, 1, 0, 0);
    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.45 + 0.5 * push, bloomThreshold: 0.8, vignette: 0.34, grain: 0.045 };
  }

  /** Face-local stroke placed on screen. */
  private placed(id: string): V2[] {
    return this.face.get(id)!.pts.map((p) => ({ x: FACE.x + p.x, y: FACE.y + p.y }));
  }

  /** The unfold from s09's line: piece i peels off the line and curls into its stroke. */
  private unfolded(id: string, i: number, t: number, t0: number, face: V2[]): V2[] {
    const from = this.unfoldFrom.get(id)!;
    const s = t0 + 0.03 + i * 0.034;
    const p = prog(t, s, s + 0.56);
    return morph(from, face, p, 0.35, -40, 'end');
  }

  /** Corner brackets round the face (an attachment preview) and a caption counting the strokes left. */
  private drawFrameAndCaption(c: CanvasRenderingContext2D, t: number) {
    const shown = prog(t, this.ctx.start + 0.35, this.ctx.start + 0.7, ease.outCubic);
    const left = this.order.filter((id) => {
      if (id === 'mouth') return t < this.voice.t0;
      const r = this.rows.find((rr) => rr.strokes.includes(id))!;
      return t < r.t0 + STAGGER * r.strokes.indexOf(id);
    }).length;
    const gone = prog(t, this.tOne, this.tOne + 0.35, ease.inQuad); // an empty frame until the list goes too
    const a = shown * (1 - gone);
    if (a <= 0.001) return;
    c.save();
    c.globalAlpha = a;
    const x0 = FACE.x - 250, x1 = FACE.x + 250, y0 = FACE.y - 370, y1 = FACE.y + 300, l = 22;
    const ex = (1 - shown) * 30;
    c.strokeStyle = rgba('graphite', 0.9);
    c.lineWidth = 1.5;
    c.lineCap = 'butt';
    c.beginPath();
    for (const [x, y, sx, sy] of [[x0 - ex, y0 - ex, 1, 1], [x1 + ex, y0 - ex, -1, 1], [x0 - ex, y1 + ex, 1, -1], [x1 + ex, y1 + ex, -1, -1]] as const) {
      c.moveTo(x + sx * l, y); c.lineTo(x, y); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '3px';
    c.fillStyle = rgba('ash', 0.85);
    c.fillText('USER_FACE.SVG', x0, y1 + 40);
    c.textAlign = 'right';
    c.fillStyle = left < this.order.length ? rgba('signal', 0.95) : rgba('ash', 0.85);
    c.fillText(`${left} STROKES`, x1, y1 + 40);
    c.restore();
  }

  /** The sung line as the list's heading (sung words magenta); the two lines swap by squashing flat. */
  private drawHeader(c: CanvasRenderingContext2D, t: number) {
    const swap = this.lv.start - 0.12;
    const yH = 272;
    c.save();
    // label + rule
    const a = prog(t, this.ctx.start + 0.1, this.ctx.start + 0.4);
    c.globalAlpha = a;
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '4px';
    c.fillStyle = rgba('ash', 0.8);
    c.fillText('MEMORY  /  USER  /  SUMMARY', LIST_X, yH - 74);
    c.letterSpacing = '0px';
    c.fillStyle = rgba('graphite', 0.8);
    c.fillRect(LIST_X, yH + 30, 800 * ease.outCubic(a), 1.5);
    c.restore();
    const style = { family: F.display(800), size: 40, align: 'left' as const, baseAlpha: 0.22, maxWidth: 820 };
    const drawSquashed = (line: Line, sy: number) => {
      if (sy <= 0.01) return;
      c.save();
      c.translate(0, yH - 14);
      c.scale(1, sy);
      c.translate(0, -(yH - 14));
      drawLyricLine(c, line, t, LIST_X, yH, style);
      c.restore();
    };
    drawSquashed(this.lf, (1 - prog(t, swap - 0.12, swap, ease.inCubic)) * prog(t, this.ctx.start + 0.05, this.ctx.start + 0.3, ease.outCubic));
    drawSquashed(this.lv, prog(t, swap, swap + 0.14, ease.outCubic));
  }

  private drawRow(c: CanvasRenderingContext2D, t: number, r: Row, ri: number) {
    if (t < r.t0 + FLIGHT - 0.02) return;
    // collapse into the voice line on "one"
    const tc = this.tOne + ri * 0.065;
    const k = prog(t, tc, tc + 0.36, ease.inOutCubic);
    if (k >= 1) return;
    const squash = 1 - ease.inCubic(clamp(k / 0.45)) * 0.97;
    const dy = (this.voice.y - r.y) * ease.inOutCubic(clamp((k - 0.25) / 0.75));
    const alpha = 1 - prog(k, 0.7, 1);
    c.save();
    c.globalAlpha = alpha;
    c.translate(0, r.y + dy);
    c.scale(1, squash);
    c.translate(0, -r.y);

    // strokes that have landed lie as the underline until the text wipes over them
    const wipe0 = r.land - 0.02, wipe1 = wipe0 + 0.3;
    const wx = TEXT_X + r.w * ease.inOutQuad(prog(t, wipe0, wipe1));
    r.strokes.forEach((id, k2) => {
      const landT = r.t0 + STAGGER * k2 + FLIGHT;
      if (t < landT + 0.02) return;
      const seg = r.targets.get(id)!;
      const a = seg[0]!.x, b = seg[N - 1]!.x;
      const x0 = Math.max(a, wx);
      if (x0 >= b) return;
      c.strokeStyle = rgba('bone', 0.94);
      c.lineWidth = STROKE_W;
      c.beginPath(); c.moveTo(x0, r.y + 11); c.lineTo(b, r.y + 11); c.stroke();
    });
    // text, revealed left to right as the line is consumed
    if (wx > TEXT_X + 0.5) {
      c.save();
      c.beginPath(); c.rect(TEXT_X - 4, r.y - MONO, wx - TEXT_X + 4, MONO * 1.5); c.clip();
      c.font = font(F.mono(500), MONO);
      c.fillStyle = rgba('bone', 0.96);
      const kw = c.measureText(`${r.key}:`).width;
      c.fillText(`${r.key}:`, TEXT_X, r.y);
      c.font = font(F.mono(400), MONO);
      c.fillStyle = rgba('ash', 0.95);
      c.fillText(` ${r.val}`, TEXT_X + kw, r.y);
      c.restore();
    }
    // the bullet pops as the first stroke lands
    const pb = prog(t, r.t0 + FLIGHT, r.t0 + FLIGHT + 0.22);
    if (pb > 0) {
      const rr = 5.5 * ease.outBack(pb, 3);
      c.fillStyle = rgba('signal', 1);
      c.beginPath(); c.arc(LIST_X + 9, r.y - 10, Math.max(0, rr), 0, TAU); c.fill();
    }
    c.restore();
  }

  private drawVoice(c: CanvasRenderingContext2D, t: number, f: Frame) {
    const V = this.voice;
    const mouth = this.placed('mouth');
    const last = this.order.indexOf('mouth');
    // mouth on the face (unfolded like the rest) until "voice"
    if (t < V.t0) {
      strokePath(c, t < this.ctx.start + 1.2 ? this.unfolded('mouth', last, t, this.ctx.start, mouth) : mouth);
      return;
    }
    // line geometry: row position → centred BRIDGE_LINE on "single … line"
    const cen = prog(t, this.tSingle + 0.12, this.tLine - 0.02, ease.inOutCubic);
    const x0 = lerp(V.x0, BRIDGE_LINE.x0, cen), x1 = lerp(V.x1, BRIDGE_LINE.x1, cen), y = lerp(V.y, BRIDGE_LINE.y, cen);
    if (t < V.land) {
      const pts = morph(mouth, segment(V.x0, V.x1, V.y), prog(t, V.t0, V.land), 0.3, 90, 'start');
      c.strokeStyle = rgba('bone', 0.94);
      strokePath(c, pts);
    } else {
      // the waveform: the singer's voice, pulled flatter on each word; a string drawn taut
      const A = keys(t, this.amp) * 44;
      const vocal = this.ctx.audio.env('vocal', t);
      const taut = 1 + 0.9 * (1 - keys(t, this.amp));
      c.beginPath();
      const n = 180;
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const x = lerp(x0, x1, s);
        const win = Math.pow(Math.sin(Math.PI * s), 0.7);
        const wv = 0.55 * Math.sin(s * TAU * 5.2 * taut + t * 11) + 0.3 * Math.sin(s * TAU * 11.3 * taut - t * 17 + 1.3) + 0.15 * Math.sin(s * TAU * 23.1 * taut + t * 29 + 0.4);
        const yy = y + A * win * wv * (0.35 + 0.95 * vocal);
        if (i === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      const flat = 1 - keys(t, this.amp);
      c.strokeStyle = t > this.tSingle ? mixRGBA('bone', '#FFFFFF', 0.4 * flat, 0.96) : rgba('bone', 0.94);
      c.lineWidth = STROKE_W;
      c.stroke();
    }
    // "voice:" label + bullet (collapse into the line on "single")
    const k = prog(t, this.tSingle, this.tSingle + 0.3, ease.inOutCubic);
    if (k < 1 && t >= V.t0 + 0.2) {
      const sq = 1 - 0.97 * ease.inCubic(clamp(k / 0.5));
      const a = (1 - prog(k, 0.6, 1)) * prog(t, V.land - 0.05, V.land + 0.15);
      c.save();
      c.globalAlpha = a;
      c.translate(0, V.y);
      c.scale(1, sq);
      c.translate(0, -V.y);
      c.font = font(F.mono(500), MONO);
      c.fillStyle = rgba('bone', 0.96);
      c.fillText('voice:', TEXT_X, V.y + 10);
      const pb = prog(t, V.land - 0.05, V.land + 0.17);
      c.fillStyle = rgba('signal', 1);
      c.beginPath(); c.arc(LIST_X + 9, V.y, Math.max(0, 5.5 * ease.outBack(pb, 3)), 0, TAU); c.fill();
      c.restore();
    }
    void f;
  }
}

