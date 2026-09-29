// Shallow depth of field for three.js scenes (s06, s07, s13): render a THREE.Scene into an HDR target
// with a depth texture, then a scatter-as-gather disc blur whose radius follows the thin-lens circle
// of confusion. Background taps can't smear over a sharper foreground; blurry foreground spills over
// sharp background. Taps are rotated per pixel and per motion-blur sub-frame, so the ring pattern
// averages out into the film grain.
import * as THREE from 'three';
import { FSPass, PW, PH, SS_TAP, SS_TAP_GLSL, clearRT } from '../engine/gl';

const FRAG = /* glsl */ `
uniform sampler2D tCol; uniform sampler2D tDepth;
uniform float near, far, focus, aperture, maxCoc;
uniform vec2 texel;
${SS_TAP_GLSL}
float viewZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
float coc(float z) { return clamp(aperture * abs(1.0 - focus / z), 0.0, maxCoc); }
void main() {
  vec3 c0 = texture(tCol, vUv).rgb;
  if (maxCoc < 0.6) { fragColor = vec4(c0, 1.0); return; }
  float zc = viewZ(texture(tDepth, vUv).r);
  float cc = coc(zc);
  vec3 acc = c0; float ws = 1.0;
  const int N = 44;
  float rot = hash12(floor(gl_FragCoord.xy)) * TAU + float(max(ssTap, 0)) * 1.5707963;
  for (int i = 0; i < N; i++) {
    float r = sqrt((float(i) + 0.5) / float(N)) * maxCoc;
    float a = float(i) * 2.39996323 + rot;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * PX_SCALE * texel;
    float zs = viewZ(texture(tDepth, uv).r);
    float cs = coc(zs);
    float c = zs > zc ? min(cs, cc) : cs;
    float w = smoothstep(r - 1.5, r + 0.5, c);
    acc += texture(tCol, uv).rgb * w; ws += w;
  }
  fragColor = vec4(acc / ws, 1.0);
}`;

export interface DofParams {
  /** Focus distance (world units along the view axis). */
  focus: number;
  /** CoC scale in logical px: CoC = aperture * |1 - focus / z|. */
  aperture: number;
  /** Clamp (logical px). 0 = off. */
  maxCoc: number;
}

export class DofRenderer {
  rt: THREE.WebGLRenderTarget;
  pass: FSPass;
  constructor() {
    const depth = new THREE.DepthTexture(PW, PH);
    depth.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(PW, PH, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, depthTexture: depth,
    });
    this.pass = new FSPass(FRAG, {
      tCol: { value: this.rt.texture }, tDepth: { value: depth },
      near: { value: 0.1 }, far: { value: 100 }, focus: { value: 5 }, aperture: { value: 10 }, maxCoc: { value: 12 },
      texel: { value: new THREE.Vector2(1 / PW, 1 / PH) }, ssTap: SS_TAP,
    });
  }
  /** Clear the scene target to `bg` (linear) and bind it; draw into it, then call `resolve`. */
  begin(renderer: THREE.WebGLRenderer, bg: [number, number, number]) {
    clearRT(renderer, this.rt, bg);
    renderer.setRenderTarget(this.rt);
  }
  resolve(renderer: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, out: THREE.WebGLRenderTarget, p: DofParams) {
    const u = this.pass.u;
    u.near!.value = cam.near; u.far!.value = cam.far;
    u.focus!.value = p.focus; u.aperture!.value = p.aperture; u.maxCoc!.value = p.maxCoc;
    this.pass.render(renderer, out);
  }
  dispose() { this.rt.dispose(); this.rt.depthTexture?.dispose(); }
}
