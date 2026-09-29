// s06 · KV cache (Verse 2). A 3D wall of key/value cells: one row per line of the conversation so far.
// Each sung line writes the next row: the row lights in a sweep on the line's first word, every word is
// typed into its key cell by the cursor (magenta while sung, stays magenta after — the lyric rule), and
// pops out of the wall. The camera dollies along the row with a shallow depth of field; kicks and hats
// light random older cells (attention reading the cache). "glow" lifts the whole wall, "Warm" warms it,
// "small, small" shrinks every cell as the camera pulls back; "leaking" erodes the bottom row into
// pixels that drip off the wall. On "wall" the wall tilts back into the top-down table that s07 opens on.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { LIN } from '../engine/palette';
import { clamp, ease, fbm1, hash, keys, lerp, mulberry32, prog, pulse, springStep, type Key } from '../engine/util';
import type { Word } from '../engine/lyrics';
import { cursorOn } from '../shared/cursor';
import { DofRenderer } from '../shared/c_dof';
import { CellGrid, KV, TABLE_ROWS, LEAK_END, buildAtlas, buildRows, cellX, cellY, tablePose, wallMatrix, type KvRow } from '../shared/c_kv';

interface LiveWord { w: Word; r: number; c: number }
interface Drip { ts: number; x: number; vx: number; vy: number; s: number; sig: number; streak: number }

export default class S06KvCache extends Scene {
  grid!: CellGrid;
  dof = new DofRenderer();
  cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
  rows: KvRow[] = [];
  slots: number[][] = [];
  live: LiveWord[] = [];
  lineStarts: number[] = [];
  liveRow0 = 0;
  hits: number[] = [];
  drips: Drip[] = [];
  shots: { t0: number; row: number; c0: number; c1: number; ta: number; tb: number; yaw: Key[]; pitch: Key[]; dist: Key[] }[] = [];
  tWarm: number[] = []; tSmall: number[] = []; tGlow = 0; tLeak = 0; tSomething = 0; tThrough = 0;
  tiltA = 0; tiltB = 0;
  private wm = new THREE.Matrix4();
  private wmi = new THREE.Matrix4();
  private v = new THREE.Vector3();

