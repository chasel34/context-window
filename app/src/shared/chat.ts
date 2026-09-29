// Chat UI (BEATSHEET scenes 3, 4, 7, 16 share it). Two levels:
//   - primitives: measureMessage / drawMessage (one message: role label, bubble, typed or lyric-timed
//     text with token brackets, pin, strike-through, custom card body), drawInput (the prompt box),
//     drawPin, drawReturnKey. Scenes with their own camera/layout (s03/s04/s16) use these.
//   - drawChat(c, messages, t, tl, opts): a whole panel (header, clipped message column, input box,
//     scroll) for scenes that just want a chat.
// Pure functions of t: pass the messages with their times. Plex Mono is monospaced, so text is laid
// out on a character grid (x = column × advance).
import type { Timeline } from '../timeline';
import { F, font } from '../engine/type';
import { rgba, mixRGBA } from '../engine/palette';
import { clamp, ease, hash, prog } from '../engine/util';
import { drawCursor } from './cursor';

export type Role = 'system' | 'user' | 'assistant';

/** A lyric-timed word: appears when sung, highlighted while sung (signal), cools to bone after. */
export interface ChatWord {
  text: string;
  start: number;
  end: number;
  /** Small tag drawn under the word's token bracket (e.g. 'name'). */
  tag?: string;
}

export interface ChatMessage {
  role: Role;
  text: string;
  /** Time the message appears (song s). */
  t0: number;
  /** Typing duration (s): characters are revealed over [t0, t0 + typeDur]. 0 = appears whole. */
  typeDur?: number;
  /** Lyric-timed text (overrides text/typeDur for the reveal; text should equal the words joined by ' '). */
  words?: ChatWord[];
  /** Pinned (magenta pushpin at the top-right corner of the bubble), from this time on. */
  pinnedAt?: number;
  /** Strike-through progress 0..1 (truncate). */
  strike?: number;
  /** Extra opacity. */
  alpha?: number;
  /** Message index shown in the gutter ('#07'). */
  id?: number;
  /** Timestamp next to the role label. */
  stamp?: string;
  /** Token brackets (hairline + fake token id) under each word. Default: on for lyric-timed messages. */
  tokens?: boolean;
  /** Custom body drawn under the text inside the bubble (e.g. a memory card). */
  card?: { h: number; minW?: number; draw: (c: CanvasRenderingContext2D, x: number, y: number, w: number, t: number) => void };
}

export interface ChatOpts {
  /** Panel rect (logical px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Scroll offset in px (content moves up as it grows). Use `autoScroll` to keep the newest message in view. */
  scroll?: number;
  autoScroll?: boolean;
  /** Header text (top bar). '' hides the header. */
  header?: string;
  /** Input box contents typed over [t0, t0 + typeDur]. */
  input?: { text: string; t0: number; typeDur: number };
  /** Message text size. */
  size?: number;
  /** Draw the panel frame. */
  frame?: boolean;
}

export interface ChatLayout {
  /** Message boxes in canvas px (after scrolling). */
  rects: { msg: ChatMessage; x: number; y: number; w: number; h: number; shown: string }[];
  /** Total content height (px) and the scroll actually used. */
  contentH: number;
  scroll: number;
}

// ------------------------------------------------------------------------------------ metrics

/** Spacing derived from the text size (the same numbers drawChat has always used). */
export function chatMetrics(size: number) {
  return { pad: size * 0.8, gap: size * 0.9, lh: size * 1.4, label: size * 0.7 };
}

const advCache = new Map<number, number>();
let mc: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!mc) mc = document.createElement('canvas').getContext('2d')!;
  return mc;
}
/** Lyric words joined into display text (no space after a stutter like 'Scroll-'), with char ranges. */
export function joinWords(ws: ChatWord[]) {
  let text = '';
  const ranges: [number, number][] = [];
  ws.forEach((w, i) => {
    const i0 = text.length;
    text += w.text;
    ranges.push([i0, text.length]);
    if (i < ws.length - 1 && !w.text.endsWith('-')) text += ' ';
  });
  return { text, ranges };
}

