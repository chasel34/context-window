// s16 · new chat (132.7 s – end). BEATSHEET: 干净的新对话界面，计数器归零。"You are a helpful assistant!" 用
// 和第 2 场完全相同的排版重新出现，"Hi! How can I help?" 在输入框里打出来。最后几秒只剩闪烁的光标 → 回到第 1 场.
//
//   "New chat!"      hard cut on the word: the title alone, lit word by word; the counter snaps to 0
//   4 kicks          the clean chat builds one piece per kick (the title flies into the header,
//                    column rules, input box, empty context meter)
//   "You are a…"     the system prompt returns in s02's exact typography (shared/a_ui.ts), then folds
//                    into the chat's system message as in s02
//   "Hi! How can…"   typed into the input box word by word; the camera leans in on it
//   outro bars       the UI dissolves a piece per beat, the text is backspaced on 16ths, and the
//                    cursor travels to the centre and grows into the boot cursor: the last frames
//                    are s01's frame 0 (the loop)
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font, plain } from '../engine/type';
import type { Line } from '../engine/lyrics';
import { clamp, ease, lerp, prog } from '../engine/util';
import { formatTokens, LIMIT } from '../shared/counter';
import { drawLyricLine } from '../shared/lyric';
import { drawCursor } from '../shared/cursor';
import { chatMetrics, drawHeader, drawInput, drawMessage, monoAdv, type ChatMessage, type ChatWord } from '../shared/chat';
import { CONVO } from '../shared/a_convo';
import {
  applyCam, BOOT, BOOT_POST, bootLit, drawSysFold, drawSysMeta, drawSysWords, kOf, SYS, SYS_TEXT, sysPop, sysWordColor, type Cam,
} from '../shared/a_ui';

/** The chat camera (the steady framing of s03). */
const CHAT_CAM: Cam = { x: W / 2, y: 430, zoom: 1.36 };

export default class S16NewChat extends Scene {
  layer = new Layer2D();
  title!: Line;
  sys!: Line;
  hi!: Line;
  hiWords: ChatWord[] = [];
  kicks: number[] = [];
  sysMsg!: ChatMessage;
  bar0 = 0; // first bar after "Hi! How can I help?" (the dissolve)
  tFold0 = 0; tFold1 = 0; tFold2 = 0;
  target = { x: 0, y: 0, w: 0 };

  override init() {
    const { lyrics, tl, audio, start } = this.ctx;
    this.title = lyrics.get('New chat!', 0);
    this.sys = lyrics.get('You are a helpful assistant!', 1);
    this.hi = lyrics.get('Hi! How can I help?', 0);
    this.hiWords = this.hi.words.map((w) => ({ text: plain(w.w), start: w.start, end: w.end }));
    // the build: the four kicks after "chat!" (the drum fill into the outro)
    this.kicks = audio.events('kick', this.title.end, this.title.end + 1.5).filter(([, s]) => s > 0.5).map(([x]) => x).slice(0, 4);
    while (this.kicks.length < 4) this.kicks.push(this.title.end + 0.3 + this.kicks.length * tl.beatPeriod / 2);
    // fold between the end of the prompt and "Hi!"
    this.tFold0 = this.sys.end;
    this.tFold2 = this.hi.start - 0.04;
    this.tFold1 = lerp(this.tFold0, this.tFold2, 0.5);
    // serif → mono hard swap once the fold has landed (see s02): no crossfade, no doubled text
    this.sysMsg = { role: 'system', text: SYS_TEXT, t0: lerp(this.tFold1, this.tFold2, 0.85), id: 0, stamp: '00:00.0' };
    const { pad, label } = chatMetrics(CONVO.size);
    const z = CHAT_CAM.zoom;
    this.target = {
      x: (CONVO.colX + pad - CHAT_CAM.x) * z + W / 2,
      y: (CONVO.top + label + pad * 0.6 + CONVO.size - CHAT_CAM.y) * z + H / 2,
      w: SYS_TEXT.length * monoAdv(CONVO.size) * z,
    };
    this.bar0 = tl.timeOfBar(Math.ceil(tl.bar(this.hi.end + 0.3)));
    void start;
  }

