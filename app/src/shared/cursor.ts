// The through-line of the film: a blinking magenta block cursor ▌ (BEATSHEET). Every scene is
// "written out" by it. Drawn as a rectangle (Unbounded has no ▌ glyph; a rectangle also keeps its
// size exact at any font). Blinks on the beat grid: on for the first half of each beat.
import type { Timeline } from '../timeline';
import { rgba, mixRGBA } from '../engine/palette';

export interface CursorStyle {
  /** Force the blink: true = always on (e.g. while typing), false = off. Default: blink on the beat. */
  on?: boolean;
  /** Blink rate in beats per cycle (1 = on/off once per beat, 2 = every two beats). */
  period?: number;
  /** 0..1 duty cycle (fraction of the cycle that the cursor is visible). */
  duty?: number;
  /** Colour: palette key or '#hex'. Default signal. */
  color?: string;
  alpha?: number;
  /** Width as a fraction of the font size (▌ = half a monospace cell ≈ 0.3). */
  width?: number;
  /** Glow: extra HDR brightness is not available in Canvas2D; use post bloom. 0..1 soft halo via shadowBlur. */
  glow?: number;
}

/** Is the cursor lit at t (beat-synced blink)? */
export function cursorOn(t: number, tl: Timeline, period = 1, duty = 0.5): boolean {
  const b = tl.beat(t) / period;
  return b - Math.floor(b) < duty;
}

/**
 * Draw the cursor with its left edge at x, sitting on the text baseline y, sized for a font of `size` px.
 * Returns the cursor rectangle (whether or not it is lit).
 */
export function drawCursor(c: CanvasRenderingContext2D, x: number, y: number, size: number, t: number, tl: Timeline, o: CursorStyle = {}) {
  const w = size * (o.width ?? 0.32), top = y - size * 0.78, h = size * 1.0;
  const lit = o.on ?? cursorOn(t, tl, o.period ?? 1, o.duty ?? 0.5);
  if (lit) {
    c.save();
    c.globalAlpha *= o.alpha ?? 1;
    c.fillStyle = rgba(o.color ?? 'signal', 1);
    if (o.glow) { c.shadowColor = mixRGBA(o.color ?? 'signal', 'bone', 0.2, 0.9); c.shadowBlur = size * 0.4 * o.glow; }
    c.fillRect(x, top, w, h);
    c.restore();
  }
  return { x, y: top, w, h, lit };
}
