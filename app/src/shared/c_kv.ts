// The KV-cache grid shared by s06 (a 3D wall of cells) and s07 (the same grid tilted flat into a
// top-down table). One row per lyric line of the conversation so far; each cell is a key/value
// slab: the word (key) on the left, a small value vector on the right. Content, layout, the
// instanced slab renderer and the hand-over camera pose live here so both scenes agree exactly.
import * as THREE from 'three';
import type { Lyrics, Line } from '../engine/lyrics';
import { GLSL_COMMON } from '../engine/glsl/common';
import { F, font, measure, plain } from '../engine/type';
import { hash } from '../engine/util';
import { SlotAtlas, SLOT_GLSL, ch } from './c_glyphs';

// ------------------------------------------------------------------ layout (wall space: x right, y up, z out of the wall)
export const KV = {
  cols: 8,
  cw: 1.8, // cell width
  chh: 0.62, // cell height
  cd: 0.16, // slab depth
  px: 1.9, // column pitch
  py: 0.74, // row pitch
};
/** Wall-space centre of cell (r, c) (front face at z = cd). */
export const cellX = (c: number) => (c - (KV.cols - 1) / 2) * KV.px;
export const cellY = (r: number) => -r * KV.py;

export interface KvRow {
  text: string;
  words: string[];
  /** The sung line when the row is written live on screen (s06/s07 lyric rows). */
  line: Line | null;
  live: boolean;
}

/** Lyric lines already "in context" before s06 (unique, full lines only), then the live rows. */
export function buildRows(lyrics: Lyrics, liveFrom: number, liveTo: number): KvRow[] {
  const rows: KvRow[] = [];
  const seen = new Set<string>();
  for (const l of lyrics.lines) {
    if (l.start >= liveFrom) break;
    if (/—$/.test(l.text) || seen.has(l.text)) continue; // skip the stuttered fragments and repeats
    seen.add(l.text);
    rows.push({ text: l.text, words: l.words.map((w) => w.w), line: l, live: false });
  }
  for (const l of lyrics.lines) {
    if (l.start < liveFrom || l.start >= liveTo) continue;
    rows.push({ text: l.text, words: l.words.map((w) => w.w), line: l, live: true });
  }
  return rows;
}

// ------------------------------------------------------------------ cell faces (atlas)
const SW = 448, SH = 154; // slot px, aspect ≈ cw / chh
const KSPLIT = 0.66; // key | value split (fraction of the width)

const fmtVal = (v: number) => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(3);

function drawFace(c: CanvasRenderingContext2D, w: number, h: number, word: string | null, r: number, col: number, live: boolean) {
  const kw = w * KSPLIT;
  // B: decor — k/v labels, index, divider
  c.fillStyle = ch('b');
  c.font = font(F.mono(500), 15);
  c.textBaseline = 'alphabetic';
  c.fillText('k', 16, 26);
  c.fillText('v', kw + 14, 26);
  c.fillStyle = ch('b', 0.8);
  c.font = font(F.mono(400), 13);
  c.fillText(`${String(r).padStart(2, '0')}.${col}`, 16, h - 14);
  c.fillRect(kw, 14, 1.5, h - 28);
  // G: value vector
  c.fillStyle = ch('g');
  c.font = font(F.mono(400), 19);
  for (let i = 0; i < 3; i++) {
    const v = (hash(r, col, i, 7) * 2 - 1) * (i === 0 ? 1.4 : 0.9);
    c.fillText(fmtVal(v), kw + 14, 58 + i * 27);
  }
  // R: the key
  if (word == null) {
    c.fillStyle = ch('g', 0.55);
    c.font = font(F.mono(400), 26);
    c.fillText('<pad>', 16, h / 2 + 12);
    return;
  }
  const fam = live ? F.display(800) : F.mono(600);
  const txt = live ? word : plain(word);
  const max = live ? 50 : 46;
  const size = Math.min(max, (max * (kw - 36)) / Math.max(1, measure(txt, fam, max)));
  c.fillStyle = ch('r');
  c.font = font(fam, size);
  c.fillText(txt, 16, h / 2 + size * 0.36);
}

