// Global overlay: the token counter (top right, on by default) and optional crop marks.
// Scenes control it through post overrides: `counter` (opacity, 0 hides it), `paper` (draw in ink on
// light grounds such as the magenta hooks), `counterText`, `counterCorruption`, `hud` (all of it), `frame`.
// Adapted from mexicat/pdoom-video (MIT), see LICENSE-THIRD-PARTY.md.
import { Layer2D, W, H } from './gl';
import { rgba } from './palette';
import { F, font } from './type';
import { clamp, ease, lerp } from './util';
import type { Timeline } from '../timeline';
import { TokenCounter, drawCounter } from '../shared/counter';

export interface HudState {
  opacity: number;
  frame: number;
  counter: number;
  paper: number;
  counterText?: string;
  corruption?: number;
  /** [right edge x, baseline y] override. */
  pos?: [number, number];
  /** 0..1 ink plate behind the counter. */
  plate?: number;
}

/** Where the global counter sits (right edge x, digits baseline y), for scenes that want to line up with it. */
export const COUNTER_POS = { x: W - 64, y: 104, size: 34 };

export class Hud {
  layer = new Layer2D();
  counter: TokenCounter;
  constructor(public tl: Timeline) {
    this.counter = new TokenCounter(tl);
  }

  draw(t: number, st: HudState) {
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    if (st.opacity <= 0.001) return L.upload();
    c.globalAlpha = st.opacity;
    const ink = st.paper > 0.5;
    if (st.frame > 0.001) this.cropMarks(c, st.frame, ink);
    if (st.counter > 0.001) {
      c.save();
      c.globalAlpha *= clamp(st.counter);
      const [x, y] = st.pos ?? [COUNTER_POS.x, COUNTER_POS.y];
      const size = COUNTER_POS.size;
      const cs = this.counter.state(t);
      if (st.plate && st.plate > 0.001) {
        // an ink plate sized to the digits and the label (drawn in the HUD, so it is never motion-blurred)
        c.font = font(F.mono(500), size);
        const w = Math.max(c.measureText(st.counterText ?? cs.text).width, 190);
        c.fillStyle = rgba(ink ? 'bone' : 'ink', 0.82 * clamp(st.plate));
        c.fillRect(x - w - 18, y - size * 1.05 - size * 0.32 - 14, w + 36, size * 1.05 + size * 0.32 + 28);
      }
      drawCounter(c, x, y, cs, t, { size, ink, text: st.counterText, corruption: st.corruption });
      c.restore();
    }
    return L.upload();
  }

  /** Corner marks; as `k` drops they fly out along the diagonals and past the edges. */
  private cropMarks(c: CanvasRenderingContext2D, k: number, ink: boolean) {
    const e = ease.inOutCubic(clamp(k));
    c.save();
    c.globalAlpha *= clamp(k * 3);
    c.strokeStyle = ink ? rgba('ink', 0.45) : rgba('bone', 0.34);
    c.lineWidth = 1.25;
    const m = lerp(-40, 36, e), l = 22;
    c.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      c.moveTo(x + sx * l, y + 0.5 * sy); c.lineTo(x, y + 0.5 * sy); c.lineTo(x, y + sy * l);
    }
    c.stroke();
    c.restore();
  }
}
