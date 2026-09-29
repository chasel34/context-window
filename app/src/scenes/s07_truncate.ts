// s07 · truncate (Pre-Chorus 2). Opens on the exact top-down table s06 tilts into. The context is
// full: each "drop" strikes the oldest row through in magenta and its cells tumble away from the
// camera and off the top of the frame; "oldest" takes the next, "Truncate-" / "cate" slice three rows
// at a time along a magenta cut line. The rows left behind spring up to close the gap while the sung
// lines are written into new rows at the bottom. "I'm fine I'm fine": one green ✓ is drawn into the
// last row (the only green in the film). Then the cursor waits in the next empty row, blinks faster
// through the last bar and bursts into the full-frame magenta that s08 cuts in on.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, W, H } from '../engine/gl';
import { LIN } from '../engine/palette';
import { LineBatch } from '../engine/lines';
import { clamp, ease, fbm1, hash, keys, lerp, prog, pulse, springStep, type Key } from '../engine/util';
import { cursorOn } from '../shared/cursor';
import { DofRenderer } from '../shared/c_dof';
import { CellGrid, KV, LEAK_END, TABLE_CAM_H, TABLE_PIVOT_Y, TABLE_ROWS, buildAtlas, buildRows, cellX, cellY, tablePose, wallMatrix, type KvRow } from '../shared/c_kv';

interface Drop { t: number; rows: number[]; slice: boolean }

const BURST = /* glsl */ `
uniform vec2 center; uniform vec2 half_; uniform float ring; uniform vec3 col;
void main() {
  vec2 p = FRAG_PX - center;
  vec2 d = abs(p) - half_;
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float a = 1.0 - smoothstep(-0.75, 0.75, sd);
  float rr = length(p) - ring;
  float r = ring > 0.0 ? exp(-rr * rr / 900.0) * 0.6 : 0.0;
  fragColor = vec4(col * a + col * 1.6 * r * (1.0 - a), a);
}`;

