// Small UI drawings shared by s12 (overflow) and s14 (hook3 flash-backs): an app window, the film's one
// error dialog, a mouse pointer, and simplified fragments of earlier scenes (pin, KV cells, bullet list).
// All in logical 1920×1080 px, colours as palette keys.
import { rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { clamp, hash } from '../engine/util';

export interface WinStyle {
  title?: string;
  right?: string;
  /** Fill of the body ('' = none), border and title-bar colours. */
  fill?: string;
  border?: string;
  borderAlpha?: number;
  borderWidth?: number;
  bar?: string;
  barText?: string;
  barH?: number;
  alpha?: number;
}

/** An app window: title bar (three square buttons, centred title) and a border. (x, y) = top-left of the bar. */
export function drawWindow(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o: WinStyle = {}) {
  const bh = o.barH ?? 36;
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  if (o.fill) { c.fillStyle = rgba(o.fill, 1); c.fillRect(x, y + bh, w, h - bh); }
  c.fillStyle = rgba(o.bar ?? 'ink2', 1);
  c.fillRect(x, y, w, bh);
  const bw = o.borderWidth ?? 1.5;
  c.strokeStyle = rgba(o.border ?? 'bone', o.borderAlpha ?? 0.55);
  c.lineWidth = bw;
  c.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);
  c.fillStyle = rgba(o.border ?? 'bone', o.borderAlpha ?? 0.55);
  c.fillRect(x, y + bh - 1, w, 1);
  c.strokeStyle = rgba(o.barText ?? 'bone', 0.7);
  c.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) c.strokeRect(x + 14 + i * 20, y + bh / 2 - 5, 10, 10);
  c.font = font(F.mono(500), Math.round(bh * 0.4));
  c.letterSpacing = '2px';
  c.fillStyle = rgba(o.barText ?? 'bone', 0.9);
  if (o.title) { c.textAlign = 'center'; c.fillText(o.title, x + w / 2, y + bh / 2 + bh * 0.14); }
  if (o.right) { c.textAlign = 'right'; c.fillStyle = rgba(o.barText ?? 'bone', 0.55); c.fillText(o.right, x + w - 14, y + bh / 2 + bh * 0.14); }
  c.restore();
}

export interface DialogState {
  /** Words of the message shown so far (0..3 of "Error: maximum length"). */
  words: number;
  /** 0..1 pressed state of OK. */
  press?: number;
  /** OK focus ring. */
  focus?: number;
  /** Colours: ground of the dialog body, text, the signal frame. */
  body?: string;
  text?: string;
  frame?: string;
  detail?: string;
}

export const DIALOG = { w: 860, h: 360 };
const MSG = ['Error:', 'maximum', 'length'];

/**
 * The film's one system dialog, centred on (cx, cy): signal frame (red box), warning triangle, the message
 * typed word by word, a detail line and an OK button. Returns the OK button rect (for a pointer).
 */
export function drawErrorDialog(c: CanvasRenderingContext2D, cx: number, cy: number, st: DialogState) {
  const { w, h } = DIALOG;
  const x = cx - w / 2, y = cy - h / 2;
  const frame = st.frame ?? 'signal', body = st.body ?? 'ink2', text = st.text ?? 'bone';
  c.save();
  // drop shadow slab
  c.fillStyle = rgba('ink', 0.7);
  c.fillRect(x + 18, y + 18, w, h);
  c.fillStyle = rgba(body, 1);
  c.fillRect(x, y, w, h);
  // title bar in signal
  const bh = 44;
  c.fillStyle = rgba(frame, 1);
  c.fillRect(x, y, w, bh);
  c.font = font(F.mono(600), 17);
  c.letterSpacing = '3px';
  c.fillStyle = rgba('ink', 1);
  c.fillText('CONTEXT_WINDOW — SYSTEM', x + 20, y + 28);
  c.textAlign = 'right';
  c.fillText('×', x + w - 18, y + 29);
  c.textAlign = 'left';
  c.strokeStyle = rgba(frame, 1);
  c.lineWidth = 4;
  c.strokeRect(x + 2, y + 2, w - 4, h - 4);
  // warning triangle
  const tx = x + 88, ty = y + bh + 92, ts = 54;
  c.beginPath();
  c.moveTo(tx, ty - ts); c.lineTo(tx + ts * 1.1, ty + ts * 0.8); c.lineTo(tx - ts * 1.1, ty + ts * 0.8); c.closePath();
  c.fillStyle = rgba(frame, 1); c.fill();
  c.fillStyle = rgba(body, 1);
  c.fillRect(tx - 5, ty - ts * 0.45, 10, ts * 0.8);
  c.fillRect(tx - 5, ty + ts * 0.47, 10, 10);
  // message, word by word
  c.font = font(F.display(800), 50);
  c.letterSpacing = '0px';
  let mx = x + 180;
  for (let i = 0; i < Math.min(st.words, 3); i++) {
    c.fillStyle = rgba(i === 0 ? frame : text, 1);
    c.fillText(MSG[i]!, mx, y + bh + 98);
    mx += measure(MSG[i]! + ' ', F.display(800), 50);
  }
  // detail
  c.font = font(F.mono(400), 18);
  c.letterSpacing = '1px';
  c.fillStyle = rgba(st.detail ?? 'ash', clamp(st.words / 3 + 0.34));
  c.fillText('requested: ∞ tokens     limit: 1,048,576', x + 182, y + bh + 146);
  c.fillText('the conversation is too long to continue.', x + 182, y + bh + 176);
  // OK button
  const ok = { x: x + w - 200, y: y + h - 82, w: 168, h: 54 };
  const press = st.press ?? 0;
  c.fillStyle = rgba(frame, press > 0 ? 1 : 0.14);
  c.fillRect(ok.x, ok.y, ok.w, ok.h);
  c.strokeStyle = rgba(frame, 1);
  c.lineWidth = 2;
  c.strokeRect(ok.x + 1, ok.y + 1, ok.w - 2, ok.h - 2);
  if ((st.focus ?? 0) > 0) { c.strokeStyle = rgba(text, 0.6 * (st.focus ?? 0)); c.lineWidth = 1.5; c.strokeRect(ok.x - 6, ok.y - 6, ok.w + 12, ok.h + 12); }
  c.font = font(F.mono(600), 22);
  c.letterSpacing = '4px';
  c.fillStyle = rgba(press > 0 ? 'ink' : text, 1);
  c.textAlign = 'center';
  c.fillText('OK', ok.x + ok.w / 2, ok.y + ok.h / 2 + 8);
  c.textAlign = 'left';
  c.strokeStyle = rgba(text, 0.35);
  c.strokeRect(ok.x - 200, ok.y + 1, 168, ok.h - 2);
  c.fillStyle = rgba(text, 0.5);
  c.font = font(F.mono(500), 18);
  c.fillText('DETAILS', ok.x - 162, ok.y + ok.h / 2 + 7);
  c.restore();
  return ok;
}

