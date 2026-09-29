// The verse-1 conversation, shared by s03 (first token) and s04 (scroll) so the cut between them is
// seamless: one message list, one world layout, and one closed-form camera for 14.6 → 32.2 s.
//
//   - Each lyric line of Verse 1 / Pre-Chorus 1 is typed into the input box as it is sung (word by
//     word, the sung word magenta) and "sent" on the next 8th note after it ends: it becomes a user
//     bubble in the chat. The assistant answers in the gaps.
//   - From the first "Scroll-" (26.9) the conversation streams: messages arrive at an accelerating
//     rate plus a burst on every sung "scroll". The camera follows the newest message with a spring
//     per arrival (the "kick"), so the scroll speed is the chat's autoscroll.
//   - The "SCROLL-" ribbon: every sung scroll is a giant word that slams in at the centre and pushes
//     the older ones up a row (a spring per word).
// Everything is a pure function of t.
import type { SceneCtx } from '../engine/scene';
import type { Line } from '../engine/lyrics';
import { W, H } from '../engine/gl';
import { F, font, measure, plain } from '../engine/type';
import { rgba, mixRGBA } from '../engine/palette';
import { clamp, ease, hash, keys, noise1, prog, springStep } from '../engine/util';
import { chatMetrics, joinWords, drawHeader, drawInput, drawMessage, measureMessage, monoAdv, type ChatMessage, type ChatWord } from './chat';
import { TokenCounter } from './counter';
import { toScreen, type Cam } from './a_ui';

export const CONVO = {
  size: 30,
  colX: 510,
  colW: 900,
  /** World y of the first message block (the system message). */
  top: 118,
  /** Screen-fixed chrome. */
  header: { x: W / 2 - 640, y: 26, w: 1280, h: 58 },
  input: { x: W / 2 - 610, y: H - 158, w: 1220, h: 106, size: 40 },
  /** Where the newest message's bottom sits on screen (px above the frame centre = +). */
  follow: 340,
};

export interface ConvoMsg extends ChatMessage {
  /** World y of the block top, and its height. */
  y: number;
  h: number;
  /** Spring kick strength multiplier for this arrival. */
  kick: number;
}

const ASSIST_TEXT = [
  'Hello! Nice to meet you. I’m listening.',
  'Every word stays in context.',
];

const STREAM_USER = [
  'remember my name', 'what day is it?', 'my favorite song — you know it', 'scroll', 'keep going', 'don’t forget',
  'still there?', 'what did I say first?', 'more', 'scroll', 'pin that too', 'name. date. song.', 'again', 'further',
  'scroll scroll', 'is it still in there?', 'you remember, right?', 'keep it all', 'down', 'longer',
];
const STREAM_ASSIST = [
  'Of course.', 'Noted.', 'I remember everything.', 'Kept.', 'Still here.', 'Saved to context.', 'Got it — pinned.',
  'Scrolling…', '(earlier messages still in context)', 'Yes.', 'Every token.', 'Holding on to that.', 'Mm-hm.',
];

export class VerseConvo {
  msgs: ConvoMsg[] = [];
  /** Input box script: lyric lines typed and sent. */
  inputs: { words: ChatWord[]; sentAt: number }[] = [];
  /** Follow-spring targets (world y at the frame centre) and their times. */
  targets: { t: number; y: number; kick: number }[] = [];
  scrolls: number[] = [];
  counter: TokenCounter;
  tStart: number;
  tStream: number;
  pinT = 0;
  pinMsg = 1;
  /** Camera focus y once the chat is built (before the follow springs). */
  F1 = 430;
  lines: Line[] = [];

