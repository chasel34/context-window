// s01 · boot (0 – 3.6 s). BEATSHEET: 黑屏中一个光标闪烁，键盘声每响一次，就逐字打出 `system:`.
// Frame 0 is the loop seam: the lit boot cursor alone at the centre (the same frame s16 ends on).
// Every keyboard click (hat onsets of the intro) types one character; the camera eases along with
// the caret and pushes in. Once `system:` is complete it turns signal (the role label s02 keeps).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font } from '../engine/type';
import { clamp, ease, prog } from '../engine/util';
import { drawCursor } from '../shared/cursor';
import { applyCam, BOOT, BOOT_POST, bootLit, type Cam } from '../shared/a_ui';

const TEXT = 'system:';

export default class S01Boot extends Scene {
  layer = new Layer2D();
  keys: number[] = [];
  extra: number[] = [];
  adv = 0;
  fam = F.mono(500);

  override init() {
    const { audio, start, end } = this.ctx;
    // keyboard clicks: the intro's hat onsets (the "(click click click)" percussion)
    const ev = audio.events('hat', start + 0.4, end - 0.3).filter(([, s]) => s >= 0.08).map(([t]) => t);
    this.keys = ev.slice(0, TEXT.length);
    this.extra = ev.slice(TEXT.length);
    const c = this.layer.ctx;
    c.font = font(this.fam, BOOT.size);
    this.adv = c.measureText('M').width;
  }

  /** Characters typed at t, and the fractional caret column (eased per key). */
  private caret(t: number) {
    let n = 0, col = 0;
    for (const k of this.keys) {
      if (t < k) break;
      n++;
      col += ease.outExpo(clamp((t - k) / 0.09));
    }
    return { n, col };
  }

  private cam(t: number): Cam {
    // follow the text's centre (starts at the cursor: identity at t = 0) and push in slowly
    let cx = W / 2;
    for (const k of this.keys) if (t >= k) cx += (this.adv / 2) * ease.outCubic(clamp((t - k) / 0.45));
    const push = ease.inOutQuad(clamp(t / this.ctx.end)) * 0.2;
    const punch = 0.006 * this.ctx.tl.pulseAt(t, this.keys, 0.06);
    return { x: cx, y: BOOT.y - BOOT.size * 0.28, zoom: 1 + push + punch };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    applyCam(c, this.cam(t));

    const x0 = BOOT.x - 2;
    const { n, col } = this.caret(t);
    const done = n >= TEXT.length ? this.keys[TEXT.length - 1]! : Infinity;
    const role = prog(t, done, done + 0.25, ease.outCubic); // whole word turns signal
    c.font = font(this.fam, BOOT.size);
    c.textBaseline = 'alphabetic';
    for (let i = 0; i < n; i++) {
      const k = this.keys[i]!, age = t - k;
      const drop = (1 - ease.outExpo(clamp(age / 0.12))) * -14;
      const hot = Math.pow(0.5, age / 0.07);
      c.fillStyle = hot > 0.08 ? mixRGBA('bone', 'signalHot', hot) : mixRGBA('bone', 'signal', role);
      c.fillText(TEXT[i]!, x0 + i * this.adv, BOOT.y + drop);
    }
    // the cursor: at the caret (springs forward on each key), lit while typing, beat blink otherwise
    const typing = n > 0 && n < TEXT.length && t - this.keys[n - 1]! < 0.5;
    const lit = typing || (n > 0 && t < done + 0.3) ? true : bootLit(t, tl);
    const kick = tl.pulseAt(t, this.extra, 0.1);
    drawCursor(c, x0 + 2 + col * this.adv, BOOT.y, BOOT.size, t, tl, { on: lit, glow: 0.5 * kick });

    // the prompt's rule: a hairline under the line, drawn out from the cursor once the role is set
    const rk = prog(t, done + 0.1, done + 0.9, ease.outExpo);
    if (rk > 0) {
      c.fillStyle = rgba('bone', 0.1);
      const cx = x0 + (TEXT.length * this.adv) / 2, half = 700 * rk;
      c.fillRect(cx - half, BOOT.y + 26, half * 2, 1);
      c.font = font(F.mono(400), 16);
      c.fillStyle = rgba('graphite', rk);
      c.fillText('01', cx - half - 34, BOOT.y + 6);
    }

    comp.draw(renderer, L.upload(), out);
    return { ...BOOT_POST, counter: prog(t, done + 0.2, done + 0.8), bloom: (BOOT_POST.bloom ?? 0.55) + 0.3 * kick };
  }
}