/** Advance of one Plex Mono cell at `size` px. */
export function monoAdv(size: number) {
  let a = advCache.get(size);
  if (a === undefined) {
    const c = measureCtx();
    c.font = font(F.mono(400), size);
    a = c.measureText('M').width;
    advCache.set(size, a);
  }
  return a;
}

/** Greedy word wrap on the mono grid: rows of { text, i0 (char index of the row start in text) }. */
function wrapMono(text: string, maxCols: number): { text: string; i0: number }[] {
  const out: { text: string; i0: number }[] = [];
  let base = 0;
  for (const para of text.split('\n')) {
    let row = '', rowStart = base, i = base;
    for (const word of para.split(' ')) {
      const tryL = row ? row + ' ' + word : word;
      if (tryL.length > maxCols && row) { out.push({ text: row, i0: rowStart }); row = word; rowStart = i; } else row = tryL;
      i += word.length + 1;
    }
    out.push({ text: row, i0: rowStart });
    base += para.length + 1;
  }
  return out;
}

export interface MessageMeasure {
  rows: { text: string; i0: number }[];
  /** Bubble width / height, and the full block height (label row + bubble). */
  bw: number;
  bh: number;
  h: number;
  /** Char ranges of the lyric words in the text. */
  wordRanges: [number, number][];
}

const measureCache = new WeakMap<ChatMessage, { key: string; m: MessageMeasure }>();

/** Layout of one message for a column of width colW (bubbles take at most `maxFrac` of it). */
export function measureMessage(m: ChatMessage, colW: number, size: number, maxFrac = 0.72): MessageMeasure {
  const key = `${colW}|${size}|${maxFrac}|${m.text}`;
  const hit = measureCache.get(m);
  if (hit && hit.key === key) return hit.m;
  const { pad, lh, label } = chatMetrics(size);
  const adv = monoAdv(size);
  const joined = m.words ? joinWords(m.words) : null;
  const text = joined ? joined.text : m.text;
  const maxCols = Math.max(4, Math.floor((colW * maxFrac - pad * 2) / adv));
  const rows = wrapMono(text, maxCols);
  const cols = Math.max(...rows.map((r) => r.text.length));
  const bw = Math.max(m.card?.minW ?? 0, Math.min(colW * maxFrac, cols * adv + pad * 2));
  const tokExtra = (m.tokens ?? !!m.words) ? size * 0.42 : 0;
  const bh = rows.length * lh + pad * 1.2 + tokExtra + (m.card ? m.card.h + pad * 0.6 : 0);
  const wordRanges: [number, number][] = joined ? joined.ranges : [];
  const out = { rows, bw, bh, h: bh + label, wordRanges };
  measureCache.set(m, { key, m: out });
  return out;
}

// ------------------------------------------------------------------------------------ typing

/** Characters of `text` revealed at t for a message typed over [t0, t0+dur]. */
export function typed(text: string, t: number, t0: number, dur: number) {
  if (t < t0) return '';
  if (dur <= 0) return text;
  const n = Math.floor(Array.from(text).length * clamp((t - t0) / dur));
  return Array.from(text).slice(0, n).join('');
}

/** Chars of a lyric word revealed at t (a fast burst at the word's start, never longer than the word). */
export function wordChars(w: ChatWord, t: number) {
  if (t < w.start) return 0;
  const dur = Math.min(0.14, Math.max(0.04, (w.end - w.start) * 0.6));
  return Math.ceil(w.text.length * clamp((t - w.start) / dur));
}

