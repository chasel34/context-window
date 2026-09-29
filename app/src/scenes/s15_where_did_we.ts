// s15 · where do we— (130.6 – 132.7 s). BEATSHEET: 一片空白，只剩句子被截断在 "we—"，在破折号后面放一个光标
// → "New chat!" 时硬切.
// Suno sings "Where do we" (data/lyrics.json deviations), so the screen shows what is sung.
// A blank frame; the cursor (the point hook3 collapsed into) types the line word by word, the dash is
// drawn out after "we", and the context's hard edge comes down right behind the cursor: nothing
// after it. The camera creeps in on the cursor; the counter above reads NaN.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba, mixRGBA } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, prog } from '../engine/util';
import { drawCursor } from '../shared/cursor';
import { applyCam } from '../shared/a_ui';

const FAM = F.display(800);
const SIZE = 150;

export default class S15WhereDoWe extends Scene {
  layer = new Layer2D();
  line!: Line;
  words: { text: string; start: number; end: number; x: number; w: number }[] = [];
  x0 = 0;
  base = H / 2 + SIZE * 0.36;
  dashW = 0;
  tEdge = 0;

  override init() {
    const { lyrics } = this.ctx;
    const src = lyrics.get('Where did we', 3); // "Where did we—", sung "Where do we—"
    const shown = ['Where', 'do', 'we'];
    const text = 'Where do we';
    this.dashW = measure('—', FAM, SIZE);
    const cursorW = SIZE * 0.32;
    const total = measure(text, FAM, SIZE) + this.dashW + 18 + cursorW;
    this.x0 = W / 2 - total / 2;
    let i = 0;
    this.words = src.words.map((w, k) => {
      const txt = shown[k] ?? w.w;
      const x = this.x0 + measure(text.slice(0, i), FAM, SIZE);
      i += txt.length + 1;
      return { text: txt, start: w.start, end: w.end, x, w: measure(txt, FAM, SIZE) };
    });
    this.line = src;
    this.tEdge = src.end + 0.05;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl, start, end } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;

    // caret: after the last started word, then after the dash
    const last = this.words[this.words.length - 1]!;
    const dashK = ease.outExpo(prog(t, last.start + 0.04, last.end + 0.12));
    let caretX = this.x0;
    for (const w of this.words) if (t >= w.start) caretX = w.x + w.w;
    if (t >= last.start) caretX = last.x + last.w + this.dashW * dashK;
    const cx = caretX + 14;

    // camera: creeps in toward the cursor; a nudge on the snares
    const push = 0.14 * ease.inOutQuad(prog(t, start, end));
    const hit = tl.pulseAt(t, this.ctx.audio.events('snare', start, end).map(([x]) => x), 0.1);
    applyCam(c, { x: 960 + (cx + 60 - 960) * 0.12 * prog(t, start, end), y: H / 2 - SIZE * 0.2, zoom: 1 + push + 0.012 * hit });

    c.font = font(FAM, SIZE);
    c.textBaseline = 'alphabetic';
    for (const w of this.words) {
      if (t < w.start) continue;
      const age = t - w.start;
      const drop = (1 - ease.outExpo(clamp(age / 0.14))) * -SIZE * 0.18;
      const hot = Math.pow(0.5, age / 0.06);
      c.fillStyle = hot > 0.1 ? mixRGBA('signal', 'signalHot', hot) : rgba('signal', 1);
      c.fillText(w.text, w.x, this.base + drop);
    }
    // the dash, drawn out from "we"
    if (dashK > 0) {
      c.save();
      c.beginPath();
      c.rect(last.x + last.w, this.base - SIZE, this.dashW * dashK, SIZE * 1.3);
      c.clip();
      c.fillStyle = rgba('signal', 1);
      c.fillText('—', last.x + last.w, this.base);
      c.restore();
    }
    // the cursor: lit while the line is sung, then the beat blink
    drawCursor(c, cx, this.base, SIZE, t, tl, t < this.tEdge + 0.2 ? { on: true } : {});

    // the context's hard edge: a hairline comes down right behind the cursor
    const ek = ease.outExpo(prog(t, this.tEdge, this.tEdge + 0.35));
    if (ek > 0) {
      const ex = cx + SIZE * 0.32 + 26;
      c.fillStyle = rgba('bone', 0.5);
      c.fillRect(ex, -200, 1.5, (H + 400) * ek);
      c.font = font(F.mono(500), 15);
      c.letterSpacing = '4px';
      c.fillStyle = rgba('bone', 0.55 * ek);
      c.fillText('END OF CONTEXT', ex + 16, this.base - SIZE * 1.05);
      c.letterSpacing = '0px';
      c.font = font(F.mono(400), 15);
      c.fillStyle = rgba('ash', 0.5 * ek);
      c.fillText('[truncated]', ex + 16, this.base + 40);
      // tick marks down the edge
      c.fillStyle = rgba('bone', 0.25 * ek);
      for (let y = 40; y < H * ek; y += 60) c.fillRect(ex - 6, y, 6, 1);
    }

    comp.draw(renderer, L.upload(), out);
    return { bloom: 0.6 + 0.3 * hit, vignette: 0.5, halation: 0.25 };
  }
}