  constructor(private ctx: SceneCtx) {
    const { lyrics, tl } = ctx;
    this.counter = new TokenCounter(tl);
    const s03 = tl.scene('s03'), s04 = tl.scene('s04');
    this.tStart = s03.start;
    const stamp = (t: number) => `00:${(t).toFixed(1).padStart(4, '0')}`;
    const msgs: Omit<ConvoMsg, 'y' | 'h'>[] = [];
    msgs.push({ role: 'system', text: 'You are a helpful assistant!', t0: -1, id: 0, stamp: stamp(3.6), kick: 1 });
    // lyric lines typed and sent
    this.lines = lyrics.linesIn(s03.start, s04.end).filter((l) => l.start >= s03.start - 0.1);
    const tags: Record<string, string> = { 'name,': 'name', 'date,': 'date', song: 'fav song' };
    this.scrolls = tl.wordTimes('scroll', s03.start, s04.end);
    this.tStream = this.scrolls[0] ?? s04.start;
    const pinWord = lyrics.findWords('Pin').find((w) => w.start > s03.start)!;
    this.pinT = pinWord.start;
    let uid = 1;
    const sentOf = (l: Line) => tl.timeOfBeat(Math.ceil(tl.beat(l.end + 0.06) * 2) / 2);
    this.lines.forEach((l, li) => {
      const words: ChatWord[] = l.words.map((w) => ({ text: plain(w.w), start: w.start, end: w.end, tag: tags[plain(w.w).toLowerCase()] }));
      const next = this.lines[li + 1];
      const isWatch = /^Watch/i.test(l.text);
      const sent = isWatch ? Infinity : Math.min(sentOf(l), next ? next.start - 0.02 : Infinity);
      this.inputs.push({ words, sentAt: sent });
      if (sent === Infinity) return;
      const text = joinWords(words).text;
      msgs.push({ role: 'user', text, words, t0: sent, id: uid++, stamp: stamp(l.start), kick: sent >= this.tStream ? 1.6 : 1, tokens: true });
      if (sent >= this.tStream) return;
      // assistant reply in the gap
      const gapEnd = next ? next.start - 0.25 : sent + 1;
      const t0 = sent + 0.22;
      if (/^Name/i.test(l.text)) {
        msgs.push({ role: 'assistant', text: 'Saved to memory:', t0, typeDur: 0.18, id: uid++, stamp: stamp(t0), kick: 1, card: this.memoryCard(t0 + 0.2) });
      } else if (/^Pin/i.test(l.text)) {
        msgs.push({ role: 'assistant', text: 'Pinned. I won’t forget.', t0, typeDur: Math.min(0.5, gapEnd - t0), id: uid++, stamp: stamp(t0), kick: 1 });
      } else {
        const txt = ASSIST_TEXT[Math.min(ASSIST_TEXT.length - 1, li)]!;
        msgs.push({ role: 'assistant', text: txt, t0, typeDur: Math.max(0.3, Math.min(txt.length * 0.03, gapEnd - t0)), id: uid++, stamp: stamp(t0), kick: 1 });
      }
    });
    // the pin lands on the first user message
    const first = msgs.find((m) => m.role === 'user');
    if (first) first.pinnedAt = this.pinT;
    this.pinMsg = msgs.indexOf(first!);
    // the stream: accelerating arrivals + a burst on every sung "scroll"
    const r0 = 1.6, a = 0.72, tEnd = s04.end + 0.1;
    const times: { t: number; kick: number }[] = [];
    for (let k = 1; ; k++) {
      const t = this.tStream + Math.log(1 + (k * a) / r0) / a;
      if (t > tEnd) break;
      times.push({ t, kick: 0.8 });
    }
    this.scrolls.forEach((st, i) => { const n = 1 + Math.min(4, Math.floor(i / 2)); for (let j = 0; j < n; j++) times.push({ t: st + j * 0.012, kick: 2.2 }); });
    times.sort((x, y) => x.t - y.t);
    times.forEach(({ t, kick }, i) => {
      const user = hash(i, 3) < 0.5;
      const list = user ? STREAM_USER : STREAM_ASSIST;
      const text = list[Math.floor(hash(i, 7) * list.length)]!;
      msgs.push({ role: user ? 'user' : 'assistant', text, t0: t, id: uid++, stamp: stamp(t), kick, tokens: user && hash(i, 9) < 0.5 });
    });
    msgs.sort((x, y) => x.t0 - y.t0);
    msgs.forEach((m, i) => (m.id = i));
    // world layout (static)
    const { gap } = chatMetrics(CONVO.size);
    let y = CONVO.top;
    this.msgs = msgs.map((m) => {
      const h = measureMessage(m, CONVO.colW, CONVO.size).h;
      const out = { ...m, y, h } as ConvoMsg;
      y += h + gap;
      return out;
    });
    // restore the pin reference after the sort/copy
    this.pinMsg = this.msgs.findIndex((m) => m.pinnedAt !== undefined);
    // follow targets: keep the newest bottom at `follow` px below centre
    let T = this.F1;
    for (const m of this.msgs) {
      if (m.t0 < 0) continue;
      const want = m.y + m.h - CONVO.follow / this.baseZoom(m.t0);
      if (want > T) { this.targets.push({ t: m.t0, y: want - T, kick: m.kick }); T = want; }
    }
  }

