// s04 · scroll (27.4 – 32.2 s). BEATSHEET: 对话无限向下滚动，速度随 "scroll" 加速，每唱一次 scroll 就冲一下。
// "long long long" 时文本被拉长成竖条 → 竖条收拢成一个光标，然后爆开成满屏洋红.
//
//   - The conversation from s03 streams on (shared/a_convo.ts): messages arrive faster and faster, and
//     every sung "scroll" dumps a burst of them, so the autoscroll kicks on each word.
//   - The SCROLL ribbon: each sung scroll slams in at the centre and pushes the older ones up a row.
//     "Watch the page go" is the next row (per-word highlight), then "LONG".
//   - "long" #1: the whole frame stretches vertically (canvas transform + a vertical streak pass);
//     "long" #2: it stretches into full-height bars; the bars squeeze into one cursor at the centre,
//     which bursts into the full magenta ground of s05 on the cut.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, keys, lerp, noise1, prog } from '../engine/util';
import { drawLyricLine } from '../shared/lyric';
import { VerseConvo } from '../shared/a_convo';
import { applyCam } from '../shared/a_ui';

const STREAK = /* glsl */ `
uniform sampler2D tex; uniform float len; uniform float gain; uniform vec3 ground;
void main() {
  vec4 c0 = texture(tex, vUv);
  vec3 acc = vec3(0.0); float aa = 0.0;
  const int N = 40;
  for (int i = 0; i < N; i++) {
    float o = (float(i) / float(N - 1) - 0.5) * len;
    vec4 s = texture(tex, vUv + vec2(0.0, o));
    acc += s.rgb * s.a; aa += s.a;
  }
  acc /= float(N); aa /= float(N);
  vec3 sm = acc * gain; float sa = clamp(aa * gain, 0.0, 1.0);
  vec3 base = c0.rgb * c0.a;
  vec3 col = max(base, sm);
  float a = max(c0.a, sa);
  fragColor = vec4(ground * (1.0 - a) + col, 1.0);
}`;

export default class S04Scroll extends Scene {
  layer = new Layer2D();
  convo!: VerseConvo;
  pass!: FSPass;
  watch!: Line;
  longs: number[] = [];
  tWatch = 0;
  tC0 = 0; tC1 = 0; tB0 = 0;

  override init() {
    const { lyrics, tl, end } = this.ctx;
    this.convo = new VerseConvo(this.ctx);
    const full = lyrics.get('Watch the page go long long long', 0);
    this.tWatch = full.start;
    this.watch = { ...full, text: 'Watch the page go', words: full.words.slice(0, 4), end: full.words[3]!.end };
    this.longs = full.words.slice(4).map((w) => w.start).filter((x) => x < end);
    const l2 = this.longs[1] ?? end - 0.4;
    // collapse on the 8th after "long" #2, burst on the last 16th before the cut
    this.tC0 = l2 + 0.16;
    this.tC1 = tl.timeOfBeat(Math.round(tl.beat(end) * 4 - 1) / 4) - 0.02;
    this.tB0 = Math.max(this.tC1 + 0.02, end - 0.075);
    this.pass = new FSPass(STREAK, { tex: { value: this.layer.texture }, len: { value: 0 }, gain: { value: 1 }, ground: { value: new THREE.Vector3(...LIN.ink) } });
  }

  /** Vertical stretch of the whole frame. */
  private stretch(t: number) {
    const [a, b] = [this.longs[0] ?? Infinity, this.longs[1] ?? Infinity];
    return keys(t, [[a, 1], [a + 0.32, 2.3, ease.outExpo], [b, 2.6, ease.linear], [b + 0.15, 30, ease.inQuart]]);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, tl, end } = this.ctx;
    const t = f.t;
    const cv = this.convo;
    const L = this.layer;
    L.clear();
    const c = L.ctx;

    // collapse: 0 → 1 over [tC0, tC1]; burst 0 → 1 over [tB0, end)
    const col = ease.inExpo(prog(t, this.tC0, this.tC1));
    const burst = ease.inQuad(prog(t, this.tB0, end - 1 / 60));
    const sy = this.stretch(t);
    const sx = lerp(1, 0.02, col);
    const shakeX = noise1(t * 40, 3) * 10 * clamp((sy - 1) / 6);
    const S = new DOMMatrix().translate(W / 2 + shakeX, H / 2).scale(sx, sy).translate(-W / 2, -H / 2);
    const contentA = 1 - prog(col, 0.45, 0.8);