let cache: { atlas: SlotAtlas; slots: number[][]; rowsKey: string } | null = null;

/** Build (once, shared by s06 and s07) the atlas of every cell face: slots[r][c]. */
export function buildAtlas(renderer: THREE.WebGLRenderer, rows: KvRow[]) {
  const key = rows.map((r) => r.text).join('|');
  if (cache && cache.rowsKey === key) return cache;
  const atlas = new SlotAtlas(SW, SH, rows.length * KV.cols + 4);
  const slots = rows.map((row, r) => Array.from({ length: KV.cols }, (_, c) =>
    atlas.add((cx, w, h) => drawFace(cx, w, h, row.words[c] ?? null, r, c, row.live))));
  atlas.finish(renderer);
  cache = { atlas, slots, rowsKey: key };
  return cache;
}

// ------------------------------------------------------------------ instanced slabs
const VERT = /* glsl */ `
precision highp float;
in vec3 position; in vec3 normal; in vec2 uv;
in vec3 iPos; in vec3 iRot; in vec3 iScale; in float iSlot; in vec4 iA; in vec4 iB;
uniform mat4 viewMatrix; uniform mat4 projectionMatrix; uniform mat4 wallMatrix;
out vec3 vN; out vec2 vUv; out vec3 vW; out vec3 vL; out float vSlot; out vec4 vA; out vec4 vB; out vec3 vS;
mat3 rotXYZ(vec3 r) {
  float cx = cos(r.x), sx = sin(r.x), cy = cos(r.y), sy = sin(r.y), cz = cos(r.z), sz = sin(r.z);
  mat3 X = mat3(1, 0, 0, 0, cx, sx, 0, -sx, cx);
  mat3 Y = mat3(cy, 0, -sy, 0, 1, 0, sy, 0, cy);
  mat3 Z = mat3(cz, sz, 0, -sz, cz, 0, 0, 0, 1);
  return Z * Y * X;
}
void main() {
  mat3 R = rotXYZ(iRot);
  vec3 p = R * (position * iScale) + iPos;
  vec4 w = wallMatrix * vec4(p, 1.0);
  vW = w.xyz; vL = p;
  vN = normalize(mat3(wallMatrix) * (R * normal));
  vUv = uv; vSlot = iSlot; vA = iA; vB = iB; vS = position; // vS: unit-box coords (-0.5..0.5)
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vN; in vec2 vUv; in vec3 vW; in vec3 vL; in float vSlot; in vec4 vA; in vec4 vB; in vec3 vS;
out vec4 fragColor;
${GLSL_COMMON}
${SLOT_GLSL}
uniform sampler2D atlas; uniform vec4 atlasGrid;
uniform vec3 camPos; uniform vec3 lightPos; uniform float lightR, fogStart, fogLen, warm, glowAll, time;
// vA: reveal, lit, signal, alpha   vB: strike, heat, kind (0 cell, 1 pixel), dissolve
void main() {
  float alpha = vA.w;
  vec3 col;
  float dl = length(vW - lightPos);
  float pool = exp(-dl * dl / (lightR * lightR));
  if (vB.z > 0.5 && vB.z < 1.5) {
    // a leaked pixel: emissive square
    col = mix(C_BONE * 1.4, C_SIGNAL_HOT * 2.2, vA.z) * vA.y;
  } else {
    bool front = vS.z > 0.49;
    vec2 fuv = vec2(vS.x + 0.5, 0.5 - vS.y); // front face uv (0,0 top-left)
    float lit = vA.y, sig = vA.z, heat = vB.y;
    // pixelated erosion from the bottom of the cell (the leak)
    if (vB.w > 0.0) {
      vec2 g = floor(fuv * vec2(36.0, 12.0));
      float e = hash12(g + vSlot * 13.1) * 0.6 + (1.0 - fuv.y) * 0.55;
      if (e < vB.w * 1.2 - 0.05) discard;
    }
    if (front) {
      vec3 tx = texture(atlas, slotUV(vSlot, fuv, atlasGrid)).rgb;
      // key reveal: typed in left to right
      float kmask = smoothstep(vA.x * 0.7 + 0.001, vA.x * 0.7 - 0.02, fuv.x) * step(0.001, vA.x);
      float key = tx.r * kmask;
      if (vB.z > 1.5) tx = vec3(0.0); // blank cell
      vec3 fill = C_INK2 * (0.55 + 0.9 * lit + 1.4 * pool) + C_SIGNAL_DEEP * (0.16 * sig + 0.05 * heat + 0.12 * warm * lit);
      col = fill;
      // hairline border (AA in screen space)
      vec2 d = min(fuv, 1.0 - fuv) * vec2(${(1.8).toFixed(2)}, ${(0.62).toFixed(2)});
      float bd = min(d.x, d.y);
      float fw = fwidth(bd);
      float border = 1.0 - smoothstep(0.004, 0.004 + fw * 1.5, bd);
      col += mix(mix(C_BONE * (0.10 + 0.40 * lit + 0.5 * pool), C_SIGNAL * 0.7, heat * 0.5), C_SIGNAL * 1.6, sig) * border;
      vec3 keyC = mix(C_BONE * (0.28 + 0.75 * lit + 0.35 * pool + 0.4 * glowAll), C_SIGNAL_HOT * 3.2, sig);
      keyC = mix(keyC, C_SIGNAL * (1.0 + 0.8 * lit), heat * (1.0 - sig));
      col += keyC * key;
      col += C_ASH * tx.g * (0.18 + 0.55 * lit + 0.4 * pool) * (0.4 + 0.6 * step(0.001, vA.x) + 0.0);
      col += C_GRAPHITE * tx.b * (0.35 + 0.5 * lit);
      // strike-through: a magenta bar drawn left to right across the key
      float sx = vB.x * 1.08;
      float band = 1.0 - smoothstep(0.035, 0.035 + fwidth(fuv.y) * 1.5, abs(fuv.y - 0.52));
      col = mix(col, C_SIGNAL * 2.6, band * step(fuv.x, sx) * step(0.0005, vB.x));
    } else {
      // slab sides: dark, with a thin lit edge
      float edge = smoothstep(0.42, 0.5, max(abs(vS.x), abs(vS.y)));
      col = C_INK2 * (0.35 + 0.5 * lit + 0.6 * pool) + C_BONE * 0.06 * edge * (1.0 + 3.0 * pool) + C_SIGNAL_DEEP * 0.3 * sig;
      col *= 0.6 + 0.4 * sat(dot(vN, normalize(lightPos - vW)));
    }
  }
  float dist = length(vW - camPos);
  float fog = exp(-max(dist - fogStart, 0.0) / fogLen);
  col *= fog * alpha;
  fragColor = vec4(col, 1.0);
}`;

