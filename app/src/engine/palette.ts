import { hexToLinear } from './util';

// Context Window palette (STYLE.md): ink ground, bone text/lines, ONE signal colour (magenta).
// graphite/ash are neutral greys for secondary UI; `signalDeep`/`signalHot` are darker/lighter
// shades of the same magenta (for shadows/cores) — not new hues.
export const HEX = {
  ink: '#0A0A0B', // background
  ink2: '#151517', // raised black (panels, chat bubbles)
  graphite: '#5E5B57', // dim lines, secondary text
  ash: '#9C978F', // mid grey
  bone: '#EEE9DF', // primary text and lines
  signal: '#FF2E88', // fluorescent magenta: hooks, sung words, counter accents, cursor
  signalDeep: '#9E1250', // deep magenta (shadow side of signal)
  signalHot: '#FF8CC0', // hot, lighter magenta (bloom cores)
  // the only non-signal accent in the film: the single green ✓ of s07 (BEATSHEET)
  ok: '#39FF7A',
} as const;

export type PaletteKey = keyof typeof HEX;

/** Linear RGB triplets for GL uniforms. */
export const LIN: Record<PaletteKey, [number, number, number]> = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, hexToLinear(v)]),
) as Record<PaletteKey, [number, number, number]>;

/** CSS rgba() for Canvas2D. `key` is a palette key or a '#rrggbb' string. */
export function rgba(key: PaletteKey | string, a = 1): string {
  const hex = (HEX as Record<string, string>)[key] ?? key;
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Mix two palette colours in sRGB (k = 0 → a, 1 → b), as a CSS colour. */
export function mixRGBA(a: PaletteKey | string, b: PaletteKey | string, k: number, alpha = 1): string {
  const pa = rgba(a).match(/\d+/g)!.map(Number), pb = rgba(b).match(/\d+/g)!.map(Number);
  return `rgba(${[0, 1, 2].map((i) => Math.round(pa[i]! + (pb[i]! - pa[i]!) * k)).join(',')},${alpha})`;
}
