// Slot atlases for text drawn in 3D (s06/s07 cell faces, s13 glyph rain / terrain).
// A canvas split into equal slots; each slot is drawn once in init() and sampled in shaders.
// Slots are painted on opaque black with additive colour so each RGB channel is an independent
// coverage mask (R, G, B = three separately tinted layers of the same slot). Sample as data (no sRGB).
import * as THREE from 'three';

export class SlotAtlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  cols: number;
  rows: number;
  n = 0;
  constructor(public sw: number, public sh: number, public capacity: number, maxW = 4096) {
    this.cols = Math.max(1, Math.floor(maxW / sw));
    this.rows = Math.ceil(capacity / this.cols);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * sw;
    this.canvas.height = this.rows * sh;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.flipY = false;
  }
  /** Allocate a slot and draw into it: `draw(c, w, h)` with the origin at the slot's top-left, clipped to it. */
  add(draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): number {
    if (this.n >= this.cols * this.rows) throw new Error('SlotAtlas full');
    const i = this.n++;
    const c = this.ctx;
    c.save();
    c.translate((i % this.cols) * this.sw, Math.floor(i / this.cols) * this.sh);
    c.beginPath(); c.rect(0, 0, this.sw, this.sh); c.clip();
    c.globalCompositeOperation = 'lighter';
    draw(c, this.sw, this.sh);
    c.restore();
    return i;
  }
  /** Finish: upload with anisotropic filtering. */
  finish(renderer: THREE.WebGLRenderer) {
    this.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.texture.needsUpdate = true;
    return this.texture;
  }
  /** GLSL helper: uv (0..1 within slot) → atlas uv. Uniform `atlasGrid` = vec4(cols, rows, 1/cols, 1/rows). */
  get grid() { return new THREE.Vector4(this.cols, this.rows, 1 / this.cols, 1 / this.rows); }
}

export const SLOT_GLSL = /* glsl */ `
vec2 slotUV(float slot, vec2 uv, vec4 g) {
  float c = mod(slot, g.x), r = floor(slot / g.x);
  return vec2((c + uv.x) * g.z, (r + uv.y) * g.w);
}`;

/** Plain (sRGB-agnostic) CSS colour for a channel: 'r' | 'g' | 'b' at intensity k (0..1). */
export const ch = (k: 'r' | 'g' | 'b', a = 1) => {
  const v = Math.round(255 * a);
  return k === 'r' ? `rgb(${v},0,0)` : k === 'g' ? `rgb(0,${v},0)` : `rgb(0,0,${v})`;
};
