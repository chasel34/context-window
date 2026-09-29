// s13 · keystorm (Drop: keyboard clicks + vocal chops). Every click of the kit drops one row of Plex Mono
// characters (the words of the song so far) out of the dark; each row lands exactly on its click and
// stacks one more layer of tokens onto a voxel terrain: columns of stacked glyphs, the newest layer
// flashing magenta. Vocal chops send rings through the field (columns jump, glyphs flare). Camera: two
// bars straight down from high above while the rain starts, a long swoop down onto the terrain on the
// drop, a low banking flight over the token hills, a final dive. Last bar: four full-frame magenta
// flashes on the beats, hard cut to s14 on the downbeat.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass } from '../engine/gl';
import { LIN } from '../engine/palette';
import { GLSL_COMMON } from '../engine/glsl/common';
import { F, font, plain } from '../engine/type';
import { clamp, ease, fbm1, hash, keys, lerp, mulberry32, prog, type Key } from '../engine/util';
import { DofRenderer } from '../shared/c_dof';
import { SlotAtlas, SLOT_GLSL, ch } from '../shared/c_glyphs';

// ------------------------------------------------------------------ terrain (JS + GLSL twins)
const N = 88; // columns per side
const CELL = 1.0;
const Z0 = -10; // grid centre z (the flight goes toward -z)
const LH = 0.34; // one token layer
const MAXE = 80; // click events (uniform array size)
const MAXV = 40; // vocal rings
const GRAV = 150;

const BASE_GLSL = /* glsl */ `
float baseH(vec2 p) {
  return 1.3 + 1.1 * sin(0.21 * p.x + 0.7 * sin(0.13 * p.y)) * sin(0.17 * p.y + 0.5 * sin(0.11 * p.x))
    + 0.55 * sin(0.37 * p.x - 0.29 * p.y + 1.3) * sin(0.41 * p.y + 0.23 * p.x)
    + 0.25 * sin(0.9 * p.x + 0.7 * p.y) * sin(0.8 * p.y - 0.6 * p.x + 0.4);
}`;
const baseH = (x: number, y: number) =>
  1.3 + 1.1 * Math.sin(0.21 * x + 0.7 * Math.sin(0.13 * y)) * Math.sin(0.17 * y + 0.5 * Math.sin(0.11 * x))
  + 0.55 * Math.sin(0.37 * x - 0.29 * y + 1.3) * Math.sin(0.41 * y + 0.23 * x)
  + 0.25 * Math.sin(0.9 * x + 0.7 * y) * Math.sin(0.8 * y - 0.6 * x + 0.4);

const HEIGHT_GLSL = /* glsl */ `
uniform vec4 uSegP[${MAXE}]; // ax, az, bx, bz
uniform vec4 uSegQ[${MAXE}]; // tLand, amp, width, -
uniform int uNE;
uniform vec4 uVox[${MAXV}]; // x, z, t, strength
uniform int uNV;
uniform float uTime, uGrow;
${BASE_GLSL}
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// x: height (unquantized), y: fresh deposit glow, z: ring glow
vec3 terrain(vec2 p) {
  float h = baseH(p) * uGrow;
  float fresh = 0.0, ring = 0.0;
  for (int i = 0; i < ${MAXE}; i++) {
    if (i >= uNE) break;
    vec4 P = uSegP[i], Q = uSegQ[i];
    float a = uTime - Q.x;
    if (a < 0.0) continue;
    float d = segD(p, P.xy, P.zw);
    float g = exp(-d * d / (Q.z * Q.z));
    h += Q.y * g * smoothstep(0.0, 0.07, a);
    fresh += g * g * exp(-a / 0.16);
  }
  for (int i = 0; i < ${MAXV}; i++) {
    if (i >= uNV) break;
    vec4 V = uVox[i];
    float a = uTime - V.z;
    if (a < 0.0 || a > 1.4) continue;
    float d = length(p - V.xy) - 16.0 * a;
    float r = exp(-d * d / 3.0) * exp(-a * 2.6) * V.w;
    ring += r;
  }
  h += 0.9 * ring;
  return vec3(h, fresh, ring);
}`;

