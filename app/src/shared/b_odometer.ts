// Rolling-drum digits for the token counter (hooks s05/s08/s14, overflow s12).
// `shownValue` eases each counter step so the drums roll into place; `drawOdometer` draws a
// continuous value as per-digit drums (Plex Mono), grouped with commas.
import { F, font } from '../engine/type';
import { clamp, ease, smoothstep } from '../engine/util';
import type { TokenCounter } from './counter';

/** Plex Mono advance and cap height per em. */
export const MONO_ADV = 0.6;
export const MONO_CAP = 0.698;

/**
 * The counter value with each step eased over `dur` s (continuous, for drums). Roll segments are already
 * continuous and pass through. Returns NaN / Infinity untouched.
 */
export function shownValue(counter: TokenCounter, t: number, dur = 0.16): number {
  const st = counter.state(t);
  if (!Number.isFinite(st.value)) return st.value;
  if (t - st.stepT >= dur || st.mode !== 'count') return st.value;
  const prev = counter.state(st.stepT - 1e-4).value;
  if (!Number.isFinite(prev)) return st.value;
  return prev + (st.value - prev) * ease.outExpo(clamp((t - st.stepT) / dur));
}

/** Odometer drum position of digit 10^k for a continuous count N (the last digit rests on detents). */
export function drum(N: number, k: number) {
  const p = Math.pow(10, k);
  if (k === 0) {
    const r = Math.round(N), f = N - r;
    return (((r + Math.sign(f) * 0.5 * smoothstep(0.38, 0.5, Math.abs(f))) % 10) + 10) % 10;
  }
  const q = Math.floor(N / p);
  const rem = N - q * p;
  const carry = clamp(rem - (p - 0.5), 0, 1);
  return ((q % 10) + carry + 10) % 10;
}

/** Characters of the grouped integer part of N ('1,048,576'), at least `minDigits` digits. */
export function groupedDigits(N: number, minDigits = 1) {
  const nd = Math.max(minDigits, Math.floor(Math.max(1, N)).toString().length);
  const out: { ch: string; k: number }[] = []; // k = digit power, -1 for a comma
  for (let k = nd - 1; k >= 0; k--) {
    out.push({ ch: '', k });
    if (k > 0 && k % 3 === 0) out.push({ ch: ',', k: -1 });
  }
  return out;
}

export interface OdoStyle {
  size: number;
  weight?: number;
  color: string;
  align?: 'left' | 'right' | 'center';
  /** Clip each drum window to its cell (default true). */
  clip?: boolean;
  minDigits?: number;
  /** Stroke instead of fill (outline digits). */
  stroke?: number;
}

/** Draw N at (x, baseline y). Returns the drawn width. */
export function drawOdometer(c: CanvasRenderingContext2D, x: number, y: number, N: number, o: OdoStyle): number {
  const size = o.size, adv = size * MONO_ADV, rowH = size * 1.02;
  const cells = groupedDigits(N, o.minDigits ?? 1);
  const w = cells.length * adv;
  const x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
  c.save();
  c.font = font(F.mono(o.weight ?? 500), size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = o.color; c.strokeStyle = o.color;
  if (o.stroke) c.lineWidth = o.stroke;
  const glyph = (s: string, gx: number, gy: number) => (o.stroke ? c.strokeText(s, gx, gy) : c.fillText(s, gx, gy));
  const a0 = c.globalAlpha;
  cells.forEach((cell, i) => {
    const cx = x0 + i * adv;
    if (cell.k < 0) { glyph(',', cx, y); return; }
    const pos = drum(N, cell.k);
    const base = Math.floor(pos), fr = pos - base;
    c.save();
    if (o.clip ?? true) { c.beginPath(); c.rect(cx - 4, y - size * MONO_CAP - size * 0.16, adv + 8, size * MONO_CAP + size * 0.32); c.clip(); }
    for (let j = 0; j <= 1; j++) {
      const off = (fr - j) * rowH; // j=0: current digit moving up, j=1: next digit coming from below
      const dig = (((base + j) % 10) + 10) % 10;
      if (Math.abs(off) > rowH * 0.95) continue;
      c.globalAlpha = a0 * (1 - Math.min(1, Math.abs(off) / rowH) * 0.6);
      glyph(String(dig), cx, y - off);
    }
    c.restore();
  });
  c.restore();
  return w;
}
