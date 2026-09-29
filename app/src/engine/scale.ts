// Output resolution multiplier, read once from the page URL. Scenes always lay out in logical
// 1920x1080 px; the engine renders at SCALE x that:
//   ?scale=0.5 → 960x540 (fast preview renders), default 1 → 1920x1080, ?scale=2 → 3840x2160.
// Kept in its own module so glsl/common.ts can use it without an import cycle through gl.ts.
function readScale() {
  if (typeof location === 'undefined') return 1;
  const s = Number(new URLSearchParams(location.search).get('scale') ?? '1');
  if (!Number.isFinite(s) || s <= 0) return 1;
  // 0.5 (preview) or an integer 1..4
  return s < 1 ? 0.5 : Math.min(4, Math.round(s));
}

/** Physical pixels per logical pixel of the output (0.5 for previews, else integer 1..4; default 1). */
export const SCALE = readScale();