  /** "Saved to memory" card: three rows, one per 8th note after t0. */
  private memoryCard(t0: number): ChatMessage['card'] {
    const rows: [string, string][] = [['name', '“you”'], ['date', '29·09·2026'], ['favorite song', '“Context Window”']];
    const size = CONVO.size;
    const period = this.ctx.tl.beatPeriod / 2;
    return {
      h: rows.length * size * 1.25 + size * 0.2,
      minW: 640,
      draw: (c, x, y, w, t) => {
        c.save();
        rows.forEach(([k, v], i) => {
          const ti = t0 + i * period;
          if (t < ti) return;
          const e = ease.outExpo(clamp((t - ti) / 0.2));
          const yy = y + i * size * 1.25 + size * 0.8;
          const fl = Math.pow(0.5, (t - ti) / 0.08);
          c.globalAlpha = e;
          c.font = font(F.mono(500), size * 0.5);
          c.letterSpacing = `${size * 0.08}px`;
          c.fillStyle = rgba('signal', 0.95);
          c.fillText(k.toUpperCase(), x + (1 - e) * 30, yy);
          c.letterSpacing = '0px';
          const kw = measure(k.toUpperCase(), F.mono(500), size * 0.5, size * 0.08);
          c.fillStyle = rgba('graphite', 0.9);
          c.font = font(F.mono(400), size * 0.5);
          const vx = x + 290;
          let dots = '';
          for (let d = 0; d < Math.floor((vx - x - kw - 16) / (size * 0.3)); d++) dots += '·';
          c.fillText(dots, x + kw + 10, yy);
          c.font = font(F.mono(500), size * 0.8);
          c.fillStyle = fl > 0.1 ? mixRGBA('bone', 'signalHot', fl) : rgba('bone', 0.95);
          c.fillText(v, vx, yy);
        });
        c.restore();
      },
    };
  }

  /** Zoom before the pin excursion and beat pulses. */
  baseZoom(t: number) {
    const s = this.tStart;
    const b = (i: number) => this.ctx.tl.timeOfBeat(Math.round(this.ctx.tl.beat(s)) + i);
    return keys(t, [
      [s, 1.75], [b(1), 1.7, ease.linear], [b(3), 1.36, ease.inOutCubic], [this.tStream - 0.3, 1.44, ease.linear],
      [this.tStream + 2.2, 1.05, ease.inOutCubic], [this.tStream + 4.4, 0.9, ease.inOutCubic],
    ]);
  }

  /** Pin excursion weight 0..1 (camera visits the first message while the pin lands). */
  pinShot(t: number) {
    const bp = this.ctx.tl.beatPeriod;
    return prog(t, this.pinT - 0.24, this.pinT - 0.02, ease.inOutExpo) * (1 - prog(t, this.pinT + 2.4 * bp, this.pinT + 3.6 * bp, ease.inOutCubic));
  }

  /** The camera, closed form. */
  cam(t: number): Cam {
    const { tl } = this.ctx;
    const b = (i: number) => tl.timeOfBeat(Math.round(tl.beat(this.tStart)) + i);
    const sys = this.msgs[0]!;
    const F0 = sys.y + sys.h / 2 + 100;
    let y = F0 + (this.F1 - F0) * prog(t, b(1), b(3), ease.inOutCubic);
    for (const g of this.targets) {
      if (g.t > t) break;
      const k = g.kick;
      y += g.y * springStep(t - g.t, k > 1.5 ? 3.4 : 2.4, k > 1.5 ? 0.42 : 0.6);
    }
    let x = W / 2 + noise1(t * 0.35, 4) * 7;
    let zoom = this.baseZoom(t);
    // pin excursion
    const w = this.pinShot(t);
    if (w > 0) {
      const m = this.msgs[this.pinMsg]!;
      const py = m.y + m.h * 0.55, px = CONVO.colX + CONVO.colW * 0.66;
      y = y + (py - y) * w;
      x = x + (px - x) * w;
      zoom *= 1 + 0.42 * w;
    }
    // pulses: a hair of zoom on every beat, more on the stream kicks
    zoom *= 1 + 0.005 * tl.beatPulse(t, 0.07) + 0.02 * tl.pulseAt(t, this.scrolls, 0.08);
    return { x, y: y + noise1(t * 0.3, 8) * 4, zoom, rot: noise1(t * 0.21, 12) * 0.004 };
  }