/** Colour of a lyric word at t: hot flash on its start, signal while sung, cooling to bone after. */
export function wordColor(w: ChatWord, t: number, cool = 0.35, alpha = 1): string {
  if (t < w.end) {
    const flash = Math.pow(0.5, (t - w.start) / 0.05);
    return flash > 0.3 ? mixRGBA('signal', 'signalHot', clamp((flash - 0.3) * 1.4), alpha) : rgba('signal', alpha);
  }
  const k = prog(t, w.end, w.end + cool, ease.inOutQuad);
  return mixRGBA('signal', 'bone', k, alpha * (0.92 + 0.08 * (1 - k)));
}

/** Fake token id for a word (stable). */
const tokId = (s: string, i: number) => 100 + Math.floor(hash(s.length, i, s.charCodeAt(0) || 0) * 49000);

// ------------------------------------------------------------------------------------ pin

/**
 * A magenta pushpin, head centred at (x, y), `s` ≈ head radius. `k` 0..1 = landing progress (drops in
 * from above-right, squashes, settles); `ring` 0..1 = the impact ring.
 */
export function drawPin(c: CanvasRenderingContext2D, x: number, y: number, s: number, k: number, ring = 0) {
  if (k <= 0) return;
  c.save();
  const drop = 1 - ease.outExpo(clamp(k * 2.2));
  const squash = k < 0.45 ? 1 : 1 + 0.18 * Math.sin((k - 0.45) / 0.55 * Math.PI) * (1 - k);
  c.translate(x + drop * s * 3, y - drop * s * 5);
  c.globalAlpha *= clamp(k * 6);
  // impact ring
  if (ring > 0 && ring < 1) {
    c.strokeStyle = rgba('signal', 0.8 * (1 - ring));
    c.lineWidth = s * 0.12 * (1 - ring) + 0.6;
    c.beginPath(); c.arc(0, s * 0.9, s * (1.2 + 4.5 * ease.outCubic(ring)), 0, Math.PI * 2); c.stroke();
  }
  c.rotate(0.38);
  // needle
  c.strokeStyle = rgba('ash', 0.95);
  c.lineWidth = Math.max(1, s * 0.13);
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(0, s * 0.5); c.lineTo(0, s * 2.1); c.stroke();
  // collar + head (a flat-top pushpin)
  c.scale(1 / squash, squash);
  c.fillStyle = rgba('signalDeep', 1);
  c.fillRect(-s * 0.62, s * 0.18, s * 1.24, s * 0.34);
  c.fillStyle = rgba('signal', 1);
  c.beginPath(); c.ellipse(0, -s * 0.1, s * 0.78, s * 0.62, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(-s * 0.36, -s * 0.1, s * 0.72, s * 0.45);
  c.fillStyle = rgba('signalHot', 0.9);
  c.beginPath(); c.ellipse(-s * 0.26, -s * 0.34, s * 0.22, s * 0.13, -0.5, 0, Math.PI * 2); c.fill();
  c.restore();
}

/** The ⏎ glyph (not in Plex Mono), drawn as strokes centred at (x, y), half-size a. */
export function drawReturnKey(c: CanvasRenderingContext2D, x: number, y: number, a: number, color: string, lw = 2) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = lw;
  c.lineCap = 'square'; c.lineJoin = 'miter';
  c.beginPath();
  c.moveTo(x + a, y - a); c.lineTo(x + a, y + a * 0.25); c.lineTo(x - a, y + a * 0.25);
  c.moveTo(x - a + a * 0.45, y + a * 0.25 - a * 0.45); c.lineTo(x - a, y + a * 0.25); c.lineTo(x - a + a * 0.45, y + a * 0.25 + a * 0.45);
  c.stroke();
  c.restore();
}

// ------------------------------------------------------------------------------------ one message

export interface DrawMessageOpts {
  /** Bubble max width as a fraction of the column (default 0.72). */
  maxFrac?: number;
  /** Extra alpha. */
  alpha?: number;
  /** Line width of hairlines (1/zoom under a camera). */
  hair?: number;
  /** Draw the gutter id and stamp (default true when set on the message). */
  meta?: boolean;
  /** Entry animation length (s), 0 = none. */
  enter?: number;
}

