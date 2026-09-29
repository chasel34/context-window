// s03 · first token (14.6 – 27.4 s). BEATSHEET: 对话界面从零开始长。每句歌词对应一条用户消息：名字、日期、
// 最爱的歌。"Pin it up" 时一枚洋红图钉钉住第一条消息 → 镜头开始向下滚动.
//
// The chat builds itself on the first bar (header on the downbeat, column rules, input box, context
// meter, one per beat). Each sung line is typed into the input box word by word (the sung word
// signal, token brackets under it, "name/date/fav song" tags on the Verse's third line) and sent on
// the next 8th note; the camera springs down to the new bubble; the assistant answers in the gaps
// ("Saved to memory:" card after the third line). On "Pin" the camera whips up to the first message
// and a pushpin slams into it. From the first "Scroll-" the conversation starts streaming (s04).
// The conversation, its layout and the camera live in shared/a_convo.ts (shared with s04).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, fitSize, plain } from '../engine/type';
import { clamp, ease, prog } from '../engine/util';
import type { Word } from '../engine/lyrics';
import { VerseConvo } from '../shared/a_convo';
import { applyCam } from '../shared/a_ui';

export default class S03FirstToken extends Scene {
  layer = new Layer2D();
  convo!: VerseConvo;

  override init() {
    this.convo = new VerseConvo(this.ctx);
  }

  /** The sung word, huge and hollow behind the chat (holds briefly after the word ends). */
  private drawEcho(c: CanvasRenderingContext2D, t: number, alpha: number) {
    if (alpha <= 0) return;
    let w: Word | null = null;
    for (const x of this.ctx.lyrics.words) { if (x.start > t) break; if (x.start >= this.ctx.start - 0.1) w = x; }
    if (!w) return;
    const hold = 1 - prog(t, w.end + 0.5, w.end + 0.9);
    if (hold <= 0) return;
    const txt = plain(w.w).replace(/[^\p{L}\p{N}']/gu, '').toUpperCase();
    if (!txt) return;
    const fam = F.display(900);
    const size = Math.min(440, fitSize(txt, fam, 1760));
    const age = t - w.start;
    const s = 1 + 0.1 * (1 - ease.outExpo(clamp(age / 0.25)));
    c.save();
    c.globalAlpha = alpha * hold;
    c.translate(960, 540);
    c.scale(s, s);
    c.font = font(fam, size);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.lineWidth = 2;
    c.strokeStyle = rgba('bone', 0.1);
    c.strokeText(txt, 0, size * 0.36);
    const hot = Math.pow(0.5, age / 0.12);
    c.fillStyle = rgba('signal', 0.05 + 0.1 * hot);
    c.fillText(txt, 0, size * 0.36);
    c.restore();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const cv = this.convo;
    const cam = cv.cam(t);
    const rib = prog(t, cv.tStream - 0.05, cv.tStream + 0.15);
    this.drawEcho(c, t, 1 - rib);
    applyCam(c, cam);
    cv.drawMessages(c, t, cam, 1 - 0.7 * rib);
    c.setTransform(1, 0, 0, 1, 0, 0);
    cv.drawChrome(c, t);
    cv.drawRibbon(c, t);
    comp.draw(renderer, L.upload(), out);
    const pin = tl.pulseAt(t, [cv.pinT], 0.12);
    return { bloom: 0.55 + 0.4 * pin, vignette: 0.38, rgbSplit: 3 * pin + 2 * tl.pulseAt(t, cv.scrolls, 0.06), shake: [0, 6 * pin] };
  }
}
