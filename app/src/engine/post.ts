// Global post-processing: bloom + halation, chromatic aberration, RGB split, tone shoulder,
// film grain, vignette, fades/flash. Operates on the composited HDR (linear) frame.
// Adapted from mexicat/pdoom-video (MIT), see LICENSE-THIRD-PARTY.md.
import * as THREE from 'three';
import { FSPass, makeRT, W, H, SCALE } from './gl';

/** The tone shoulder (linear HDR -> 0..1 linear), shared with the engine's sampling error estimate. */
export const SHOULDER_GLSL = /* glsl */ `
vec3 shoulder(vec3 x) {
  // identity below k, smooth exponential shoulder above; very bright values desaturate toward white
  const float k = 0.72;
  vec3 y = mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
  float over = max(max(x.r, x.g), x.b);
  return mix(y, vec3(1.0), smoothstep(2.0, 12.0, over) * 0.85);
}`;

export interface PostParams {
  exposure: number;
  bloom: number; // bloom strength
  bloomThreshold: number; // linear luminance where bloom starts
  bloomKnee: number; // soft knee width
  bloomRadius: number; // 0..1 upsample spread
  halation: number; // film halation (tinted glow around highlights)
  /** Linear RGB tint of the halation (default: red-magenta, stays inside the one-signal palette). */
  halationTint: [number, number, number];
  ca: number; // radial chromatic aberration in px at the frame edge (lens-like, subtle)
  /** RGB split: R shifted by +rgbSplit px, B by -rgbSplit px along `rgbSplitAngle` (hooks, glitches). 0 = off. */
  rgbSplit: number;
  rgbSplitAngle: number; // radians, 0 = horizontal
  grain: number; // grain amplitude (sRGB units), ~0.04-0.1
  vignette: number; // 0..1
  hud: number; // HUD opacity multiplier (token counter, crop marks)
  /** Opacity of the global token counter (top-right). Scenes that stage the counter themselves return 0. */
  counter: number;
  /** 0..1: the frame is light (magenta hook ground / bone) — the HUD draws in ink instead of bone. */
  paper: number;
  /** Replace the counter text (e.g. '1,000,000' flash, 'ERR'). */
  counterText?: string;
  /** 0..1 glitch the counter digits. */
  counterCorruption?: number;
  /** Move the global counter: [right edge x, digits baseline y] in logical px (default COUNTER_POS in hud.ts). */
  counterPos?: [number, number];
  /** 0..1: an ink plate behind the counter, for scenes whose busy frames run under the top-right corner. */
  counterPlate?: number;
  /** 0..1: the crop-mark frame (off by default). */
  frame: number;
  fade: number; // fade to black 0..1
  flash: number; // additive flash 0..1+ (colour: flashColor)
  flashColor: [number, number, number]; // linear RGB, default bone
  shake: [number, number]; // frame offset in px
  zoom: number; // frame zoom (1 = none), for punch-ins on hits (C- stutters: ~1.06)
  invert: number; // 0..1 invert (ink <-> bone), applied before grain
}

export const DEFAULT_POST: PostParams = {
  exposure: 1,
  bloom: 0.5,
  bloomThreshold: 0.85,
  bloomKnee: 0.5,
  bloomRadius: 0.75,
  halation: 0.22,
  halationTint: [1.0, 0.1, 0.32],
  ca: 1.0,
  rgbSplit: 0,
  rgbSplitAngle: 0,
  grain: 0.05,
  vignette: 0.3,
  hud: 1,
  counter: 1,
  paper: 0,
  frame: 0,
  fade: 0,
  flash: 0,
  flashColor: [0.855, 0.815, 0.74],
  shake: [0, 0],
  zoom: 1,
  invert: 0,
};

const MIPS = 7;

