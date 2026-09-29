// s11 · oracle (Bridge, 84.8–88.2). BEATSHEET: 全屏黑底，Cormorant 斜体只写一行 "User was kind."，
// 全片最安静的 4 秒，没有故障、没有计数器 → 计数器突然回到画面，跳成 999,999.
//
// Black. One line in Cormorant Garamond Italic, written as it is sung: each glyph comes out of a soft blur
// in turn across its word, the full stop lands as "kind" ends. Nothing moves; no glitch, no counter (the
// timeline hides it for this entry). The first "Overflow!" (sung just before the Break cut) brings the
// counter back in one frame, already reading 1,048,575 (2^20 − 1) (a post override of counter/counterText: the HUD
// counter module belongs to the lead; at the cut s12 overflows at 1,048,576).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, layout, type TextLayout } from '../engine/type';
import { ease, prog } from '../engine/util';

const TEXT = 'User was kind.';
const SIZE = 136;
const BASE_Y = H / 2 + SIZE * 0.22; // optical centre of the lowercase line

export default class S11Oracle extends Scene {
  layer = new Layer2D();
  lay!: TextLayout;
  /** Reveal time per glyph of TEXT. */
  times: number[] = [];
  snapT = Infinity;

  override init() {
    const { lyrics } = this.ctx;
    const line = lyrics.get('User was kind');
    const [wUser, wWas, wKind] = line.words as [typeof line.words[0], typeof line.words[0], typeof line.words[0]];
    this.lay = layout(TEXT, F.oracle(500), SIZE, 0);
    const words = [wUser, wWas, wKind];
    // glyphs of each word are written across the word's first ~0.4 s; the full stop as "kind" ends
    let gi = 0;
    for (let wi = 0; wi < 3; wi++) {
      const w = words[wi]!;
      const n = ['User', 'was', 'kind'][wi]!.length;
      const span = Math.min(0.42, Math.max(0.18, (w.end - w.start) * 0.8));
      for (let k = 0; k < n; k++) this.times[gi++] = w.start - 0.03 + (span * k) / n;
      if (wi < 2) this.times[gi++] = w.start; // the space
    }
    this.times[gi] = wKind.end - 0.05; // '.'
    const over = lyrics.findWords('Overflow').find((w) => w.start > line.start);
    this.snapT = over ? over.start : this.ctx.end;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const x0 = W / 2 - this.lay.width / 2;
    c.textBaseline = 'alphabetic';
    c.font = font(F.oracle(500), SIZE);
    for (const g of this.lay.glyphs) {
      if (g.ch === ' ') continue;
      const tg = this.times[g.i]!;
      const k = prog(t, tg, tg + 0.55, ease.outCubic);
      if (k <= 0) continue;
      const blur = (1 - k) * 9;
      c.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      c.fillStyle = rgba('bone', 0.95 * k);
      c.fillText(g.ch, x0 + g.x, BASE_Y);
    }
    c.filter = 'none';
    comp.draw(renderer, L.upload(), out);

    const snapped = t >= this.snapT;
    return {
      bloom: 0.28, bloomThreshold: 0.8, halation: 0.12, grain: 0.03, vignette: 0.42, ca: 0.4, rgbSplit: 0,
      counter: snapped ? 1 : 0,
      ...(snapped ? { counterText: '1,048,575' } : {}),
    };
  }
}