export interface DrawnMessage {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bubble top (y of the bubble rect) and height. */
  top: number;
  bh: number;
  shown: string;
  caret: { x: number; y: number };
  /** Where the pin sits (head centre). */
  pin: { x: number; y: number };
}

/**
 * Draw one message whose block (label row + bubble) starts at (colX, y) in a column of width colW.
 * User bubbles hug the right edge, system/assistant the left.
 */
export function drawMessage(c: CanvasRenderingContext2D, m: ChatMessage, colX: number, y: number, colW: number, t: number, tl: Timeline, size: number, o: DrawMessageOpts = {}): DrawnMessage {
  const me = measureMessage(m, colW, size, o.maxFrac);
  const { pad, lh, label } = chatMetrics(size);
  const adv = monoAdv(size);
  const hair = o.hair ?? 1;
  const right = m.role === 'user';
  const bx = right ? colX + colW - me.bw : colX;
  const enter = o.enter ?? 0.2;
  const a = (m.alpha ?? 1) * (o.alpha ?? 1) * (enter > 0 ? prog(t, m.t0, m.t0 + enter * 0.5) : 1);
  const rise = enter > 0 ? (1 - prog(t, m.t0, m.t0 + enter, ease.outExpo)) * size * 0.9 : 0;
  const by = y + rise;
  const top = by + label;
  const bh = me.bh;
  c.save();
  c.globalAlpha *= a;
  c.textBaseline = 'alphabetic';
  // ---- label row: ROLE · stamp · n tok   (and the gutter id)
  const ls = size * 0.4;
  c.font = font(F.mono(500), ls);
  c.letterSpacing = `${ls * 0.18}px`;
  const role = m.role.toUpperCase();
  const pinned = m.pinnedAt !== undefined && t >= m.pinnedAt;
  const lx = right ? bx + me.bw : bx;
  c.textAlign = right ? 'right' : 'left';
  c.fillStyle = m.role === 'system' ? rgba('signal', 0.95) : rgba('bone', 0.55);
  c.fillText(role, lx, by + label * 0.62);
  const rw = c.measureText(role).width;
  c.letterSpacing = '0px';
  c.font = font(F.mono(400), ls);
  const ntok = m.words ? m.words.length : Math.max(1, Math.round(m.text.length / 4));
  const meta = `${m.stamp ? m.stamp + '  ·  ' : ''}${ntok} tok`;
  c.fillStyle = rgba('ash', 0.55);
  if (right) c.fillText(meta, lx - rw - ls * 1.4, by + label * 0.62);
  else c.fillText(meta, lx + rw + ls * 1.4, by + label * 0.62);
  if (pinned) {
    const pk = prog(t, m.pinnedAt!, m.pinnedAt! + 0.18, ease.outExpo);
    c.font = font(F.mono(600), ls);
    c.letterSpacing = `${ls * 0.18}px`;
    const mw = c.measureText(meta).width + ls * 1.4;
    const px = right ? lx - rw - ls * 1.4 - mw - ls * 1.2 : lx + rw + ls * 1.4 + mw + ls * 1.2;
    c.fillStyle = rgba('signal', pk);
    c.fillText('PINNED', px, by + label * 0.62);
    c.letterSpacing = '0px';
  }
  c.textAlign = 'left';
  if ((o.meta ?? true) && m.id !== undefined) {
    c.font = font(F.mono(400), ls);
    c.fillStyle = rgba('graphite', 0.9);
    c.textAlign = 'right';
    c.fillText(`#${String(m.id).padStart(2, '0')}`, colX - size * 0.9, top + pad * 0.6 + size * 0.8);
    c.textAlign = 'left';
  }
  // ---- bubble
  if (m.role === 'user') {
    c.fillStyle = rgba('bone', 0.075);
    c.fillRect(bx, top, me.bw, bh);
    c.strokeStyle = rgba('bone', 0.2);
    c.lineWidth = hair;
    c.strokeRect(bx + hair / 2, top + hair / 2, me.bw - hair, bh - hair);
  } else if (m.role === 'system') {
    c.fillStyle = rgba('ink2', 1);
    c.fillRect(bx, top, me.bw, bh);
    c.fillStyle = rgba('signal', 0.9);
    c.fillRect(bx, top, Math.max(3, hair * 3), bh);
  } else {
    c.fillStyle = rgba('bone', 0.3);
    c.fillRect(bx, top, Math.max(2, hair * 2), bh);
  }
  if (pinned) {
    const pk = prog(t, m.pinnedAt!, m.pinnedAt! + 0.12);
    c.strokeStyle = rgba('signal', 0.9 * pk);
    c.lineWidth = Math.max(1.5, hair * 1.5);
    c.strokeRect(bx - 3, top - 3, me.bw + 6, bh + 6);
  }
  // ---- text
  c.font = font(F.mono(400), size);
  const tx = bx + pad;
  const base0 = top + pad * 0.6 + size;
  let caret = { x: tx, y: base0 };
  let shown = '';
  const tokens = m.tokens ?? !!m.words;
  if (m.words) {
    // lyric-timed: word by word, highlighted while sung
    m.words.forEach((w, wi) => {
      const n = wordChars(w, t);
      if (n <= 0) return;
      const [i0] = me.wordRanges[wi]!;
      const row = rowOf(me.rows, i0);
      const col = i0 - me.rows[row]!.i0;
      const wx = tx + col * adv, wy = base0 + row * lh;
      const drop = (1 - ease.outExpo(clamp((t - w.start) / 0.16))) * -size * 0.3;
      c.fillStyle = wordColor(w, t);
      c.fillText(w.text.slice(0, n), wx, wy + drop);
      caret = { x: wx + n * adv, y: wy };
      shown += (shown ? ' ' : '') + w.text.slice(0, n);
      if (tokens) drawToken(c, wx, wy, w.text.length * adv, size, t, w, tokId(w.text, wi), hair);
    });
  } else {
    shown = typed(m.text, t, m.t0, m.typeDur ?? 0);
    let left = shown.length;
    c.fillStyle = rgba('bone', 0.92);
    me.rows.forEach((r, i) => {
      if (left <= 0) return;
      const part = r.text.slice(0, left);
      const ly = base0 + i * lh;
      c.fillText(part, tx, ly);
      caret = { x: tx + part.length * adv, y: ly };
      left -= r.text.length + 1;
    });
    if (tokens) {
      // brackets under the typed words (no timing: all settled)
      let ci = 0;
      m.text.split(' ').forEach((wd, wi) => {
        const row = rowOf(me.rows, ci), col = ci - me.rows[row]!.i0;
        if (ci + wd.length <= shown.length) drawToken(c, tx + col * adv, base0 + row * lh, wd.length * adv, size, t, null, tokId(wd, wi), hair);
        ci += wd.length + 1;
      });
    }
  }
  const typing = !m.words && t < m.t0 + (m.typeDur ?? 0);
  if (typing) drawCursor(c, caret.x + 2, caret.y, size, t, tl, { on: true });
  // ---- strike-through
  if (m.strike && m.strike > 0) {
    c.fillStyle = rgba('signal', 0.95);
    me.rows.forEach((r, i) => {
      const lw = r.text.length * adv * clamp(m.strike! * me.rows.length - i);
      if (lw > 0) c.fillRect(tx, base0 + i * lh - size * 0.32, lw, Math.max(2, size * 0.08));
    });
  }
  // ---- card body
  if (m.card) m.card.draw(c, tx, base0 + (me.rows.length - 1) * lh + (tokens ? size * 0.42 : 0) + pad * 0.9, me.bw - pad * 2, t);
  const pin = { x: bx + me.bw - size * 0.15, y: top - size * 0.05 };
  if (pinned) {
    const k = prog(t, m.pinnedAt!, m.pinnedAt! + 0.45);
    drawPin(c, pin.x, pin.y, size * 0.72, k, prog(t, m.pinnedAt! + 0.1, m.pinnedAt! + 0.6));
  }
  c.restore();
  return { x: bx, y: by, w: me.bw, h: me.h, top, bh, shown, caret, pin };
}