  override init() {
    const { lyrics, tl, renderer, audio, start, end } = this.ctx;
    const s07 = tl.scene('s07');
    this.rows = buildRows(lyrics, start - 0.05, s07.end);
    const { atlas, slots } = buildAtlas(renderer, this.rows);
    this.slots = slots;
    this.grid = new CellGrid(TABLE_ROWS * KV.cols + 1200, atlas);
    this.liveRow0 = this.rows.findIndex((r) => r.live);
    for (let r = this.liveRow0; r < TABLE_ROWS; r++) {
      const line = this.rows[r]!.line!;
      this.lineStarts.push(line.start);
      line.words.forEach((w, c) => this.live.push({ w, r, c }));
    }
    const wt = (s: string) => tl.wordTimes(s, start, end);
    this.tWarm = wt('warm');
    this.tSmall = wt('small');
    this.tGlow = wt('glow')[0] ?? start + 3;
    this.tLeak = wt('leaking')[0] ?? end - 1.2;
    this.tSomething = wt("Something's")[0] ?? end - 1.6;
    this.tThrough = wt('through')[0] ?? end - 0.8;
    // the tilt starts on the grid point at/before "through" and lands on the cut
    this.tiltA = tl.floorGrid(this.tThrough, 2);
    this.tiltB = end;
    // attention flicker: every click of the kit reads a few old cells
    const ev = [...audio.events('kick', start - 1, end), ...audio.events('hat', start - 1, end), ...audio.events('snare', start - 1, end)];
    this.hits = ev.map((e) => e[0]).sort((a, b) => a - b);

    // camera: one shot per sung line, hard cut on the line's first word; inside a shot the focus
    // dollies smoothly along the row (no per-word whips)
    const L = this.rows.slice(this.liveRow0, TABLE_ROWS).map((r) => r.line!);
    // (cuts sit between two 60 fps frames so no frame's shutter straddles one)
    const cutAt = (i: number) => (i === 0 ? start - 1 : (Math.floor((L[i]!.words[0]!.start - 0.03) * 60) + 0.5) / 60);
    const lastCol = (i: number) => Math.min(KV.cols - 1, L[i]!.words.length - 1);
    const s1 = this.tSmall[0] ?? L[2]!.start + 0.8, s2 = this.tSmall[1] ?? s1 + 0.4;
    this.shots = [
      // "Key, value, row by row": close, from the left, dolly right along the row
      { t0: cutAt(0), row: this.liveRow0, c0: 0.2, c1: lastCol(0) - 0.8, ta: L[0]!.start, tb: L[0]!.end + 0.2,
        yaw: [[start, -0.62], [cutAt(1), -0.5, ease.linear]], pitch: [[start, 0.1], [cutAt(1), 0.13, ease.linear]], dist: [[start, 4.9], [cutAt(1), 5.5, ease.linear]] },
      // "Stack it high, the cache is glow": low angle from the right, looking up the stack
      { t0: cutAt(1), row: this.liveRow0 + 1, c0: 0.8, c1: lastCol(1) - 1.2, ta: L[1]!.start, tb: L[1]!.end + 0.1,
        yaw: [[cutAt(1), 0.5], [cutAt(2), 0.36, ease.linear]], pitch: [[cutAt(1), -0.3], [cutAt(2), -0.2, ease.linear]], dist: [[cutAt(1), 5.4], [cutAt(2), 6.0, ease.linear]] },
      // "Warm, warm, but small, small": frontal; each "small" pulls the camera back (the cache is small)
      { t0: cutAt(2), row: this.liveRow0 + 0.6, c0: 2.6, c1: 3.4, ta: L[2]!.start, tb: L[3]!.start,
        yaw: [[cutAt(2), -0.2], [s1, -0.14, ease.linear], [s1 + 0.3, -0.1, ease.outCubic], [s2, -0.08, ease.linear], [s2 + 0.35, -0.05, ease.outCubic]],
        pitch: [[cutAt(2), 0.06], [cutAt(3), 0.04, ease.linear]],
        dist: [[cutAt(2), 7.0], [s1, 7.8, ease.linear], [s1 + 0.3, 11, ease.outBack as (x: number) => number], [s2, 11.6, ease.linear], [s2 + 0.35, 16, ease.outBack as (x: number) => number], [cutAt(3), 16.5, ease.linear]] },
      // "Something's leaking through the wall": low, at the bottom edge, pixels dripping below
      { t0: cutAt(3), row: this.liveRow0 + 3.25, c0: 0.4, c1: lastCol(3) - 0.6, ta: L[3]!.start, tb: L[3]!.end,
        yaw: [[cutAt(3), -0.4], [this.tiltA, -0.3, ease.linear]], pitch: [[cutAt(3), -0.16], [this.tiltA, -0.1, ease.linear]], dist: [[cutAt(3), 5.2], [this.tiltA, 6.4, ease.linear]] },
    ];

    // leak: pixels drip from the bottom edge of the last row, bunched on the clicks
    const rnd = mulberry32(606);
    const leakEv = this.hits.filter((h) => h >= this.tLeak - 0.02 && h < end);
    const tEnd = end + 0.2;
    for (let i = 0; i < 900; i++) {
      const onHit = rnd() < 0.55 && leakEv.length;
      let ts = onHit ? leakEv[Math.floor(rnd() * leakEv.length)]! + rnd() * 0.05 : this.tLeak + Math.pow(rnd(), 0.7) * (tEnd - this.tLeak);
      const c = Math.floor(rnd() * KV.cols);
      this.drips.push({
        ts, x: cellX(c) + (rnd() - 0.5) * KV.cw * 0.96,
        vx: (rnd() - 0.5) * 0.25, vy: -rnd() * 0.6 - (onHit ? 0.5 : 0),
        s: 0.028 + rnd() * rnd() * 0.07, sig: rnd() < 0.22 ? 1 : 0, streak: rnd() < 0.3 ? 1 + rnd() * 3 : 1,
      });
    }
  }

  /** Camera in world space at t (before the tilt blend). */
  private wallCam(t: number) {
    let sh = this.shots[0]!;
    for (const x of this.shots) if (t >= x.t0) sh = x;
    const fc = lerp(sh.c0, sh.c1, ease.inOutQuad(prog(t, sh.ta, sh.tb)));
    const fx = lerp(cellX(0), cellX(1), fc), fy = cellY(sh.row);
    const yaw = keys(t, sh.yaw) + 0.02 * fbm1(t * 0.35, 3, 11);
    const pitch = keys(t, sh.pitch) + 0.015 * fbm1(t * 0.3, 3, 12);
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const dist = keys(t, sh.dist) * (1 - 0.018 * kick);
    const target = new THREE.Vector3(fx, fy, KV.cd);
    const pos = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
    return { pos, target, up: new THREE.Vector3(0, 1, 0), fov: 32, dist };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, tl } = this.ctx;
    const t = f.t;
    const g = this.grid;
    g.clear();