export interface Cell {
  x: number; y: number; z: number;
  rx?: number; ry?: number; rz?: number;
  sx?: number; sy?: number; sz?: number;
  slot: number;
  reveal?: number; lit?: number; signal?: number; alpha?: number;
  strike?: number; heat?: number; pixel?: boolean; blank?: boolean; dissolve?: number;
}

export class CellGrid {
  geo: THREE.InstancedBufferGeometry;
  mat: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene = new THREE.Scene();
  count = 0;
  private f: { pos: Float32Array; rot: Float32Array; scl: Float32Array; slot: Float32Array; a: Float32Array; b: Float32Array };
  private attrs: THREE.InstancedBufferAttribute[] = [];
  constructor(public capacity: number, atlas: SlotAtlas) {
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = box.index;
    for (const k of ['position', 'normal', 'uv']) this.geo.setAttribute(k, box.getAttribute(k));
    this.f = {
      pos: new Float32Array(capacity * 3), rot: new Float32Array(capacity * 3), scl: new Float32Array(capacity * 3),
      slot: new Float32Array(capacity), a: new Float32Array(capacity * 4), b: new Float32Array(capacity * 4),
    };
    const add = (name: string, arr: Float32Array, n: number) => {
      const at = new THREE.InstancedBufferAttribute(arr, n);
      at.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, at);
      this.attrs.push(at);
    };
    add('iPos', this.f.pos, 3); add('iRot', this.f.rot, 3); add('iScale', this.f.scl, 3);
    add('iSlot', this.f.slot, 1); add('iA', this.f.a, 4); add('iB', this.f.b, 4);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        atlas: { value: atlas.texture }, atlasGrid: { value: atlas.grid },
        wallMatrix: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, lightPos: { value: new THREE.Vector3() }, lightR: { value: 2 },
        fogStart: { value: 6 }, fogLen: { value: 20 }, warm: { value: 0 }, glowAll: { value: 0 }, time: { value: 0 },
      },
      depthTest: true, depthWrite: true,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  get u() { return this.mat.uniforms; }
  clear() { this.count = 0; }
  push(c: Cell) {
    if (this.count >= this.capacity) return;
    const i = this.count++, f = this.f;
    f.pos[i * 3] = c.x; f.pos[i * 3 + 1] = c.y; f.pos[i * 3 + 2] = c.z;
    f.rot[i * 3] = c.rx ?? 0; f.rot[i * 3 + 1] = c.ry ?? 0; f.rot[i * 3 + 2] = c.rz ?? 0;
    f.scl[i * 3] = c.sx ?? KV.cw; f.scl[i * 3 + 1] = c.sy ?? KV.chh; f.scl[i * 3 + 2] = c.sz ?? KV.cd;
    f.slot[i] = c.slot;
    f.a[i * 4] = c.reveal ?? 1; f.a[i * 4 + 1] = c.lit ?? 0; f.a[i * 4 + 2] = c.signal ?? 0; f.a[i * 4 + 3] = c.alpha ?? 1;
    f.b[i * 4] = c.strike ?? 0; f.b[i * 4 + 1] = c.heat ?? 0; f.b[i * 4 + 2] = c.pixel ? 1 : c.blank ? 2 : 0; f.b[i * 4 + 3] = c.dissolve ?? 0;
  }
  draw(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, cam: THREE.Camera) {
    for (const at of this.attrs) { at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, this.count * at.itemSize); }
    this.geo.instanceCount = this.count;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, cam);
  }
}