function rowOf(rows: { i0: number }[], i: number) {
  let k = 0;
  for (let j = 0; j < rows.length; j++) if (rows[j]!.i0 <= i) k = j;
  return k;
}

/** Token bracket under a word: hairline with end ticks, a tiny id, and the karaoke bar while sung. */
function drawToken(c: CanvasRenderingContext2D, x: number, base: number, w: number, size: number, t: number, word: ChatWord | null, id: number, hair: number) {
  const y = base + size * 0.26;
  c.save();
  c.fillStyle = rgba('bone', 0.28);
  c.fillRect(x, y, w, hair);
  c.fillRect(x, y - size * 0.12, hair, size * 0.12);
  c.fillRect(x + w - hair, y - size * 0.12, hair, size * 0.12);
  c.font = font(F.mono(400), size * 0.3);
  c.fillStyle = rgba('ash', 0.55);
  c.fillText(String(id), x + size * 0.05, y + size * 0.36);
  if (word) {
    if (word.tag) {
      const tk = prog(t, word.start, word.start + 0.15, ease.outExpo);
      c.font = font(F.mono(600), size * 0.3);
      c.letterSpacing = `${size * 0.04}px`;
      const tw = c.measureText(word.tag.toUpperCase()).width + size * 0.3;
      const tx = x + w - tw;
      c.fillStyle = rgba('signal', 0.95 * tk);
      c.fillRect(tx, y + size * 0.1, tw, size * 0.36);
      c.fillStyle = rgba('ink', tk);
      c.fillText(word.tag.toUpperCase(), tx + size * 0.15, y + size * 0.37);
      c.letterSpacing = '0px';
    }
    const p = word.end > word.start ? clamp((t - word.start) / (word.end - word.start)) : 1;
    const done = prog(t, word.end, word.end + 0.4);
    if (t >= word.start && done < 1) {
      c.fillStyle = rgba('signal', 1 - done);
      c.fillRect(x, y - 1, w * p, Math.max(2, size * 0.07));
    }
  }
  c.restore();
}