  /** Draw the messages visible under `cam` (world transform must already be applied). */
  drawMessages(c: CanvasRenderingContext2D, t: number, cam: Cam, alpha = 1) {
    const { tl } = this.ctx;
    const halfH = H / 2 / cam.zoom + 80;
    const hair = 1 / cam.zoom;
    for (const m of this.msgs) {
      if (t < m.t0) continue;
      if (m.y + m.h < cam.y - halfH || m.y > cam.y + halfH) continue;
      drawMessage(c, m, CONVO.colX, m.y, CONVO.colW, t, tl, CONVO.size, { hair, alpha, enter: m.t0 < 0 ? 0 : m.t0 >= this.tStream ? 0.12 : 0.28 });
    }
    // column rules (world space), drawn on from the top at s03's second beat
    const b2 = tl.timeOfBeat(Math.round(tl.beat(this.tStart)) + 1);
    const k = prog(t, b2, b2 + 0.5, ease.outExpo);
    if (k > 0) {
      c.save();
      c.fillStyle = rgba('bone', 0.08 * alpha);
      const y0 = cam.y - halfH, len = 2 * halfH * k;
      c.fillRect(CONVO.colX - 90, y0, hair, len);
      c.fillRect(CONVO.colX + CONVO.colW + 60, y0, hair, len);
      // tick marks every 100 world px on the left rule (a ruler for the scroll)
      c.fillStyle = rgba('bone', 0.16 * alpha);
      const step = 100;
      for (let yy = Math.ceil(y0 / step) * step; yy < y0 + len; yy += step) c.fillRect(CONVO.colX - 90, yy, (yy / step) % 5 === 0 ? 14 : 7, hair);
      c.restore();
    }
  }

  /** The system message's text origin in screen px at time t (fold target for s02). */
  systemTarget(t: number) {
    const m = this.msgs[0]!;
    const { pad, label } = chatMetrics(CONVO.size);
    const cam = this.cam(t);
    const p = toScreen(cam, CONVO.colX + pad, m.y + label + pad * 0.6 + CONVO.size);
    return { x: p.x, y: p.y, w: m.text.length * monoAdv(CONVO.size) * cam.zoom, size: CONVO.size * cam.zoom };
  }

  /** Screen-space chrome: header (+ context meter) and the input box. `build` times come from s03's first bar. */
  drawChrome(c: CanvasRenderingContext2D, t: number, alpha = 1) {
    const { tl } = this.ctx;
    const b = (i: number) => tl.timeOfBeat(Math.round(tl.beat(this.tStart)) + i);
    const hb = prog(t, b(0), b(0) + 0.35, ease.outExpo);
    const ib = prog(t, b(2), b(2) + 0.3, ease.outExpo);
    const mb = prog(t, b(3), b(3) + 0.4, ease.outExpo);
    const H0 = CONVO.header;
    c.save();
    c.globalAlpha *= alpha;
    // header plate so scrolled messages pass under it
    c.fillStyle = rgba('ink', 0.94 * hb);
    c.fillRect(H0.x - 40, 0, H0.w + 80, H0.y + H0.h);
    if (hb > 0) drawHeader(c, H0.x, H0.y, H0.w, H0.h, CONVO.size, 'context window · chat 01', hb);
    if (hb > 0) {
      c.font = font(F.mono(400), 15);
      c.fillStyle = rgba('ash', 0.6 * hb);
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      c.fillText('assistant · 200K ctx · temp 0.7', H0.x + H0.w, H0.y + H0.h / 2);
      c.textAlign = 'left';
    }
    // context meter: tokens used / 200,000
    if (mb > 0) {
      const v = this.counter.state(t).value;
      const f = clamp((Number.isFinite(v) ? v : 0) / 200000);
      const mx = H0.x, my = H0.y + H0.h + 6, mw = H0.w * mb;
      c.fillStyle = rgba('bone', 0.1);
      c.fillRect(mx, my, mw, 3);
      c.fillStyle = rgba('signal', 0.95);
      c.fillRect(mx, my, Math.max(2, mw * f), 3);
      for (let i = 1; i < 10; i++) { c.fillStyle = rgba('ink', 1); c.fillRect(mx + (mw * i) / 10, my, 2, 3); }
    }
    // input box plate + box, slides up
    const I = CONVO.input;
    const slide = (1 - ib) * 60;
    c.fillStyle = rgba('ink', 0.94 * ib);
    c.fillRect(I.x - 40, I.y - 24 + slide, I.w + 80, H - I.y + 24);
    if (ib > 0) {
      const cur = this.inputAt(t);
      const sendK = cur.last ? Math.pow(0.5, Math.max(0, t - cur.last.sentAt) / 0.1) * (t >= cur.last.sentAt ? 1 : 0) : 0;
      drawInput(c, I.x, I.y + slide, I.w, I.h, t, tl, cur.inp ? { words: cur.inp.words, sentAt: cur.inp.sentAt } : {}, { size: I.size, build: ib, send: sendK });
    }
    c.restore();
  }