export class Post {
  private prefilter: FSPass;
  private down: FSPass;
  private up: FSPass;
  private final: FSPass;
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];

  constructor() {
    // the bloom pyramid stays at the logical resolution at every output scale (same radii, same look)
    let w = W >> 1, h = H >> 1;
    for (let i = 0; i < MIPS; i++) {
      this.mips.push(makeRT(Math.max(2, w), Math.max(2, h), { depthBuffer: false, pxScale: 1 }));
      this.ups.push(makeRT(Math.max(2, w), Math.max(2, h), { depthBuffer: false, pxScale: 1 }));
      w >>= 1; h >>= 1;
    }
    this.prefilter = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel; uniform float threshold, knee;
      void main() {
        // 4-tap box downsample + soft threshold on luminance
        vec3 c = vec3(0.0);
${SCALE <= 1 ? `        c += texture(src, vUv + texel * vec2(-1, -1)).rgb; c += texture(src, vUv + texel * vec2(1, -1)).rgb;
        c += texture(src, vUv + texel * vec2(-1, 1)).rgb;  c += texture(src, vUv + texel * vec2(1, 1)).rgb;
        c *= 0.25;` : `        // output scale > 1: the same 4x4-logical-px box from a SCALE x larger source, as 2x2-texel bilinear taps
        const int N = ${SCALE * 2};
        for (int j = 0; j < N; j++) for (int i = 0; i < N; i++)
          c += texture(src, vUv + texel * (vec2(float(i), float(j)) * 2.0 - float(N - 1)) / PX_SCALE).rgb;
        c /= float(N * N);`}
        c = min(c, vec3(40.0));
        float l = max(c.r, max(c.g, c.b));
        float rq = clamp(l - threshold + knee, 0.0, 2.0 * knee);
        rq = rq * rq / (4.0 * knee + 1e-5);
        float w = max(rq, l - threshold) / max(l, 1e-5);
        fragColor = vec4(c * w, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 } });
    this.down = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform vec2 texel;
      void main() {
        // 13-tap downsample (Jimenez 2014)
        vec3 a = texture(src, vUv + texel * vec2(-2, -2)).rgb, b = texture(src, vUv + texel * vec2(0, -2)).rgb, c = texture(src, vUv + texel * vec2(2, -2)).rgb;
        vec3 d = texture(src, vUv + texel * vec2(-1, -1)).rgb, e = texture(src, vUv + texel * vec2(1, -1)).rgb;
        vec3 f = texture(src, vUv + texel * vec2(-2, 0)).rgb, g = texture(src, vUv).rgb, h = texture(src, vUv + texel * vec2(2, 0)).rgb;
        vec3 i = texture(src, vUv + texel * vec2(-1, 1)).rgb, j = texture(src, vUv + texel * vec2(1, 1)).rgb;
        vec3 k = texture(src, vUv + texel * vec2(-2, 2)).rgb, l = texture(src, vUv + texel * vec2(0, 2)).rgb, m = texture(src, vUv + texel * vec2(2, 2)).rgb;
        vec3 o = (d + e + i + j) * 0.125 + (a + b + g + f) * 0.03125 + (b + c + h + g) * 0.03125 + (f + g + l + k) * 0.03125 + (g + h + m + l) * 0.03125;
        fragColor = vec4(o, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    this.up = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D prev; uniform vec2 texel; uniform float radius;
      void main() {
        // 9-tap tent upsample of the smaller level, added to this level
        vec2 o = texel * radius;
        vec3 s = texture(src, vUv - o).rgb + 2.0 * texture(src, vUv + vec2(0, -o.y)).rgb + texture(src, vUv + vec2(o.x, -o.y)).rgb
          + 2.0 * texture(src, vUv + vec2(-o.x, 0)).rgb + 4.0 * texture(src, vUv).rgb + 2.0 * texture(src, vUv + vec2(o.x, 0)).rgb
          + texture(src, vUv + vec2(-o.x, o.y)).rgb + 2.0 * texture(src, vUv + vec2(0, o.y)).rgb + texture(src, vUv + o).rgb;
        fragColor = vec4(texture(prev, vUv).rgb + s / 16.0, 1.0);
      }`, { src: { value: null }, prev: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1 } });
    this.final = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform sampler2D bloomTex; uniform sampler2D haloTex; uniform sampler2D hudTex;
      uniform float exposure, bloom, halation, ca, grain, vignette, hud, fade, flash, time, zoom, invert, rgbSplit, rgbSplitAngle;
      uniform vec2 shake; uniform vec2 res; uniform vec3 haloTint, flashColor;
      ${SHOULDER_GLSL}
      void main() {
        vec2 uv = (vUv - 0.5) / zoom + 0.5 - shake / res;
        vec2 dc = uv - 0.5;
        float r2 = dot(dc * vec2(res.x / res.y, 1.0), dc * vec2(res.x / res.y, 1.0));
        vec2 off = dc * r2 * ca / res.x * 4.0;
        vec2 split = vec2(cos(rgbSplitAngle), sin(rgbSplitAngle)) * rgbSplit / res;
        vec3 col;
        col.r = texture(src, uv + off + split).r;
        col.g = texture(src, uv).g;
        col.b = texture(src, uv - off - split).b;
        vec3 bl = texture(bloomTex, uv).rgb;
        vec3 ha = texture(haloTex, uv).rgb;
        col += bl * bloom;
        col += haloTint * luma(ha) * halation;
        col *= exposure;
        // HUD is composited in linear space before the shoulder so it gets grain & vignette too
        vec4 h = texture(hudTex, vUv);
        col = mix(col, h.rgb / max(h.a, 1e-4), h.a * hud);
        col = shoulder(col);
        col = mix(col, vec3(0.8515) - col * 0.84, invert); // ink<->bone in linear-ish space
        col += flashColor * flash;
        // vignette
        float v = smoothstep(0.95, 0.25, length(dc * vec2(1.0, 0.8)));
        col *= mix(1.0, v, vignette);
        col *= (1.0 - fade);
        vec3 s = toSRGB(sat(col));
        // film grain: two scales, stronger in mid-tones
${SCALE <= 1 ? `        float g1 = hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5;
        float g2 = hash12(floor(gl_FragCoord.xy / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;` : `        // output scale > 1: the fine grain is per physical px with its amplitude raised by PX_SCALE so its
        // power per logical px (what survives a downscale) matches 1x; the coarse grain keeps 2x2-logical-px cells
        float g1 = (hash12(gl_FragCoord.xy + fract(time * 13.37) * 1000.0) - 0.5) * PX_SCALE;
        float g2 = hash12(floor(FRAG_PX / 2.0) + fract(time * 7.13) * 1000.0) - 0.5;`}
        float lm = luma(s);
        float amt = grain * (0.55 + 1.2 * lm * (1.0 - lm));
        s += (g1 * 0.6 + g2 * 0.4) * amt;
        s += (hash12(gl_FragCoord.xy * 1.37 + time) - 0.5) / 255.0; // dither
        fragColor = vec4(sat(s), 1.0);
      }`, {
      src: { value: null }, bloomTex: { value: null }, haloTex: { value: null }, hudTex: { value: null },
      exposure: { value: 1 }, bloom: { value: 0.5 }, halation: { value: 0.2 }, ca: { value: 1 }, grain: { value: 0.05 },
      vignette: { value: 0.3 }, hud: { value: 1 }, fade: { value: 0 }, flash: { value: 0 }, time: { value: 0 },
      zoom: { value: 1 }, invert: { value: 0 }, rgbSplit: { value: 0 }, rgbSplitAngle: { value: 0 },
      haloTint: { value: new THREE.Vector3(1, 0.1, 0.32) }, flashColor: { value: new THREE.Vector3(1, 1, 1) }, shake: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2(W, H) },
    });
  }

  /** Apply the chain: src (HDR linear) -> out (sRGB 8-bit target or screen). */
  render(renderer: THREE.WebGLRenderer, src: THREE.Texture, hud: THREE.Texture, out: THREE.WebGLRenderTarget | null, p: PostParams, time: number) {
    // bloom pyramid
    this.prefilter.u.src!.value = src;
    (this.prefilter.u.texel!.value as THREE.Vector2).set(1 / W, 1 / H);
    this.prefilter.u.threshold!.value = p.bloomThreshold;
    this.prefilter.u.knee!.value = p.bloomKnee;
    this.prefilter.render(renderer, this.mips[0]!);
    for (let i = 1; i < MIPS; i++) {
      const s = this.mips[i - 1]!;
      this.down.u.src!.value = s.texture;
      (this.down.u.texel!.value as THREE.Vector2).set(1 / s.width, 1 / s.height);
      this.down.render(renderer, this.mips[i]!);
    }
    // upsample: ups[i] = mips[i] + up(ups[i+1])
    let prevTex = this.mips[MIPS - 1]!.texture;
    for (let i = MIPS - 2; i >= 0; i--) {
      const small = i === MIPS - 2 ? this.mips[MIPS - 1]! : this.ups[i + 1]!;
      this.up.u.src!.value = prevTex;
      this.up.u.prev!.value = this.mips[i]!.texture;
      (this.up.u.texel!.value as THREE.Vector2).set(1 / small.width, 1 / small.height);
      this.up.u.radius!.value = 0.5 + p.bloomRadius;
      this.up.render(renderer, this.ups[i]!);
      prevTex = this.ups[i]!.texture;
    }
    const f = this.final.u;
    f.src!.value = src;
    f.bloomTex!.value = this.ups[0]!.texture;
    f.haloTex!.value = this.ups[3]!.texture;
    f.hudTex!.value = hud;
    f.exposure!.value = p.exposure;
    f.bloom!.value = p.bloom / 3; // pyramid sums ~MIPS levels; normalize
    f.halation!.value = p.halation;
    f.ca!.value = p.ca;
    f.grain!.value = p.grain;
    f.vignette!.value = p.vignette;
    f.hud!.value = p.hud;
    f.fade!.value = p.fade;
    f.flash!.value = p.flash;
    f.time!.value = time;
    f.zoom!.value = p.zoom;
    f.invert!.value = p.invert;
    f.rgbSplit!.value = p.rgbSplit;
    f.rgbSplitAngle!.value = p.rgbSplitAngle;
    (f.haloTint!.value as THREE.Vector3).set(...p.halationTint);
    (f.flashColor!.value as THREE.Vector3).set(...p.flashColor);
    (f.shake!.value as THREE.Vector2).set(p.shake[0], p.shake[1]);
    this.final.render(renderer, out);
  }
}