// ------------------------------------------------------------------------------------ input box

export interface InputContent {
  /** Plain typed text over [t0, t0 + typeDur]… */
  text?: string;
  t0?: number;
  typeDur?: number;
  /** …or lyric-timed words. */
  words?: ChatWord[];
  /** Characters deleted from the end (backspace), 0..len. */
  erased?: number;
  /** Text vanishes (sent) at this time. */
  sentAt?: number;
}

export interface InputOpts {
  size?: number;
  placeholder?: string;
  hair?: number;
  /** 0..1 how "built" the box is (outline draw-on). */
  build?: number;
  /** Cursor style overrides; `show: false` hides it. */
  cursor?: { show?: boolean; on?: boolean; alpha?: number };
  /** ⏎ key lit amount 0..1. */
  send?: number;
  alpha?: number;
  /** Draw the box, prompt glyph and ⏎ key (default true); false draws only the text and cursor. */
  frame?: boolean;
}

/** The prompt box at (x, y, w, h). Returns the caret position (cursor left edge, baseline) and size. */
export function drawInput(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, tl: Timeline, inp: InputContent, o: InputOpts = {}) {
  const size = o.size ?? 30;
  const hair = o.hair ?? 1;
  const adv = monoAdv(size);
  const build = o.build ?? 1;
  const frame = o.frame !== false;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  if (frame) {
  // outline, drawn on from the left
  c.fillStyle = rgba('ink2', 0.92 * build);
  c.fillRect(x, y, w * build, h);
  c.strokeStyle = rgba('bone', 0.3);
  c.lineWidth = hair;
  c.beginPath();
  c.moveTo(x, y + hair / 2); c.lineTo(x + w * build, y + hair / 2);
  c.moveTo(x, y + h - hair / 2); c.lineTo(x + w * build, y + h - hair / 2);
  c.moveTo(x + hair / 2, y); c.lineTo(x + hair / 2, y + h);
  if (build >= 1) { c.moveTo(x + w - hair / 2, y); c.lineTo(x + w - hair / 2, y + h); }
  c.stroke();
  // corner ticks
  c.strokeStyle = rgba('bone', 0.6 * build);
  c.beginPath();
  const tk = size * 0.45;
  for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]] as const) {
    c.moveTo(cx + sx * 5, cy); c.lineTo(cx + sx * (5 + tk), cy);
    c.moveTo(cx, cy + sy * 5); c.lineTo(cx, cy + sy * (5 + tk));
  }
  c.stroke();
  }
  // prompt glyph ›
  const base = y + h / 2 + size * 0.34;
  c.font = font(F.mono(400), size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = rgba('ash', 0.7 * build);
  const px = x + size * 0.7;
  if (frame) c.fillText('›', px, base);
  const tx = px + adv * 1.6;
  // text
  const sent = inp.sentAt !== undefined && t >= inp.sentAt;
  let caretX = tx;
  let count = 0;
  if (!sent) {
    if (inp.words) {
      const { ranges } = joinWords(inp.words);
      inp.words.forEach((wd, wi) => {
        const n = wordChars(wd, t);
        const col = ranges[wi]![0];
        if (n > 0) {
          c.fillStyle = wordColor(wd, t);
          const drop = (1 - ease.outExpo(clamp((t - wd.start) / 0.16))) * -size * 0.3;
          c.fillText(wd.text.slice(0, n), tx + col * adv, base + drop);
          caretX = tx + (col + n) * adv;
          count += n;
        }
      });
    } else if (inp.text !== undefined) {
      let s = typed(inp.text, t, inp.t0 ?? 0, inp.typeDur ?? 0);
      if (inp.erased) s = s.slice(0, Math.max(0, s.length - Math.floor(inp.erased)));
      if (s) { c.fillStyle = rgba('bone', 0.92); c.fillText(s, tx, base); }
      caretX = tx + s.length * adv;
      count = s.length;
    }
  }
  if (count === 0 && o.placeholder !== '') {
    c.fillStyle = rgba('bone', 0.26 * build);
    c.fillText(o.placeholder ?? 'Message…', tx + adv * 0.9, base);
  }
  // ⏎ key
  const ks = h * 0.3, kx = x + w - h * 0.5, ky = y + h / 2;
  const lit = clamp(o.send ?? 0);
  if (frame) {
  if (lit > 0) { c.fillStyle = rgba('signal', lit); c.fillRect(kx - ks, ky - ks, ks * 2, ks * 2); }
  c.strokeStyle = lit > 0.5 ? rgba('signal', 1) : rgba('bone', 0.4 * build);
  c.lineWidth = hair;
  c.strokeRect(kx - ks, ky - ks, ks * 2, ks * 2);
  drawReturnKey(c, kx, ky, ks * 0.42, lit > 0.5 ? rgba('ink', 1) : rgba('bone', 0.75 * build), Math.max(1.5, hair * 1.6));
  }
  // cursor
  const cur = o.cursor ?? {};
  const typing = inp.words ? inp.words.some((wd) => t >= wd.start && t < wd.end + 0.05) : inp.t0 !== undefined && t >= inp.t0 && t < inp.t0 + (inp.typeDur ?? 0);
  if (cur.show !== false && build > 0.5) drawCursor(c, caretX + 2, base, size, t, tl, { on: cur.on ?? (typing ? true : undefined), alpha: cur.alpha });
  c.restore();
  return { x: caretX + 2, y: base, size };
}