// ------------------------------------------------------------------ the hand-over (end of s06 = start of s07)
/** How far the bottom row has eroded into pixels when s06 hands over (s07 keeps it). */
export const LEAK_END = 0.34;
/** Rows visible in the top-down table framing. */
export const TABLE_ROWS = 17;
/** Pivot of the wall's tilt (wall space y): the centre of the framed table. */
export const TABLE_PIVOT_Y = cellY((TABLE_ROWS - 1) / 2);
export const TABLE_FOV = 30;
/** Camera height above the table so that TABLE_ROWS rows (+ a margin) fill the frame height. */
export const TABLE_CAM_H = ((TABLE_ROWS + 1.2) * KV.py) / 2 / Math.tan((TABLE_FOV / 2) * Math.PI / 180);

/**
 * Wall → world: rotate about the x axis through (0, TABLE_PIVOT_Y, 0) by `tilt` (0 = standing wall,
 * 1 = lying flat, face up, row 0 away from the camera at the top of a top-down frame).
 */
export function wallMatrix(tilt: number, m = new THREE.Matrix4()) {
  const th = -tilt * Math.PI / 2;
  const T1 = new THREE.Matrix4().makeTranslation(0, -TABLE_PIVOT_Y, 0);
  const R = new THREE.Matrix4().makeRotationX(th);
  const T2 = new THREE.Matrix4().makeTranslation(0, TABLE_PIVOT_Y, 0);
  return m.copy(T2).multiply(R).multiply(T1);
}

/** Top-down pose over the flat table (world space, tilt = 1). */
export function tablePose() {
  return {
    pos: new THREE.Vector3(0, TABLE_PIVOT_Y + TABLE_CAM_H, 0),
    target: new THREE.Vector3(0, TABLE_PIVOT_Y, 0),
    up: new THREE.Vector3(0, 0, -1),
    fov: TABLE_FOV,
  };
}