    if (contentA > 0) {
      c.save();
      c.globalAlpha = contentA;
      // world: the streaming conversation (dimmed under the ribbon)
      const cam = cv.cam(t);
      applyCam(c, cam);
      c.setTransform(S.multiply(c.getTransform()));
      cv.drawMessages(c, t, cam, 0.3 + 0.12 * tl.beatPulse(t, 0.1));
      // screen: chrome + ribbon + the Watch / LONG rows
      c.setTransform(S);
      cv.drawChrome(c, t);
      const rows = [this.tWatch, ...(this.longs[0] !== undefined ? [this.longs[0]] : [])];
      cv.drawRibbon(c, t, rows);
      const P = cv.ribbonP(t, rows);
      const nScroll = cv.scrolls.length;
      if (t >= this.tWatch - 0.2) {
        const y = cv.rowY(nScroll, P) + 40;
        const a = clamp(1 + (nScroll - P) / 2.5);
        c.save();
        c.globalAlpha *= a;
        const lay = drawLyricLine(c, this.watch, t, W / 2, y, { family: F.display(900), size: 118, align: 'center', base: 'bone', baseAlpha: 0.25, revealOnly: false });
        // a slam on each word
        for (const wb of lay.words) {
          const age = t - wb.state.word.start;
          if (age >= 0 && age < 0.12) { c.fillStyle = rgba('signalHot', 0.35 * (1 - age / 0.12)); c.fillRect(wb.x - 6, wb.y - 100, wb.w + 12, 124); }
        }
        c.restore();
      }
      if (this.longs.length) this.drawLong(c, t, cv.rowY(nScroll + 1, P));
      c.restore();
    }

    // the cursor the bars collapse into, then the burst
    if (col > 0.45) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      const k = prog(col, 0.45, 1);
      // the bars' last column becomes the cursor: full height, shrinking to the cursor's size
      const settle = ease.outExpo(prog(t, this.tC1 - 0.01, this.tC1 + 0.05));
      const cw = lerp(W * sx * 0.06 + 60, 110, settle), ch = lerp(H * 1.1, 330, settle);
      const w = lerp(cw, W * 1.25, burst), h = lerp(ch, H * 1.25, burst);
      c.fillStyle = burst > 0 ? rgba('signal', 1) : mixRGBA('signalHot', 'signal', k * settle, clamp(k * 2.5));
      c.fillRect(W / 2 - w / 2, H / 2 - h / 2, w, h);
    }

    L.upload();
    const len = clamp((sy - 1) / 29) * 0.9 + clamp((sy - 1) / 2) * 0.04;
    const effLen = len * (1 - col);
    this.pass.u.len!.value = effLen;
    this.pass.u.gain!.value = 1 + effLen * 2;
    (this.pass.u.ground!.value as THREE.Vector3).set(...(burst > 0.98 ? LIN.signal : LIN.ink));
    clearRT(renderer, out, LIN.ink);
    this.pass.render(renderer, out);

    const kick = tl.pulseAt(t, cv.scrolls, 0.07);
    const lk = tl.pulseAt(t, this.longs, 0.1);
    const magenta = burst > 0.5;
    // on the burst, hand over s05's post (magenta ground: HUD in ink, bloom threshold above the ground)
    if (magenta) return { paper: 1, bloom: 0.22, bloomThreshold: 1.3, halation: 0.08, vignette: 0.2, grain: 0.05 };
    return {
      bloom: 0.6 + 0.5 * lk + 0.3 * col,
      rgbSplit: (4 * kick + 10 * lk + 6 * clamp((sy - 1) / 10)) * (1 - col),
      rgbSplitAngle: Math.PI / 2,
      zoom: 1 + 0.03 * kick,
      vignette: 0.4,
    };
  }

  /** "LONG" in giant type, lit on each sung long. */
  private drawLong(c: CanvasRenderingContext2D, t: number, y: number) {
    const l1 = this.longs[0]!;
    if (t < l1 - 0.02) return;
    const fam = F.display(900), size = 330;
    const txt = 'LONG';
    const tw = measure(txt, fam, size);
    const age = t - l1;
    const slam = 1 + 0.3 * Math.pow(0.5, age / 0.05);
    const hot = Math.max(Math.pow(0.5, age / 0.07), this.longs[1] !== undefined && t >= this.longs[1] ? Math.pow(0.5, (t - this.longs[1]) / 0.07) : 0);
    c.save();
    c.translate(W / 2, y);
    c.scale(slam, slam);
    c.font = font(fam, size);
    c.textBaseline = 'middle';
    c.fillStyle = hot > 0.15 ? mixRGBA('signal', 'signalHot', hot) : rgba('signal', 1);
    c.fillText(txt, -tw / 2, 0);
    c.restore();
  }
}