// ------------------------------------------------------------------------------------ whole panel

export function drawChat(c: CanvasRenderingContext2D, msgs: ChatMessage[], t: number, tl: Timeline, o: ChatOpts): ChatLayout {
  const size = o.size ?? 28;
  const { pad, gap } = chatMetrics(size);
  const headerH = o.header === '' ? 0 : size * 2.2;
  const inputH = o.input ? size * 2.6 : 0;
  const bodyTop = o.y + headerH, bodyH = o.h - headerH - inputH;
  const colX = o.x + pad, colW = o.w - pad * 2;
  c.save();
  // frame
  if (o.frame !== false) {
    c.fillStyle = rgba('ink2', 1);
    c.fillRect(o.x, o.y, o.w, o.h);
    c.strokeStyle = rgba('bone', 0.14);
    c.lineWidth = 1;
    c.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
  }
  if (headerH) drawHeader(c, o.x, o.y, o.w, headerH, size, o.header ?? 'CONTEXT WINDOW');
  // layout messages (only those that have appeared)
  const vis = msgs.filter((m) => t >= m.t0);
  let contentH = 0;
  for (const m of vis) contentH += measureMessage(m, colW, size).h + gap;
  let scroll = o.scroll ?? 0;
  if (o.autoScroll) scroll = Math.max(0, contentH - bodyH + gap);
  c.beginPath();
  c.rect(o.x, bodyTop, o.w, bodyH);
  c.clip();
  let yy = bodyTop + gap - scroll;
  const rects: ChatLayout['rects'] = [];
  for (const m of vis) {
    const me = measureMessage(m, colW, size);
    if (yy + me.h > bodyTop - 40 && yy < bodyTop + bodyH + 40) {
      const d = drawMessage(c, m, colX, yy, colW, t, tl, size, { meta: false });
      rects.push({ msg: m, x: d.x, y: d.top, w: d.w, h: d.bh, shown: d.shown });
    } else {
      rects.push({ msg: m, x: m.role === 'user' ? colX + colW - me.bw : colX, y: yy + chatMetrics(size).label, w: me.bw, h: me.bh, shown: m.text });
    }
    yy += me.h + gap;
  }
  c.restore();
  // input box
  if (o.input) {
    const iy = o.y + o.h - inputH;
    c.save();
    c.fillStyle = rgba('bone', 0.12);
    c.fillRect(o.x, iy, o.w, 1);
    c.restore();
    drawInput(c, o.x + pad, iy + inputH * 0.18, o.w - pad * 2, inputH * 0.64, t, tl, { text: o.input.text, t0: o.input.t0, typeDur: o.input.typeDur }, { size: size * 0.9 });
  }
  return { rects, contentH, scroll };
}

/** Panel header: a dot, the title (letterspaced mono), a hairline under it. */
export function drawHeader(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size: number, title: string, build = 1) {
  c.save();
  const ls = size * 0.46;
  c.font = font(F.mono(500), ls);
  c.letterSpacing = `${ls * 0.2}px`;
  c.textBaseline = 'middle';
  c.fillStyle = rgba('signal', build);
  c.beginPath(); c.arc(x + size * 0.8, y + h / 2, ls * 0.28, 0, Math.PI * 2); c.fill();
  c.fillStyle = rgba('bone', 0.6 * build);
  c.fillText(title.toUpperCase(), x + size * 0.8 + ls * 1.1, y + h / 2);
  c.letterSpacing = '0px';
  c.fillStyle = rgba('bone', 0.14);
  c.fillRect(x + w / 2 - (w / 2) * build, y + h - 1, w * build, 1);
  c.restore();
}