    // ---- tilt into the table
    const tk = prog(t, this.tiltA, this.tiltB, ease.inOutCubic);
    const tilt = prog(t, this.tiltA, this.tiltB, (x) => ease.inOutQuart(x));
    wallMatrix(tilt, this.wm);
    this.wmi.copy(this.wm).invert();
    const wc = this.wallCam(Math.min(t, this.tiltA));
    const tp = tablePose();
    // during the tilt: the camera rides up and over into the top-down pose (target and position blended)
    const kp = ease.inOutCubic(clamp(tk * 1.05));
    const pos = wc.pos.clone().lerp(tp.pos, kp);
    const target = wc.target.clone().lerp(tp.target, ease.inOutQuad(tk));
    const up = wc.up.clone().lerp(tp.up, ease.inOutQuad(tk)).normalize();
    const cam = this.cam;
    cam.fov = lerp(wc.fov, tp.fov, tk);
    cam.aspect = 16 / 9;
    cam.position.copy(pos);
    cam.up.copy(up);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // ---- global modifiers
    const warm = this.tWarm.reduce((m, w) => Math.max(m, t >= w ? 0.35 + 0.65 * pulse(t, w, 0.25) : 0), 0) * (1 - prog(t, this.tSomething, this.tSomething + 0.6));
    const glowAll = t >= this.tGlow ? 0.6 * pulse(t, this.tGlow, 0.35) : 0;
    let small = 0;
    for (const s of this.tSmall) small += 0.14 * springStep(t - s, 3.2, 0.45);
    small *= 1 - springStep(t - this.tSomething, 2.4, 0.5);
    const cellS = 1 - small;
    const leak = prog(t, this.tLeak, this.tiltB + 0.0) * LEAK_END;

    // ---- the focus word (for light pool + DOF)
    let focusW: LiveWord | null = null;
    for (const lw of this.live) if (lw.w.start <= t + 0.1) focusW = lw;
    const fr = focusW?.r ?? this.liveRow0, fc = focusW?.c ?? 0;

    // ---- cells
    const hitsNow = this.hits.filter((h) => h <= t && h > t - 0.9);
    for (let r = 0; r < TABLE_ROWS; r++) {
      const row = this.rows[r]!;
      const isLive = r >= this.liveRow0;
      const lineStart = isLive ? row.line!.start : -1;
      for (let c = 0; c < KV.cols; c++) {
        const slot = this.slots[r]![c]!;
        let lit = 0.16, sig = 0, heat = 0, reveal = 1, z = KV.cd / 2, alpha = 1, dissolve = 0;
        if (isLive) {
          // before the line: an empty, dark row waiting to be written
          const sweep = prog(t, lineStart - 0.06 + c * 0.035, lineStart + 0.1 + c * 0.035, ease.outCubic);
          lit = lerp(0.03, 0.55, sweep) + 0.5 * pulse(t, lineStart + c * 0.035, 0.12) * (t >= lineStart ? 1 : 0);
          const w = row.line!.words[c];
          if (w) {
            reveal = prog(t, w.start - 0.03, w.start + 0.14, ease.outCubic);
            const on = t >= w.start - 0.03;
            heat = on ? 1 : 0;
            const active = t >= w.start && t < w.end;
            sig = on ? (active ? 1 : pulse(t, w.end, 0.12)) : 0;
            if (on) {
              lit = Math.max(lit, 0.85);
              z += 0.34 * Math.exp(-(t - w.start) / 0.13) * (t >= w.start ? 1 : 0) + 0.08 * prog(t, w.start, w.start + 0.2);
            }
          } else {
            reveal = 1; // <pad> cells
          }
          if (t < lineStart - 0.06) { lit = 0.02; reveal = w ? 0 : 1; }
          if (r === TABLE_ROWS - 1) dissolve = leak > 0 ? leak * (0.75 + 0.5 * hash(c, 3)) : 0;
        } else {
          // attention: each click lights a few cached cells
          for (let i = 0; i < hitsNow.length; i++) {
            const h = hitsNow[i]!;
            const hi = Math.round(h * 1000);
            for (let j = 0; j < 3; j++) {
              if (Math.floor(hash(hi, j, 1) * this.liveRow0) === r && Math.floor(hash(hi, j, 2) * KV.cols) === c) lit += 0.9 * pulse(t, h, 0.14);
            }
          }
          lit += 0.22 * warm * hash(r, c, 5);
        }
        const x = cellX(c), y = cellY(r);
        this.grid.push({
          x, y, z, sx: KV.cw * cellS, sy: KV.chh * cellS, slot,
          reveal, lit: Math.min(lit, 1.4), signal: sig, heat, alpha, dissolve,
        });
      }
    }