export default class S07Truncate extends Scene {
  grid!: CellGrid;
  dof = new DofRenderer();
  lines = new LineBatch(64, { screen2D: false, worldWidth: true, blend: 'add', depthTest: false });
  burst: FSPass;
  cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  rows: KvRow[] = [];
  slots: number[][] = [];
  drops: Drop[] = [];
  dropOf = new Map<number, Drop>();
  newRow0 = TABLE_ROWS;
  fine: number[] = [];
  tBurst = 0;
  checkRow = 0; checkCol = 0;
  hKeys: Key[] = [];
  private wm = new THREE.Matrix4();

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    this.burst = new FSPass(BURST, {
      center: { value: new THREE.Vector2() }, half_: { value: new THREE.Vector2() }, ring: { value: 0 }, col: { value: new THREE.Vector3(...LIN.signal) },
    }, { blending: THREE.NormalBlending, transparent: true });
    const m = this.burst.mat;
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  }

  override init() {
    const { lyrics, tl, renderer, start, end } = this.ctx;
    const s06 = tl.scene('s06');
    this.rows = buildRows(lyrics, s06.start - 0.05, end);
    const { atlas, slots } = buildAtlas(renderer, this.rows);
    this.slots = slots;
    this.grid = new CellGrid(this.rows.length * KV.cols + 64, atlas);
    wallMatrix(1, this.wm);
    const wt = (s: string) => tl.wordTimes(s, start - 0.1, end);
    const d = wt('drop'), old = wt('oldest')[0], tr = wt('truncate')[0], ca = wt('cate')[0];
    // row 0 (the system prompt) stays: the oldest *messages* go, one row per "drop"
    let next = 1;
    const take = (n: number) => Array.from({ length: n }, () => next++);
    for (const x of d) this.drops.push({ t: x, rows: take(1), slice: false });
    if (old !== undefined) this.drops.push({ t: old, rows: take(1), slice: false });
    if (tr !== undefined) this.drops.push({ t: tr, rows: take(3), slice: true });
    if (ca !== undefined) this.drops.push({ t: ca, rows: take(3), slice: true });
    for (const dr of this.drops) for (const r of dr.rows) this.dropOf.set(r, dr);
    this.fine = wt('fine');
    // the ✓ goes in the first free cell of the last sung row
    this.checkRow = this.rows.length - 1;
    this.checkCol = Math.min(KV.cols - 1, this.rows[this.checkRow]!.words.length);
    // the burst: the last beat before the cut
    this.tBurst = tl.timeOfBeat(Math.round(tl.beat(end)) - 1);
    const H0 = TABLE_CAM_H;
    this.hKeys = [[start, H0], [start + 0.15, H0 * 0.99, ease.linear], [(this.fine[0] ?? start + 2.3) - 0.2, H0 * 0.6, ease.inOutCubic],
      [this.tBurst - 0.05, H0 * 0.36, ease.inOutQuad], [end, H0 * 0.16, ease.inQuad]];
  }

  /** Rows moved up so far (spring per drop). */
  private shiftAbove(r: number, t: number) {
    let s = 0;
    for (const dr of this.drops) for (const x of dr.rows) if (x < r) s += springStep(t - (dr.t + 0.26), 2.6, 0.55);
    return s;
  }

  /** Display y (wall space) of row r at t. */
  private rowY(r: number, t: number) { return cellY(r - this.shiftAbove(r, t)); }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, tl, start, end } = this.ctx;
    const t = f.t;
    const g = this.grid;
    g.clear();

    // ---- camera: starts on the exact table pose s06 lands on, then pushes down onto the live rows
    const tp = tablePose();
    const liveLast = this.rows.length;
    const topR = 0;
    const midY = lerp(this.rowY(topR, t), this.rowY(liveLast, t), 0.5);
    const k = prog(t, start, (this.fine[0] ?? start + 2.3) - 0.2, ease.inOutCubic);
    const burstK = prog(t, this.tBurst - 0.05, end, ease.inQuad);
    // the cursor waits right after the ✓, in the last cell of the last row
    const cCol = this.checkCol + 1 < KV.cols ? this.checkCol + 1 : 0;
    const cRow = cCol === 0 ? this.checkRow + 1 : this.checkRow;
    const cursorY = this.rowY(cRow, t);
    const cursorX = cellX(cCol) - KV.cw / 2 + 0.14;
    const lastWords = this.rows[this.rows.length - 1]!.line!.words;
    const tEndLine = lastWords[lastWords.length - 1]!.end;
    const k2 = prog(t, tEndLine - 0.1, this.tBurst - 0.1, ease.inOutCubic);
    const focusY = lerp(lerp(lerp(TABLE_PIVOT_Y, midY, k), cursorY + KV.py * 1.2, k2), cursorY, burstK);
    const focusX = lerp(lerp(0, cellX(this.checkCol - 1.2), k2), cursorX + 0.05, burstK);
    const h = keys(t, this.hKeys);
    const roll = (-0.07 * k + 0.02 * fbm1(t * 0.4, 2, 3)) * (1 - burstK);
    const tgtW = new THREE.Vector3(focusX, focusY, 0).applyMatrix4(this.wm);
    const cam = this.cam;
    cam.position.set(tgtW.x + 0.3 * k * (1 - burstK), tgtW.y + h, tgtW.z + 0.2 * k);
    cam.up.set(Math.sin(roll), 0, -Math.cos(roll));
    cam.fov = tp.fov;
    cam.aspect = 16 / 9;
    cam.lookAt(tgtW);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // ---- cells
    for (let r = 0; r < this.rows.length; r++) {
      const row = this.rows[r]!;
      const isNew = r >= this.newRow0;
      const isLive = row.live;
      const line = row.line!;
      if (isNew && t < line.start - 0.08) continue;
      const dr = this.dropOf.get(r);
      const y0 = this.rowY(r, t);
      for (let c = 0; c < KV.cols; c++) {
        let lit = 0.16, sig = 0, heat = 0, reveal = 1, z = KV.cd / 2, alpha = 1, dissolve = 0, strike = 0;
        let x = cellX(c), y = y0, rx = 0, ry = 0, rz = 0;
        if (isLive) {
          const w = line.words[c];
          const sweep = prog(t, line.start - 0.06 + c * 0.035, line.start + 0.1 + c * 0.035, ease.outCubic);
          lit = isNew ? lerp(0.03, 0.55, sweep) + 0.5 * pulse(t, line.start + c * 0.035, 0.12) * (t >= line.start ? 1 : 0) : 0.55;
          if (isNew) alpha = sweep;
          if (w) {
            reveal = prog(t, w.start - 0.03, w.start + 0.14, ease.outCubic);
            const on = t >= w.start - 0.03;
            heat = on ? 1 : 0;
            sig = on ? (t < w.end ? 1 : pulse(t, w.end, 0.12)) : 0;
            if (on) {
              lit = Math.max(lit, 0.85);
              z += 0.34 * Math.exp(-(t - w.start) / 0.13) * (t >= w.start ? 1 : 0) + 0.08 * prog(t, w.start, w.start + 0.2);
            }
          }
          if (r === TABLE_ROWS - 1) dissolve = LEAK_END * (0.75 + 0.5 * hash(c, 3));
        }
        if (r === 0) lit = 0.3; // the system prompt: kept
        if (dr) {
          // strike through (left to right), then the cells tumble down, away and off the top
          const st = dr.t + (dr.slice ? 0 : c * 0.012);
          strike = prog(t, st, st + 0.13, ease.outCubic);
          lit = Math.max(lit, 0.6 * strike);
          const fall = t - (dr.t + 0.1 + c * 0.028 + (dr.slice ? (r - dr.rows[0]!) * 0.05 : 0));
          if (fall > 0) {
            const hs = hash(r, c, 17);
            z -= 26 * fall * fall + 1.5 * fall;
            y += 3.0 * fall * fall + 1.4 * fall;
            x += (hs - 0.5) * 2.2 * fall;
            rx = (hs - 0.5) * 5.5 * fall; ry = (hash(r, c, 18) - 0.5) * 2.2 * fall; rz = (hash(r, c, 19) - 0.5) * 1.6 * fall;
            // falling away, the cells converge on the vanishing point at the top of the frame: fade them
            // (and their strike glow) out before they pile up there as a bright strip
            alpha = 1 - prog(fall, 0.08, 0.36);
            strike *= 1 - prog(fall, 0.02, 0.25);
            lit *= 1 - 0.6 * prog(fall, 0.02, 0.25);
            if (alpha <= 0) continue;
          }
        }
        const blank = r === this.checkRow && c === this.checkCol;
        g.push({ x, y, z, rx, ry, rz, slot: this.slots[r]![c]!, reveal, lit: Math.min(lit, 1.4), signal: sig, heat, alpha, dissolve, strike, blank });
      }
    }

    // ---- pin on the kept system prompt row
    g.push({ x: cellX(0) - KV.cw / 2 - 0.2, y: this.rowY(0, t), z: KV.cd, sx: 0.14, sy: 0.14, sz: 0.1, rz: Math.PI / 4, slot: 0, pixel: true, lit: 1.6, signal: 1 });

    // ---- the cursor: in the next empty row; faster through the last bar; it becomes the burst
    const lastW = this.rows[this.rows.length - 1]!.line!.words;
    const typingEnd = lastW[lastW.length - 1]!.end;
    const lastBar = this.tBurst - tl.beatPeriod * 3;
    const on = t < typingEnd + 0.05 ? false : t >= lastBar ? cursorOn(t, tl, 0.5, 0.5) : cursorOn(t, tl);
    if ((on || t >= this.tBurst) && t >= typingEnd + 0.05) {
      g.push({ x: cursorX + 0.045, y: cursorY, z: KV.cd + 0.02, sx: 0.09, sy: 0.3, sz: 0.04, slot: 0, pixel: true, lit: 2.2, signal: 1 });
    }

    // ---- light, fog
    const u = g.u;
    (u.wallMatrix!.value as THREE.Matrix4).copy(this.wm);
    (u.camPos!.value as THREE.Vector3).copy(cam.position);
    const lp = new THREE.Vector3(0, this.rowY(this.rows.length - 1, t), 1.2).applyMatrix4(this.wm);
    (u.lightPos!.value as THREE.Vector3).copy(lp);
    u.lightR!.value = 3.5;
    u.fogStart!.value = 18; u.fogLen!.value = 40; u.warm!.value = 0; u.glowAll!.value = 0;

    this.dof.begin(renderer, LIN.ink);
    g.draw(renderer, this.dof.rt, cam);

    // ---- magenta cut line on the slices, the ✓
    const L = this.lines;
    L.clear();
    for (const dr of this.drops) {
      if (!dr.slice) continue;
      const a = pulse(t, dr.t, 0.1) * (t >= dr.t ? 1 : 0);
      if (a < 0.01) continue;
      const yb = cellY(dr.rows[dr.rows.length - 1]! - this.shiftAbove(dr.rows[0]!, t)) - KV.py / 2;
      const ext = prog(t, dr.t - 0.02, dr.t + 0.08, ease.outCubic);
      const x0 = -KV.px * KV.cols * 0.62, x1 = lerp(x0, -x0, ext);
      const A = new THREE.Vector3(x0, yb, KV.cd + 0.05).applyMatrix4(this.wm), B = new THREE.Vector3(x1, yb, KV.cd + 0.05).applyMatrix4(this.wm);
      L.seg(A.x, A.y, A.z, B.x, B.y, B.z, 0.035, LIN.signal[0] * 4 * a, LIN.signal[1] * 4 * a, LIN.signal[2] * 4 * a, 1);
    }
    const f0 = this.fine[0];
    if (f0 !== undefined && t >= f0) {
      const cx = cellX(this.checkCol) - KV.cw * 0.12, cy = this.rowY(this.checkRow, t), s = KV.chh * 0.8;
      const pts = [[-0.42, 0.02], [-0.12, -0.3], [0.5, 0.36]].map(([px, py]) => new THREE.Vector3(cx + px! * s, cy + py! * s, KV.cd + 0.03).applyMatrix4(this.wm));
      const draw = prog(t, f0, f0 + 0.22, ease.outCubic);
      const second = this.fine[1] !== undefined ? pulse(t, this.fine[1]!, 0.18) * (t >= this.fine[1]! ? 1 : 0) : 0;
      const I = (2.4 + 3.5 * pulse(t, f0, 0.15) + 3 * second) * (1 - 0.6 * burstK);
      const l1 = pts[0]!.distanceTo(pts[1]!), l2 = pts[1]!.distanceTo(pts[2]!), dl = draw * (l1 + l2);
      const ok = LIN.ok;
      const seg = (a: THREE.Vector3, b: THREE.Vector3, w: number, i: number) => L.seg(a.x, a.y, a.z, b.x, b.y, b.z, w, ok[0] * i, ok[1] * i, ok[2] * i, 1);
      const B1 = dl < l1 ? pts[0]!.clone().lerp(pts[1]!, dl / l1) : pts[1]!;
      for (const [w, i] of [[0.11, I * 0.12], [0.05, I]] as const) {
        seg(pts[0]!, B1, w, i);
        if (dl > l1) seg(pts[1]!, pts[1]!.clone().lerp(pts[2]!, clamp((dl - l1) / l2)), w, i);
      }
    }
    if (L.count) L.render(renderer, this.dof.rt, cam);

    const focus = cam.position.distanceTo(tgtW);
    this.dof.resolve(renderer, cam, out, { focus, aperture: lerp(8, 18, k), maxCoc: 16 });

    // ---- burst: the cursor grows into the full magenta frame
    let paper = 0, bkk = 0;
    if (t >= this.tBurst - 0.02) {
      const cw = new THREE.Vector3(cursorX + 0.045, cursorY, KV.cd + 0.04).applyMatrix4(this.wm).project(cam);
      const sx = (cw.x * 0.5 + 0.5) * W, sy = (cw.y * 0.5 + 0.5) * H; // FRAG_PX: origin bottom-left
      const bk = prog(t, this.tBurst, end - 0.03, (x) => ease.inExpo(x));
      const half0 = new THREE.Vector2(9, 36);
      const u2 = this.burst.u;
      (u2.center!.value as THREE.Vector2).set(lerp(sx, W / 2, bk), lerp(sy, H / 2, bk));
      (u2.half_!.value as THREE.Vector2).set(lerp(half0.x, W * 0.62, bk), lerp(half0.y, H * 0.62, Math.pow(bk, 0.7)));
      u2.ring!.value = 0;
      this.burst.render(renderer, out);
      paper = bk > 0.5 ? 1 : 0;
      bkk = bk;
    }
    // blend into s08's (hook) post values as the magenta fills the frame, so the cut doesn't pop
    return { bloom: lerp(0.5, 0.22, bkk), bloomThreshold: paper ? 1.3 : 0.8, halation: lerp(0.3, 0.08, bkk), vignette: lerp(0.42, 0.2, bkk), paper, grain: 0.05 };
  }

  override dispose() { this.dof.dispose(); }
}
