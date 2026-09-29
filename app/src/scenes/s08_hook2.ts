// s08 · hook2 (Chorus 2, damage 0.4). Same structure as hook1, visibly damaged: ▒ glyphs, torn slices,
// 1–2 frame offsets, outline echoes; "a million more" rolls the counter onto 1,000,000.
// Exit (BEATSHEET: 画面整体被"选中"，高亮，然后被压缩): on "we" of "Where did we begin?" the text is
// select-all'd (bone selection bars; the film keeps its one signal colour, so no blue), then on "begin?"
// the whole frame is crushed vertically into a line on the cut to s09 (compress).
import type { Frame } from '../engine/scene';
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { ease, prog } from '../engine/util';
import { HookScene, CUT_LEAD, type Rect } from '../shared/hook';

export default class S08Hook2 extends HookScene {
  selT = Infinity;
  crushT = Infinity;

  override init() {
    super.init();
    const last = this.shots[this.shots.length - 1];
    if (last && /^Where did we begin/i.test(last.line.text)) {
      const ws = last.line.words;
      this.selT = ws[2]!.start - CUT_LEAD; // "we"
      this.crushT = Math.min(ws[3]!.start - CUT_LEAD, this.ctx.end - 0.16); // "begin?"
    }
    // the exit happens inside the sung line: no tail
    this.tailT = Infinity;
  }

  override selectAmount(t: number) { return prog(t, this.selT, this.selT + 0.16); }

  override windowRect(t: number, k: number): Rect {
    const r = super.windowRect(t, k);
    const q = prog(t, this.crushT, this.ctx.end - 0.01, ease.inCubic);
    if (q <= 0) return r;
    const h = Math.max(4, r.h * (1 - q));
    return { x: r.x - 40 * q, y: H / 2 - h / 2, w: r.w + 80 * q, h };
  }

  override drawOverlay(c: CanvasRenderingContext2D, f: Frame, r: Rect) {
    const q = prog(f.t, this.crushT, this.ctx.end - 0.01, ease.inCubic);
    if (q <= 0) return;
    // the crushed frame glows along its seam
    c.save();
    c.fillStyle = rgba('bone', 0.6 * q);
    c.fillRect(0, H / 2 - 1, W, 2);
    c.fillStyle = rgba('signal', 0.25 * q);
    c.fillRect(0, r.y - 6, W, r.h + 12);
    c.restore();
  }

  override post(f: Frame, s: Parameters<HookScene['post']>[1]) {
    const o = super.post(f, s);
    const q = prog(f.t, this.crushT, this.ctx.end - 0.01, ease.inCubic);
    if (q > 0) { o.paper = 0; o.zoom = 1; o.shake = [0, 0]; }
    return o;
  }
}