    // ---- the cursor: a magenta block in the next key cell, blinking on the beat
    if (focusW || t < this.lineStarts[0]!) {
      let cr = fr, cc = fc + 1;
      const row = this.rows[cr]!;
      const lastW = row.line!.words[fc];
      const typing = lastW ? t < lastW.end + 0.05 : false;
      if (cc >= row.line!.words.length) { cr = fr + 1; cc = 0; }
      if (!focusW) { cr = this.liveRow0; cc = 0; }
      if (cr < TABLE_ROWS) {
        const on = typing || cursorOn(t, tl);
        const blinkOff = t > this.tiltA ? prog(t, this.tiltA, this.tiltB) : 0;
        if (on && blinkOff < 1) {
          const x = cellX(cc) - KV.cw * cellS / 2 + 0.14, y = cellY(cr);
          g.push({ x: x + 0.045, y, z: KV.cd + 0.02, sx: 0.09, sy: 0.3, sz: 0.04, slot: 0, pixel: true, lit: 2.2 * (1 - blinkOff), signal: 1 });
        }
      }
    }

    // ---- leak: pixels falling in world space (gravity is world -y, also during the tilt)
    const bottomY = cellY(TABLE_ROWS - 1) - KV.chh / 2;
    for (const d of this.drips) {
      const a = t - d.ts;
      if (a < 0 || a > 1.6) continue;
      // spawn point on the (possibly tilting) wall, then fall straight down in world space
      this.v.set(d.x * cellS, bottomY + (1 - cellS) * KV.chh * 0.5, KV.cd * 0.5).applyMatrix4(wallMatrix(prog(d.ts, this.tiltA, this.tiltB, (x) => ease.inOutQuart(x))));
      this.v.x += d.vx * a;
      this.v.y += d.vy * a - 4.2 * a * a;
      this.v.applyMatrix4(this.wmi); // back to wall space for the instanced renderer
      const fade = 1 - prog(a, 1.0, 1.6);
      const fl = hash(Math.round(d.ts * 1000), 9) < 0.5 ? 1 : 0.6;
      g.push({ x: this.v.x, y: this.v.y, z: this.v.z, sx: d.s, sy: d.s * (1 + (d.streak - 1) * clamp(a * 3)), sz: d.s, slot: 0, pixel: true, lit: 1.2 * fade * fl, signal: d.sig });
    }

    // ---- light, fog, draw
    const fW = new THREE.Vector3(cellX(fc), cellY(fr), KV.cd).applyMatrix4(this.wm);
    const u = g.u;
    (u.wallMatrix!.value as THREE.Matrix4).copy(this.wm);
    (u.camPos!.value as THREE.Vector3).copy(cam.position);
    (u.lightPos!.value as THREE.Vector3).copy(fW).add(new THREE.Vector3(0, 0, 0.8).applyMatrix4(new THREE.Matrix4().extractRotation(this.wm)));
    const wide = t >= this.shots[2]!.t0 && t < this.shots[3]!.t0 ? 1 : 0;
    u.lightR!.value = lerp(1.7, 5, wide) * (1 + 0.25 * warm);
    u.fogStart!.value = lerp(5, 12, Math.max(wide, tk));
    u.fogLen!.value = lerp(9, 30, Math.max(wide, tk));
    u.warm!.value = warm;
    u.glowAll!.value = glowAll;

    this.dof.begin(renderer, LIN.ink);
    g.draw(renderer, this.dof.rt, cam);
    const focus = cam.position.distanceTo(fW) * 0.98;
    const ap = lerp(lerp(22, 9, wide), 0, tk);
    this.dof.resolve(renderer, cam, out, { focus: lerp(focus, cam.position.distanceTo(target), Math.max(wide, tk)), aperture: ap, maxCoc: lerp(22, 1, tk) });

    // the wall fills the frame edge to edge in the close-ups: the global counter gets an ink plate so it
    // never reads over (or through) cell text
    return { bloom: 0.55 + 0.4 * glowAll + 0.15 * warm, bloomThreshold: 0.8, halation: 0.3 + 0.2 * warm, vignette: 0.42, grain: 0.05, counterPlate: 1 };
  }

  override dispose() { this.dof.dispose(); }
}