  /** The input line being typed at t, and the last one sent. */
  inputAt(t: number) {
    let inp: (typeof this.inputs)[number] | null = null, last: (typeof this.inputs)[number] | null = null;
    for (const x of this.inputs) {
      if (x.sentAt <= t) last = x;
      if (x.words[0]!.start - 0.05 <= t && t < x.sentAt) inp = x;
    }
    return { inp, last };
  }

  // ------------------------------------------------------------------ the SCROLL ribbon

  /** Row position P(t): the index of the ribbon row at the centre (springs, one per sung scroll). */
  ribbonP(t: number, extra: number[] = []) {
    let p = 0;
    const all = [...this.scrolls.slice(1), ...extra];
    for (const s of all) if (t >= s) p += springStep(t - s, 3.3, 0.5);
    return p;
  }

  /**
   * Giant "SCROLL-" words, the newest at the frame centre. `extraRows` are extra row times (s04 adds
   * the "Watch…" and "LONG" rows) — they push the ribbon but are drawn by the caller at rowY(k).
   */
  drawRibbon(c: CanvasRenderingContext2D, t: number, extraRows: number[] = [], alpha = 1) {
    if (t < this.scrolls[0]! - 0.02) return;
    const P = this.ribbonP(t, extraRows);
    const size = 190, rowH = 205;
    c.save();
    c.globalAlpha *= alpha;
    c.font = font(F.display(900), size);
    c.textBaseline = 'alphabetic';
    this.scrolls.forEach((st, k) => {
      if (t < st) return;
      const d = k - P; // 0 = centre row, negative = above
      if (d < -3.2) return;
      const words = this.ctx.lyrics.findWords('scroll').filter((w) => Math.abs(w.start - st) < 1e-6);
      const w = words[0]!;
      const txt = plain(w.w).toUpperCase().replace('-', '—');
      const tw = measure(txt, F.display(900), size);
      const side = k % 2 === 0 ? -1 : 1;
      const x = W / 2 - tw / 2 + side * 150;
      const y = H / 2 + size * 0.36 + d * rowH;
      const age = t - st;
      const slam = 1 + 0.35 * Math.pow(0.5, age / 0.045);
      const fl = Math.pow(0.5, age / 0.07);
      const fade = clamp(1 + d / 3.2) * (d > 0.5 ? clamp(1.5 - d) : 1);
      c.save();
      c.translate(x + tw / 2, y - size * 0.36);
      c.scale(slam, slam);
      c.globalAlpha *= fade;
      c.fillStyle = fl > 0.2 ? mixRGBA('signal', 'signalHot', fl) : rgba('signal', 1);
      c.fillText(txt, -tw / 2, size * 0.36);
      c.restore();
    });
    c.restore();
  }

  /** Screen y (baseline centre line) of ribbon row k (0 = first scroll) at P. */
  rowY(k: number, P: number) { return H / 2 + (k - P) * 205; }
}
