// Lyric renderer: sets a lyric line in Unbounded (by default) and turns each word signal magenta
// once it is sung (BEATSHEET: "唱到哪个词，哪个词从骨白变成洋红"). Kerning-correct: the line is laid out
// as one run and the coloured pieces are drawn at glyphX offsets.
import type { Line } from '../engine/lyrics';
import { Timeline, type WordState } from '../timeline';
import { F, font, glyphX, measure } from '../engine/type';
import { rgba } from '../engine/palette';

export interface LyricStyle {
  family?: string;
  size?: number;
  /** Extra letter spacing (px). */
  tracking?: number;
  /** Colour of words not yet sung / being sung / already sung (palette key or '#hex'). */
  base?: string;
  active?: string;
  sung?: string;
  baseAlpha?: number;
  /** 'word' (default): a word switches colour when it starts; 'wipe': glyphs switch as it is sung. */
  mode?: 'word' | 'wipe';
  align?: 'left' | 'center' | 'right';
  /** Wrap into several rows when wider than this. */
  maxWidth?: number;
  /** Row advance as a multiple of size. */
  lineHeight?: number;
  /** Hide words that haven't started (text appears word by word). */
  revealOnly?: boolean;
}

export interface WordBox {
  state: WordState;
  /** Char range in the displayed line text. */
  i0: number;
  i1: number;
  /** Box in canvas px (baseline y). */
  x: number;
  y: number;
  w: number;
  row: number;
}

export interface LyricLayout {
  text: string;
  rows: { text: string; i0: number; x: number; y: number; w: number }[];
  words: WordBox[];
  /** Right end of the last started word (where a cursor goes). */
  caret: { x: number; y: number };
  width: number;
  height: number;
  /** Font family and size used. */
  family: string;
  size: number;
}

/**
 * Map each word token to its char range in the line text ("Scroll-" in "Scroll-scroll-…", "C-" in
 * "C-C-Context!"); unmatched words (rare) are appended. Cached per line.
 */
const rangeCache = new WeakMap<Line, { text: string; ranges: [number, number][] }>();
export function wordRanges(line: Line) {
  let r = rangeCache.get(line);
  if (r) return r;
  let text = line.text;
  const low = text.toLowerCase();
  const ranges: [number, number][] = [];
  let pos = 0;
  for (const w of line.words) {
    const q = w.w.toLowerCase();
    let i = low.indexOf(q, pos);
    if (i < 0) { const bare = q.replace(/[^\p{L}\p{N}']/gu, ''); i = bare ? low.indexOf(bare, pos) : -1; if (i >= 0) { ranges.push([i, i + bare.length]); pos = i + bare.length; continue; } }
    if (i < 0) { i = text.length + (text.length ? 1 : 0); text = text + (text.length ? ' ' : '') + w.w; }
    ranges.push([i, i + q.length]);
    pos = i + q.length;
  }
  r = { text, ranges };
  rangeCache.set(line, r);
  return r;
}

/** Lay out a line (wrapping at maxWidth) with per-word boxes. (x, y) = anchor on the first baseline. */
export function layoutLyric(line: Line, t: number, x: number, y: number, s: LyricStyle = {}): LyricLayout {
  const family = s.family ?? F.display(900), size = s.size ?? 96, tr = s.tracking ?? 0;
  const { text, ranges } = wordRanges(line);
  // greedy wrap at word boundaries (spaces)
  const rowsIdx: [number, number][] = [];
  if (s.maxWidth) {
    let a = 0;
    while (a < text.length) {
      let b = text.length;
      while (measure(text.slice(a, b).trimEnd(), family, size, tr) > s.maxWidth) {
        const sp = text.lastIndexOf(' ', b - 1);
        if (sp <= a) break;
        b = sp;
      }
      rowsIdx.push([a, b]);
      a = b;
      while (text[a] === ' ') a++;
    }
  } else rowsIdx.push([0, text.length]);
  const lh = size * (s.lineHeight ?? 1.15);
  const rows = rowsIdx.map(([a, b], k) => {
    const rt = text.slice(a, b).trimEnd();
    const w = measure(rt, family, size, tr);
    const rx = s.align === 'center' ? x - w / 2 : s.align === 'right' ? x - w : x;
    return { text: rt, i0: a, x: rx, y: y + k * lh, w };
  });
  const rowOf = (i: number) => { let k = 0; for (let j = 0; j < rows.length; j++) if (rows[j]!.i0 <= i) k = j; return k; };
  const words: WordBox[] = line.words.map((w, wi) => {
    const [i0, i1] = ranges[wi]!;
    const k = rowOf(i0), row = rows[k]!;
    const x0 = row.x + glyphX(row.text, i0 - row.i0, family, size, tr);
    const x1 = row.x + glyphX(row.text, Math.min(row.text.length, i1 - row.i0), family, size, tr);
    return { state: Timeline.wordState(w, t), i0, i1, x: x0, y: row.y, w: x1 - x0, row: k };
  });
  let caret = { x: rows[0]!.x, y: rows[0]!.y };
  for (const wb of words) if (wb.state.on) caret = { x: wb.x + wb.w, y: wb.y };
  return { text, rows, words, caret, width: Math.max(...rows.map((r) => r.w)), height: rows.length * lh, family, size };
}

/**
 * Draw a lyric line at t. Default: Unbounded 900, bone, sung words magenta.
 * Returns the layout (word boxes, caret) so scenes can attach effects or a cursor.
 */
export function drawLyricLine(c: CanvasRenderingContext2D, line: Line, t: number, x: number, y: number, s: LyricStyle = {}): LyricLayout {
  const family = s.family ?? F.display(900), size = s.size ?? 96, tr = s.tracking ?? 0;
  const lay = layoutLyric(line, t, x, y, s);
  const base = rgba(s.base ?? 'bone', s.baseAlpha ?? 1);
  const sung = rgba(s.sung ?? 'signal');
  const active = rgba(s.active ?? s.sung ?? 'signal');
  // per-char colour: chars outside words (spaces, dashes) take the state of the word before them
  const n = lay.text.length;
  const col: (string | null)[] = new Array(n).fill(null);
  let prev: string | null = s.revealOnly ? null : base;
  for (let i = 0, wi = 0; i < n; i++) {
    while (wi < lay.words.length && lay.words[wi]!.i1 <= i) {
      const st = lay.words[wi]!.state; prev = st.on ? (st.phase === 'active' ? active : sung) : s.revealOnly ? null : base; wi++;
    }
    const wb = lay.words.find((w) => i >= w.i0 && i < w.i1);
    if (wb) {
      const st = wb.state;
      if (s.revealOnly && !st.on) { col[i] = null; continue; }
      if (s.mode === 'wipe') {
        const f = st.p * (wb.i1 - wb.i0) - (i - wb.i0);
        col[i] = f >= 1 ? sung : f <= 0 ? base : active;
      } else col[i] = st.on ? (st.phase === 'active' ? active : sung) : base;
    } else col[i] = prev;
  }
  c.save();
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.font = font(family, size);
  c.letterSpacing = `${tr}px`;
  for (const row of lay.rows) {
    let a = 0;
    const L = row.text.length;
    while (a < L) {
      const cc = col[row.i0 + a];
      let b = a + 1;
      while (b < L && col[row.i0 + b] === cc) b++;
      if (cc) {
        c.fillStyle = cc;
        c.fillText(row.text.slice(a, b), row.x + glyphX(row.text, a, family, size, tr), row.y);
      }
      a = b;
    }
  }
  c.restore();
  return lay;
}