/** Mouse pointer (arrow), tip at (x, y). */
export function drawPointer(c: CanvasRenderingContext2D, x: number, y: number, s = 1, fill = 'bone', edge = 'ink') {
  c.save();
  c.translate(x, y); c.scale(s, s);
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(0, 34); c.lineTo(9, 26); c.lineTo(15, 40); c.lineTo(21, 37); c.lineTo(15, 24); c.lineTo(26, 24); c.closePath();
  c.fillStyle = rgba(fill, 1); c.fill();
  c.strokeStyle = rgba(edge, 1); c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
  c.restore();
}

// ------------------------------------------------------------------ fragments (s14 flash-backs)

/** The pin of s03 (a push pin, head up-left), centred on (x, y), `s` ≈ height/200. */
export function drawPin(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, line = 0) {
  c.save();
  c.translate(x, y); c.scale(s, s); c.rotate(-0.6);
  c.fillStyle = rgba(color, 1); c.strokeStyle = rgba(color, 1); c.lineWidth = 6; c.lineJoin = 'round';
  const draw = (fill: boolean) => {
    c.beginPath(); c.ellipse(0, -70, 40, 14, 0, 0, Math.PI * 2); fill ? c.fill() : c.stroke(); // head top
    c.beginPath(); c.moveTo(-26, -66); c.lineTo(-18, -20); c.lineTo(18, -20); c.lineTo(26, -66); c.closePath(); fill ? c.fill() : c.stroke();
    c.beginPath(); c.ellipse(0, -18, 52, 14, 0, 0, Math.PI * 2); fill ? c.fill() : c.stroke(); // collar
  };
  draw(!line);
  c.beginPath(); c.moveTo(0, -6); c.lineTo(0, 96); c.lineWidth = 7; c.stroke(); // needle
  c.restore();
}

/** A patch of KV-cache cells (key | value pairs) with words; `lit` 0..1 rows lit top-down. */
export function drawKVCells(c: CanvasRenderingContext2D, x: number, y: number, cols: number, rows: number, cw: number, ch: number, color: string, lit: number, seed = 1) {
  const WORDS = ['name', 'date', 'song', 'pin', 'page', 'scroll', 'token', 'memory', 'rental', 'begin', 'key', 'value', 'row', 'cache', 'warm', 'small', 'leak', 'wall'];
  c.save();
  c.font = font(F.mono(600), Math.round(ch * 0.34));
  for (let j = 0; j < rows; j++) {
    const on = clamp(lit * rows - j);
    for (let i = 0; i < cols; i++) {
      const cx = x + i * cw, cy = y + j * ch;
      const key = i % 2 === 0;
      c.strokeStyle = rgba(color, 0.9);
      c.lineWidth = 3;
      c.strokeRect(cx + 4, cy + 4, cw - 8, ch - 8);
      if (on > 0) {
        c.fillStyle = rgba(color, key ? on : 0.35 * on);
        c.fillRect(cx + 4, cy + 4, cw - 8, ch - 8);
      }
      c.fillStyle = rgba(on > 0 && key ? 'signal' : color, 1);
      const w = WORDS[Math.floor(hash(i >> 1, j, seed) * WORDS.length)]!;
      c.fillText(key ? w : (hash(i, j, seed + 1) * 2 - 1).toFixed(2), cx + 16, cy + ch * 0.6);
    }
  }
  c.restore();
}

/** A bullet list (s10), items as bars of text; `n` items shown (fractional: the last one wipes in). */
export function drawBullets(c: CanvasRenderingContext2D, x: number, y: number, items: string[], size: number, color: string, n: number) {
  c.save();
  c.font = font(F.mono(600), size);
  for (let i = 0; i < items.length && i < n; i++) {
    const k = clamp(n - i);
    const yy = y + i * size * 1.7;
    c.fillStyle = rgba(color, 1);
    c.fillRect(x, yy - size * 0.55, size * 0.5, size * 0.5);
    c.save();
    c.beginPath(); c.rect(x + size, yy - size * 1.2, measure(items[i]!, F.mono(600), size) * k + 4, size * 1.6); c.clip();
    c.fillText(items[i]!, x + size, yy);
    c.restore();
  }
  c.restore();
}
