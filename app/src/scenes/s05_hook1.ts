// s05 · hook1 (Chorus 1, damage 0). The parametric hook (src/shared/hook.ts), clean: C-C-CONTEXT! cut per
// syllable, "(window!)" shrinks the frame into a window, "Token ×4" / "Two hundred K" hand the frame to
// the counter (it lands on 200,000 on "K").
// Exit (BEATSHEET: 窗口框缩小，退回界面，露出下面的缓存): on the last bar's downbeat the frame snaps into a
// window, which then shrinks and sinks back into the interface; around it, the KV cache comes up — a grid
// of key/value cells lighting row by row (what s06 opens on).
import type { Frame } from '../engine/scene';
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { clamp, ease, hash, lerp, prog } from '../engine/util';
import { HookScene, type Rect } from '../shared/hook';

const KEYS = ['name', 'date', 'song', 'pin', 'page', 'scroll', 'token', 'K', 'memory', 'rental', 'begin', 'window', 'row', 'value', 'cache', 'line'];

export default class S05Hook1 extends HookScene {
  exitT0 = 0;

  override init() {
    super.init();
    const tl = this.ctx.tl;
    this.exitT0 = tl.timeOfBar(Math.round(tl.bar(this.ctx.end)) - 1); // the last bar's downbeat
  }

  /** 0..1 the window forms on the last downbeat; 0..1 then it retreats. */
  exitIn(t: number) { return prog(t, this.exitT0 - 0.02, this.exitT0 + 0.2, (x) => ease.outBack(x, 1.3)); }
  exitRetreat(t: number) { return prog(t, this.exitT0 + 0.45, this.ctx.end - 0.02, ease.inOutCubic); }

  override windowAmount(t: number) { return Math.max(super.windowAmount(t), this.exitIn(t)); }

  override windowRect(t: number, k: number): Rect {
    const r = super.windowRect(t, k);
    const q = this.exitRetreat(t);
    if (q <= 0) return r;
    const s = lerp(r.w / W, 0.2, q);
    const w = W * s, h = H * s;
    return { x: (W - w) / 2, y: lerp(r.y, H / 2 - h / 2 + 12, q), w, h };
  }

  override drawOutside(c: CanvasRenderingContext2D, f: Frame, r: Rect, k: number) {
    super.drawOutside(c, f, r, k);
    const q = prog(f.t, this.exitT0 + 0.1, this.ctx.end - 0.05);
    if (q <= 0) return;
    // the KV cache: pairs of cells (key | value), rows lighting on 8ths toward the window
    const cw = 118, ch = 50, gap = 6;
    const cols = Math.ceil(W / (cw + gap)) + 1, rows = Math.ceil(H / (ch + gap)) + 1;
    const ox = (W - cols * (cw + gap)) / 2, oy = (H - rows * (ch + gap)) / 2;
    const tl = this.ctx.tl;
    const eighths = Math.max(0, (tl.beat(f.t) - tl.beat(this.exitT0 + 0.1)) * 2);
    c.save();
    c.font = font(F.mono(500), 13);
    for (let j = 0; j < rows; j++) {
      // rows light from the centre outwards, one pair of rows per 8th note
      const dist = Math.abs(j - (rows - 1) / 2);
      const lit = clamp(eighths - dist * 0.9);
      if (lit <= 0) continue;
      for (let i = 0; i < cols; i++) {
        const x = ox + i * (cw + gap), y = oy + j * (ch + gap);
        const key = i % 2 === 0;
        const a = lit * (0.18 + 0.2 * hash(i, j, 3)) * (1 - 0.6 * clamp(q * 1.4 - 0.4) * (hash(i, j, 4) > 0.5 ? 1 : 0));
        c.strokeStyle = rgba(key ? 'bone' : 'graphite', a * 1.6);
        c.lineWidth = 1;
        c.strokeRect(x + 0.5, y + 0.5, cw, ch);
        const w = KEYS[Math.floor(hash(i >> 1, j, 5) * KEYS.length)]!;
        c.fillStyle = rgba(key ? 'bone' : 'signal', a * 2.2);
        c.fillText(key ? `k:${w}` : `v:${(hash(i, j, 6) * 2 - 1).toFixed(3)}`, x + 10, y + ch / 2 + 5);
      }
    }
    c.restore();
  }
}