const COL_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 iCell;
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
${HEIGHT_GLSL}
out vec3 vW; out vec3 vN; out vec3 vLoc; out float vH; out float vFresh; out float vRing; out vec2 vCell;
void main() {
  vec2 c = vec2((iCell.x - ${(N / 2).toFixed(1)} + 0.5) * ${CELL.toFixed(3)}, (iCell.y - ${(N / 2).toFixed(1)} + 0.5) * ${CELL.toFixed(3)} + ${Z0.toFixed(2)});
  vec3 tr = terrain(c);
  float hq = max(1.0, floor(tr.x / ${LH.toFixed(3)})) * ${LH.toFixed(3)};
  vec3 p = vec3(c.x + position.x * ${(CELL * 0.9).toFixed(3)}, position.y * hq, c.y + position.z * ${(CELL * 0.9).toFixed(3)});
  vW = p; vN = normal; vLoc = vec3(position.x, position.y * hq / ${LH.toFixed(3)}, position.z);
  vH = hq; vFresh = tr.y; vRing = tr.z; vCell = iCell;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const COL_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vW; in vec3 vN; in vec3 vLoc; in float vH; in float vFresh; in float vRing; in vec2 vCell;
out vec4 fragColor;
${GLSL_COMMON}
${SLOT_GLSL}
uniform sampler2D atlas; uniform vec4 atlasGrid; uniform vec3 camPos; uniform float fogStart, fogLen, uTime, uHot;
float glyph(vec2 cont, float idx) {
  vec2 g = fract(cont);
  vec2 dx = dFdx(cont) * atlasGrid.zw, dy = dFdy(cont) * atlasGrid.zw;
  return textureGrad(atlas, slotUV(idx, g, atlasGrid), dx, dy).r;
}
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.35));
  float lam = 0.35 + 0.65 * sat(dot(n, L));
  float layers = vH / ${LH.toFixed(3)};
  float hn = sat(vH / 7.0);
  vec3 col;
  float fresh = sat(vFresh * 0.9), ring = sat(vRing);
  if (n.y > 0.5) {
    float idx = floor(hash13(vec3(vCell, floor(layers + 0.5))) * 94.0);
    float gl = glyph(vec2(vLoc.x + 0.5, vLoc.z + 0.5), idx);
    col = C_INK2 * (0.5 + 0.9 * hn) * lam;
    vec3 gc = C_BONE * (0.22 + 1.05 * hn) * lam;
    gc = mix(gc, C_SIGNAL_HOT * 2.2, fresh);
    gc = mix(gc, C_SIGNAL * 2.4, ring * (1.0 - fresh));
    col += gc * gl;
    col += C_SIGNAL_DEEP * 0.12 * fresh;
  } else {
    float u = abs(n.x) > 0.5 ? vLoc.z + 0.5 : vLoc.x + 0.5;
    float v = vLoc.y;
    float lay = floor(v);
    float idx = floor(hash13(vec3(vCell + n.xz * 17.0, lay)) * 94.0);
    float gl = glyph(vec2(u, lay + 1.0 - fract(v)), idx);
    float top = sat(v - (layers - 1.0)); // the topmost layer on the sides
    col = C_INK2 * 0.35 * lam;
    vec3 gc = C_BONE * (0.06 + 0.22 * hn + 0.25 * top) * lam;
    gc = mix(gc, C_SIGNAL_HOT * 2.2, fresh * top);
    gc = mix(gc, C_SIGNAL * 1.4, ring * 0.7);
    col += gc * gl;
  }
  float dist = length(vW - camPos);
  float fog = exp(-max(dist - fogStart, 0.0) / fogLen);
  fragColor = vec4(col * fog * uHot, 1.0);
}`;

// falling glyphs: camera-facing quads
const RAIN_VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 iPos; in vec4 iG; // glyph, size, intensity, signal
uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
out vec2 vUv; out vec4 vG; out vec3 vW;
void main() {
  vec4 v = viewMatrix * vec4(iPos, 1.0);
  v.xy += position.xy * iG.y;
  vUv = vec2(position.x + 0.5, 0.5 - position.y); vG = iG; vW = iPos;
  gl_Position = projectionMatrix * v;
}`;
const RAIN_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv; in vec4 vG; in vec3 vW;
out vec4 fragColor;
${GLSL_COMMON}
${SLOT_GLSL}
uniform sampler2D atlas; uniform vec4 atlasGrid; uniform vec3 camPos; uniform float fogStart, fogLen;
void main() {
  float g = texture(atlas, slotUV(vG.x, vUv, atlasGrid)).r;
  if (g < 0.02) discard;
  vec3 c = mix(C_BONE * 1.3, C_SIGNAL_HOT * 2.6, vG.w) * vG.z;
  float dist = length(vW - camPos);
  float fog = exp(-max(dist - fogStart, 0.0) / (fogLen * 1.3));
  fragColor = vec4(c * g * fog, 1.0);
}`;

const FLASH = /* glsl */ `uniform float a; void main() { fragColor = vec4(C_SIGNAL * a, a); }`;

const GLYPHS = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i));

interface Ev { t: number; ax: number; az: number; bx: number; bz: number; amp: number; w: number; text: string; chars: { x: number; z: number; g: number; dt: number; sig: number }[] }

export default class S13Keystorm extends Scene {
  dof = new DofRenderer();
  cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
  scene = new THREE.Scene();
  atlas!: SlotAtlas;
  colMat!: THREE.RawShaderMaterial;
  rainGeo!: THREE.InstancedBufferGeometry;
  rainPos = new Float32Array(3000 * 3);
  rainG = new Float32Array(3000 * 4);
  rainAttrs: THREE.InstancedBufferAttribute[] = [];
  flash: FSPass;
  events: Ev[] = [];
  vox: [number, number, number, number][] = [];
  flashes: number[] = [];
  bar = (i: number) => this.ctx.tl.timeOfBar(Math.round(this.ctx.tl.bar(this.ctx.start)) + i);

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    this.flash = new FSPass(FLASH, { a: { value: 0 } }, { transparent: true });
    const m = this.flash.mat;
    m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  }

  override init() {
    const { renderer, audio, tl, lyrics, start, end } = this.ctx;
    // glyph atlas: printable ASCII in Plex Mono
    this.atlas = new SlotAtlas(64, 64, GLYPHS.length, 1024);
    for (const gch of GLYPHS) this.atlas.add((c, w, h) => {
      c.fillStyle = ch('r'); c.font = font(F.mono(500), 46); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(gch, w / 2, h / 2 + 2);
    });
    this.atlas.finish(renderer);

    // columns
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.getAttribute('position'));
    geo.setAttribute('normal', box.getAttribute('normal'));
    const cells = new Float32Array(N * N * 2);
    for (let i = 0; i < N * N; i++) { cells[i * 2] = i % N; cells[i * 2 + 1] = Math.floor(i / N); }
    geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = N * N;
    const uniforms = {
      uSegP: { value: Array.from({ length: MAXE }, () => new THREE.Vector4()) },
      uSegQ: { value: Array.from({ length: MAXE }, () => new THREE.Vector4()) },
      uNE: { value: 0 }, uVox: { value: Array.from({ length: MAXV }, () => new THREE.Vector4()) }, uNV: { value: 0 },
      uTime: { value: 0 }, uGrow: { value: 0.3 }, uHot: { value: 1 },
      atlas: { value: this.atlas.texture }, atlasGrid: { value: this.atlas.grid },
      camPos: { value: new THREE.Vector3() }, fogStart: { value: 20 }, fogLen: { value: 30 },
    };
    this.colMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: COL_VERT, fragmentShader: COL_FRAG, uniforms });
    const cols = new THREE.Mesh(geo, this.colMat);
    cols.frustumCulled = false;
    this.scene.add(cols);

    // rain
    const quad = new THREE.PlaneGeometry(1, 1);
    this.rainGeo = new THREE.InstancedBufferGeometry();
    this.rainGeo.index = quad.index;
    this.rainGeo.setAttribute('position', quad.getAttribute('position'));
    const a1 = new THREE.InstancedBufferAttribute(this.rainPos, 3), a2 = new THREE.InstancedBufferAttribute(this.rainG, 4);
    a1.setUsage(THREE.DynamicDrawUsage); a2.setUsage(THREE.DynamicDrawUsage);
    this.rainGeo.setAttribute('iPos', a1); this.rainGeo.setAttribute('iG', a2);
    this.rainAttrs = [a1, a2];
    const rainMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
      uniforms: { atlas: uniforms.atlas, atlasGrid: uniforms.atlasGrid, camPos: uniforms.camPos, fogStart: uniforms.fogStart, fogLen: uniforms.fogLen },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    const rain = new THREE.Mesh(this.rainGeo, rainMat);
    rain.frustumCulled = false;
    rain.renderOrder = 1;
    this.scene.add(rain);

    // clicks: every drum onset (the 8th-note roll first, then hats/kicks/snares), deduped
    const raw = [...audio.events('kick', start - 0.02, end), ...audio.events('hat', start - 0.02, end), ...audio.events('snare', start - 0.02, end)]
      .map((e) => e[0]).sort((a, b) => a - b);
    const clicks: number[] = [];
    for (const x of raw) if (!clicks.length || x - clicks[clicks.length - 1]! > 0.04) clicks.push(x);
    // the words of the song so far, as the token stream
    const words = lyrics.lines.filter((l) => l.start < start).flatMap((l) => l.words.map((w) => plain(w.w).replace(/[^\x21-\x7e]/g, '')));
    const rnd = mulberry32(1313);
    let wi = 0;
    for (const t of clicks.slice(0, MAXE)) {
      const tg = this.camAt(t).target;
      const early = t < this.bar(2);
      const R = early ? 17 : 11;
      const ang = rnd() * Math.PI;
      const cx = tg.x + (rnd() - 0.5) * 2 * R, cz = tg.z + (rnd() - 0.5) * 2 * R - (early ? 0 : 4);
      let text = '';
      const len = 8 + Math.floor(rnd() * (early ? 10 : 18));
      while (text.length < len) { text += (text ? ' ' : '') + words[wi % words.length]; wi++; }
      const L = text.length * 0.78;
      let dx = Math.cos(ang), dz = Math.sin(ang);
      // make the row read left to right from where the camera is when it lands
      const cl = this.camAt(t), tc = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
      tc.position.copy(cl.pos); tc.up.copy(cl.up); tc.lookAt(cl.target); tc.updateMatrixWorld();
      const pa = new THREE.Vector3(cx - dx, 0, cz - dz).project(tc), pb = new THREE.Vector3(cx + dx, 0, cz + dz).project(tc);
      if (pb.x < pa.x) { dx = -dx; dz = -dz; }
      const ev: Ev = {
        t, ax: cx - dx * L / 2, az: cz - dz * L / 2, bx: cx + dx * L / 2, bz: cz + dz * L / 2,
        amp: (0.5 + rnd() * 0.7) * (early ? 0.8 : 0.85), w: 2.0 + rnd() * 2.2, text, chars: [],
      };
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code < 33 || code > 126) continue;
        const k = (i + 0.5) / text.length;
        ev.chars.push({ x: lerp(ev.ax, ev.bx, k), z: lerp(ev.az, ev.bz, k), g: code - 33, dt: (rnd() - 0.5) * 0.05, sig: rnd() < 0.12 ? 1 : 0 });
      }
      this.events.push(ev);
    }
    // vocal chops → rings
    for (const [t, s] of audio.events('vocal', start, end)) {
      if (s < 0.3 || this.vox.length >= MAXV) continue;
      const tg = this.camAt(t).target;
      this.vox.push([tg.x + (hash(t, 1) - 0.5) * 14, tg.z + (hash(t, 2) - 0.5) * 10 - 3, t, 0.6 + s]);
    }
    const u = this.colMat.uniforms;
    this.events.forEach((e, i) => {
      (u.uSegP!.value as THREE.Vector4[])[i]!.set(e.ax, e.az, e.bx, e.bz);
      (u.uSegQ!.value as THREE.Vector4[])[i]!.set(e.t, e.amp, e.w, 0);
    });
    this.vox.forEach((v, i) => (u.uVox!.value as THREE.Vector4[])[i]!.set(...v));
    u.uNV!.value = this.vox.length;
    // the last bar: four flashes on its beats
    const b8 = this.bar(8);
    this.flashes = [0, 1, 2, 3].map((i) => tl.timeOfBeat(Math.round(tl.beat(b8)) + i));
  }

  /** Terrain growth (the base hills rise as tokens pile up). */
  private grow(t: number) { return lerp(0.25, 1.0, prog(t, this.bar(0), this.bar(8.5), ease.inOutQuad)); }

  /** JS twin of the GLSL terrain height at time t (for landing heights). */
  private height(x: number, z: number, t: number, quant = true) {
    let h = baseH(x, z) * this.grow(t);
    for (const e of this.events) {
      const a = t - e.t;
      if (a < 0) break;
      const bax = e.bx - e.ax, baz = e.bz - e.az, pax = x - e.ax, paz = z - e.az;
      const k = clamp((pax * bax + paz * baz) / (bax * bax + baz * baz));
      const d2 = (pax - bax * k) ** 2 + (paz - baz * k) ** 2;
      h += e.amp * Math.exp(-d2 / (e.w * e.w)) * clamp(a / 0.07);
    }
    return quant ? Math.max(1, Math.floor(h / LH)) * LH : h;
  }

  /** Smoothed ground level around (x, z): spatial 5-tap, temporal 4-tap (no jumps on each click). */
  private ground(x: number, z: number, t: number) {
    let s = 0;
    for (const dt of [0, 0.1, 0.2, 0.3]) for (const [ox, oz] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]] as const) s += this.height(x + ox, z + oz, t - dt, false);
    return s / 20;
  }

  /** Camera path: straight down from high above → swoop onto the terrain → low banking flight → dive. */
  camAt(t: number) {
    const b = (i: number) => this.bar(i);
    const dive = ease.inOutCubic(prog(t, b(2), b(4.75)));
    // target glides forward (−z) over the flight
    const fwd = keys(t, [[b(0), 0], [b(2), 0], [b(4.75), -6, ease.inOutCubic], [b(8), -22, ease.linear], [b(9), -29, ease.linear]]);
    const tx = keys(t, [[b(0), 0], [b(4.75), 0], [b(6.5), 5, ease.inOutCubic], [b(8), -3, ease.inOutCubic], [b(9), -5, ease.linear]]);
    const target = new THREE.Vector3(tx, lerp(0, 2.2, dive), fwd);
    // spherical offset from the target
    // overhead phase ~1.3× closer than first cut so the terrain glyphs read at preview resolution
    const height = keys(t, [[b(0), 35], [b(2), 31, ease.linear], [b(4.75), 7.5, ease.inOutCubic], [b(8), 5.5, ease.inOutQuad], [b(9), 3.4, ease.inQuad]]);
    const back = keys(t, [[b(0), 6], [b(2), 9, ease.linear], [b(4.75), 15, ease.inOutCubic], [b(8), 11, ease.inOutQuad], [b(9), 7, ease.inQuad]]);
    const yaw = keys(t, [[b(0), -0.2], [b(2), 0.25, ease.linear], [b(4.75), 0.05, ease.inOutCubic], [b(6.5), -0.35, ease.inOutCubic], [b(8), 0.3, ease.inOutCubic], [b(9), 0.45, ease.linear]]);
    if (this.events.length) {
      // ride the terrain: the target sits on the ground, the camera keeps clear of the hills under it
      const gT = this.ground(target.x, target.z, t);
      target.y = lerp(0, gT + 0.6, dive);
    }
    const pos = new THREE.Vector3(target.x + Math.sin(yaw) * back, target.y + height, target.z + Math.cos(yaw) * back);
    if (this.events.length) pos.y = Math.max(pos.y, this.ground(pos.x, pos.z, t) + 2.2);
    // top-down: up vector spins slowly; in flight: banked
    const spin = lerp(-0.4, 0.15, prog(t, b(0), b(2.5)));
    const bank = 0.12 * Math.sin((t - b(4)) * 0.9) * prog(t, b(4), b(5));
    const upTop = new THREE.Vector3(Math.sin(spin), 0, -Math.cos(spin));
    const up = upTop.lerp(new THREE.Vector3(Math.sin(bank), 1, 0), ease.inOutQuad(prog(t, b(2.2), b(4)))).normalize();
    return { pos, target, up };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, audio } = this.ctx;
    const t = f.t;
    const cp = this.camAt(t);
    const snare = audio.hit('snare', t, 0.08), kick = audio.hit('kick', t, 0.08);
    const cam = this.cam;
    const sh = 0.05 * snare + 0.02 * kick;
    cam.position.copy(cp.pos).add(new THREE.Vector3(fbm1(t * 7, 2, 1) * sh, fbm1(t * 7, 2, 2) * sh, 0));
    cam.up.copy(cp.up);
    cam.fov = keys(t, [[this.bar(0), 38], [this.bar(2), 42], [this.bar(4.75), 50, ease.inOutCubic], [this.bar(9), 62, ease.inQuad]]) + 2.5 * kick;
    cam.aspect = 16 / 9;
    cam.lookAt(cp.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const u = this.colMat.uniforms;
    let ne = 0;
    while (ne < this.events.length && this.events[ne]!.t <= t + 0.001) ne++;
    u.uNE!.value = ne;
    u.uTime!.value = t;
    u.uGrow!.value = this.grow(t);
    (u.camPos!.value as THREE.Vector3).copy(cam.position);
    const topDown = 1 - prog(t, this.bar(2), this.bar(4.5));
    u.fogStart!.value = lerp(14, 40, topDown);
    u.fogLen!.value = lerp(22, 40, topDown);
    u.uHot!.value = 1 + 0.25 * kick;

    // rain: rows in flight
    let n = 0;
    const FALL = 0.62;
    for (let ei = 0; ei < this.events.length; ei++) {
      const e = this.events[ei]!;
      if (t < e.t - FALL - 0.05 || t > e.t + 0.05) continue;
      for (const c of e.chars) {
        const tl = e.t + c.dt;
        const a = tl - t; // time to landing
        if (a < 0 || a > FALL) continue;
        const hL = this.height(c.x, c.z, tl - 0.001);
        const y = hL + 0.5 * GRAV * a * a + 0.25;
        const k = n++;
        this.rainPos[k * 3] = c.x; this.rainPos[k * 3 + 1] = y; this.rainPos[k * 3 + 2] = c.z;
        const fadeIn = clamp((FALL - a) / 0.1) * clamp((Math.hypot(c.x - cam.position.x, y - cam.position.y, c.z - cam.position.z) - 1.5) / 2.5);
        this.rainG[k * 4] = c.g; this.rainG[k * 4 + 1] = lerp(0.95, 2.0, topDown); this.rainG[k * 4 + 2] = 1.2 * fadeIn * (1 + 1.5 * clamp(1 - a / 0.08)); this.rainG[k * 4 + 3] = c.sig;
        if (n >= 3000) break;
      }
    }
    for (const at of this.rainAttrs) { at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, n * at.itemSize); }
    this.rainGeo.instanceCount = n;

    this.dof.begin(renderer, LIN.ink);
    renderer.render(this.scene, cam);
    const focus = cam.position.distanceTo(cp.target);
    const flight = prog(t, this.bar(3.5), this.bar(5));
    this.dof.resolve(renderer, cam, out, { focus, aperture: lerp(3, 14, flight), maxCoc: lerp(3, 14, flight) });

    // the last bar: four magenta flashes on the beats
    let fl = 0;
    for (const x of this.flashes) if (t >= x) fl = Math.max(fl, t - x < 0.09 ? 1 : Math.exp(-(t - x - 0.09) / 0.05));
    if (fl > 0.002) { this.flash.u.a!.value = fl; this.flash.render(renderer, out); }
    const paper = fl > 0.5 ? 1 : 0;
    return {
      bloom: 0.6 + 0.3 * kick, bloomThreshold: paper ? 1.3 : 0.8, halation: 0.3, vignette: 0.45, grain: 0.06,
      paper, rgbSplit: 2.5 * snare, ca: 1.5,
    };
  }

  override dispose() { this.dof.dispose(); }
}