  /** The empty-state card in the middle of the fresh chat: an empty context meter that ticks on the beat. */
  private drawEmpty(c: CanvasRenderingContext2D, t: number, a: number) {
    if (a <= 0.001) return;
    const tl = this.ctx.tl;
    const cx = W / 2, cy = 470;
    const bp = tl.beatPulse(t, 0.12);
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(500), 15);
    c.letterSpacing = '5px';
    c.fillStyle = rgba('ash', 0.6);
    c.fillText('NEW CONVERSATION', cx, cy - 58);
    c.letterSpacing = '0px';
    c.font = font(F.mono(400), 44);
    const n = '0';
    const rest = ` / ${formatTokens(LIMIT)}`;
    const wN = c.measureText(n).width, wR = c.measureText(rest).width;
    const x0 = cx - (wN + wR) / 2;
    c.textAlign = 'left';
    c.fillStyle = rgba('bone', 0.85);
    c.fillText(n, x0, cy);
    c.fillStyle = rgba('bone', 0.28);
    c.fillText(rest, x0 + wN, cy);
    c.font = font(F.mono(400), 15);
    c.letterSpacing = '3px';
    c.textAlign = 'center';
    c.fillStyle = rgba('ash', 0.5);
    c.fillText('TOKENS IN CONTEXT', cx, cy + 34);
    c.letterSpacing = '0px';
    // the empty bar: a signal tick at zero that breathes on the beat
    const bw = 520, by = cy + 62;
    c.fillStyle = rgba('bone', 0.1);
    c.fillRect(cx - bw / 2, by, bw, 3);
    c.fillStyle = rgba('signal', 0.6 + 0.4 * bp);
    c.fillRect(cx - bw / 2, by - 3 - 4 * bp, 3, 9 + 8 * bp);
    c.restore();
  }

  /** Beat i of the dissolve bar. */
  private beatT(i: number) { return this.ctx.tl.timeOfBeat(Math.round(this.ctx.tl.beat(this.bar0)) + i); }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl } = this.ctx;
    const t = f.t;
    clearRT(renderer, out, LIN.ink);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const [k1, k2, k3, k4] = this.kicks as [number, number, number, number];
    const bk = (tk: number) => prog(t, tk, tk + 0.3, ease.outExpo);
    // dissolve: one piece per beat of the bar after the last line; then backspace; then the cursor goes home
    const gone = (i: number) => 1 - prog(t, this.beatT(i), this.beatT(i) + 0.18, ease.inCubic);
    const eraseT0 = this.beatT(4), eraseT1 = this.beatT(8);

    // screen camera: leans in on the input box while "Hi!…" is typed, back out for the erase
    const I = CONVO.input;
    // then, while the text is backspaced, it zooms into the caret: the cursor (40 px) lands at the
    // frame centre at 72 px, exactly the boot cursor of s01's frame 0
    const lean = ease.inOutCubic(prog(t, this.hi.start - 0.1, this.hi.end + 0.2));
    const nChars = plain(this.hi.text).length;
    const adv = monoAdv(I.size);
    const tx = I.x + I.size * 0.7 + adv * 1.6;
    const base = I.y + I.h / 2 + I.size * 0.34;
    const home = ease.inOutCubic(prog(t, eraseT0 - 0.2, eraseT1));
    const eraseCont = nChars * ease.inOutQuad(prog(t, eraseT0, eraseT1));
    const curX = tx + 2 + I.size * 0.16 + (nChars - eraseCont) * adv, curY = base - I.size * 0.28;
    const leanX = W / 2, leanY = I.y + I.h / 2 - 40;
    const sz = Math.exp(lerp(Math.log(1 + 0.22 * lean), Math.log(BOOT.size / I.size), home));
    const fx = lerp(lerp(W / 2, leanX, lean), curX, home), fy = lerp(lerp(H / 2, leanY, lean), curY, home);
    const SC = new DOMMatrix().translate(W / 2, H / 2).scale(sz, sz).translate(-fx, -fy);
    const uiDim = 1 - 0.8 * prog(t, this.sys.start - 0.3, this.sys.start) * (1 - prog(t, this.tFold1, this.tFold2));

    // ---- chat world: the system message once the prompt has folded into it
    if (t >= this.sysMsg.t0) {
      c.setTransform(SC);
      const wc = new DOMMatrix().translate(W / 2, H / 2).scale(CHAT_CAM.zoom).translate(-CHAT_CAM.x, -CHAT_CAM.y);
      c.setTransform(SC.multiply(wc));
      drawMessage(c, this.sysMsg, CONVO.colX, CONVO.top, CONVO.colW, t, tl, CONVO.size, { hair: 1 / CHAT_CAM.zoom, enter: 0, alpha: gone(1) });
    }
    // column rules
    c.setTransform(SC);
    const rules = bk(k2) * gone(2) * uiDim;
    if (rules > 0) {
      c.fillStyle = rgba('bone', 0.08 * rules);
      for (const x of [CONVO.colX - 90, CONVO.colX + CONVO.colW + 60]) {
        const sx = (x - CHAT_CAM.x) * CHAT_CAM.zoom + W / 2;
        c.fillRect(sx, 0, 1, H * bk(k2));
      }
    }
    // header + empty meter
    const Hh = CONVO.header;
    const hb = bk(k1) * gone(0) * uiDim;
    if (hb > 0) {
      c.save();
      c.globalAlpha = hb;
      drawHeader(c, Hh.x, Hh.y, Hh.w, Hh.h, CONVO.size, 'new chat', 1);
      c.font = font(F.mono(400), 15);
      c.fillStyle = rgba('ash', 0.6);
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillText('assistant · 1M ctx · temp 0.7', Hh.x + Hh.w, Hh.y + Hh.h / 2);
      c.textAlign = 'left';
      const mb = bk(k4);
      c.fillStyle = rgba('bone', 0.1);
      c.fillRect(Hh.x, Hh.y + Hh.h + 6, Hh.w * mb, 3);
      for (let i = 1; i < 10; i++) { c.fillStyle = rgba('ink', 1); c.fillRect(Hh.x + (Hh.w * mb * i) / 10, Hh.y + Hh.h + 6, 2, 3); }
      c.fillStyle = rgba('signal', 1);
      c.fillRect(Hh.x, Hh.y + Hh.h + 6, 2, 3);
      // the empty context, stated under the meter
      c.font = font(F.mono(400), 14);
      c.letterSpacing = '2px';
      c.fillStyle = rgba('ash', 0.55 * mb);
      c.textAlign = 'right';
      c.textBaseline = 'alphabetic';
      c.fillText(`0 / ${formatTokens(LIMIT)} tokens`, Hh.x + Hh.w, Hh.y + Hh.h + 30);
      c.letterSpacing = '0px';
      c.textAlign = 'left';
      c.restore();
    }
    // empty state (between the build and the system prompt): the fresh window, idling on the beat
    this.drawEmpty(c, t, bk(k4) * gone(0) * (1 - prog(t, this.sys.start - 0.55, this.sys.start - 0.28)));
    // input box: built on kick 3; its frame dissolves on beat 4; the text is backspaced on 16ths
    const ib = bk(k3);
    let caret = { x: I.x + 100, y: I.y + I.h / 2 + I.size * 0.34, size: I.size };
    if (ib > 0) {
      const frameA = gone(3) * uiDim;
      const n = this.hiWords.map((w) => w.text).join(' ').length;
      const steps = Math.floor((t - eraseT0) / (tl.beatPeriod / 4)) + 1;
      const erased = t < eraseT0 ? 0 : Math.min(n, Math.ceil((n * steps) / 16));
      c.save();
      c.globalAlpha = uiDim;
      // frame (fades) and content (stays) are drawn in two passes so the text can outlive the box
      c.save();
      c.globalAlpha *= frameA;
      drawInput(c, I.x, I.y, I.w, I.h, t, tl, {}, { size: I.size, build: ib, placeholder: '', cursor: { show: false } });
      c.restore();
      const typedDone = t >= this.hi.end + 0.2;
      const content = typedDone ? { text: plain(this.hi.text), t0: 0, typeDur: 0, erased } : { words: this.hiWords };
      caret = drawInput(c, I.x, I.y, I.w, I.h, t, tl, content, {
        size: I.size, build: 1, frame: false, placeholder: t < this.hi.start ? 'Message…' : '', cursor: { on: t >= eraseT0 && t < eraseT1 ? true : t >= eraseT1 ? bootLit(t, tl) : undefined },
      });
      c.restore();
    }

    // ---- the title "New chat!" (hard cut), flies into the header on the first kick
    const fly = ease.inOutExpo(prog(t, k1 - 0.12, k1 + 0.22));
    if (fly < 1) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      const tx = lerp(W / 2, Hh.x + 200, fly), ty = lerp(H / 2 + 80, Hh.y + Hh.h / 2 + 8, fly), s = lerp(1, 0.09, fly);
      c.save();
      c.translate(tx, ty);
      c.scale(s, s);
      c.globalAlpha = 1 - prog(fly, 0.7, 1);
      drawLyricLine(c, this.title, t, 0, 0, { family: F.display(900), size: 230, align: 'center', base: 'bone', baseAlpha: 0.2 });
      c.restore();
    }

    // ---- the system prompt, s02's exact typography, then the fold
    const promptA = prog(t, this.sys.start - 0.25, this.sys.start - 0.05);
    if (promptA > 0 && t < this.tFold2) {
      const tm = (i: number) => { const w = this.sys.words[i]; return w && t >= w.start ? w : undefined; };
      const color = (i: number) => sysWordColor(tm(i), t, 0.16, this.sys.end - 0.2);
      const fk1 = kOf(t, this.tFold0, this.tFold1), fk2 = kOf(t, this.tFold1, this.tFold2);
      if (fk1 <= 0) {
        const cy = (SYS.y[0]! + SYS.y[1]!) / 2 - SYS.size * 0.3;
        applyCam(c, { x: 960, y: cy, zoom: 1 });
        c.globalAlpha = promptA;
        drawSysMeta(c, t, this.sys.words.filter((w) => t >= w.start).length, 1, ease.outExpo(promptA));
        drawSysWords(c, color, { scale: (i) => sysPop(tm(i), t) });
        c.globalAlpha = 1;
      } else {
        c.setTransform(SC);
        if (t < this.sysMsg.t0) drawSysFold(c, (i) => color(i), fk1, fk2, this.target, 1);
      }
    }


    comp.draw(renderer, L.upload(), out);
    const seam = prog(t, eraseT0, eraseT1);
    const kickP = tl.pulseAt(t, this.kicks, 0.08);
    return {
      bloom: lerp(0.6 + 0.3 * kickP, BOOT_POST.bloom!, seam),
      bloomThreshold: lerp(0.85, BOOT_POST.bloomThreshold!, seam),
      vignette: lerp(0.38, BOOT_POST.vignette!, seam),
      halation: lerp(0.22, BOOT_POST.halation!, seam),
      counter: 1 - prog(t, this.beatT(3), this.beatT(3) + 0.3),
      zoom: 1 + 0.012 * kickP,
    };
  }
}
