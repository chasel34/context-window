// s10 helper: an original, generic line-drawn face (front view, single-weight bone strokes) as resampled
// polylines, plus the polyline morph used to unfold it from a line and to pull it apart into list rows.
import { clamp, ease, lerp, TAU, type V2 } from '../engine/util';

/** Points per stroke (every stroke is resampled to this count, so any two strokes morph point by point). */
export const N = 72;

export interface FaceStroke {
  id: string;
  /** Face-local points (px, origin = face centre), uniformly spaced along the stroke, left end first. */
  pts: V2[];
  len: number;
  /** Centroid x (for ordering the unfold). */
  cx: number;
}

/** Catmull-Rom spline through control points, sampled densely. */
function spline(ctrl: [number, number][], closed = false, per = 24): V2[] {
  const P = ctrl.map(([x, y]) => ({ x, y }));
  const n = P.length;
  const at = (i: number) => (closed ? P[((i % n) + n) % n]! : P[Math.max(0, Math.min(n - 1, i))]!);
  const out: V2[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(closed ? { ...P[0]! } : { ...P[n - 1]! });
  return out;
}

function circle(cx: number, cy: number, r: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= 48; i++) { const a = Math.PI + (i / 48) * TAU; out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  return out;
}

/** Resample a polyline to n points evenly spaced by arc length. */
export function resample(pts: V2[], n = N): { pts: V2[]; len: number } {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = L[L.length - 1]!;
  const out: V2[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * total;
    while (j < L.length - 1 && L[j]! < s) j++;
    const a = pts[j - 1]!, b = pts[j]!, seg = L[j]! - L[j - 1]!;
    const u = seg > 0 ? (s - L[j - 1]!) / seg : 0;
    out.push({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) });
  }
  return { pts: out, len: total };
}

const mirror = (c: [number, number][]) => c.map(([x, y]) => [-x, y] as [number, number]).reverse();

/** The face, stroke by stroke (ids are referenced by the list rows in s10). */
export function buildFace(): Map<string, FaceStroke> {
  const browL: [number, number][] = [[-124, -90], [-98, -105], [-64, -106], [-38, -97]];
  const lidL: [number, number][] = [[-118, -40], [-98, -59], [-68, -64], [-42, -52]];
  const earL: [number, number][] = [[-168, -52], [-192, -66], [-207, -30], [-200, 16], [-176, 40]];
  const raw: Record<string, V2[]> = {
    // head outline, open at the top (the hair closes it): right temple → chin → left temple
    head: spline([[152, -150], [170, -72], [168, 18], [150, 108], [113, 184], [58, 232], [0, 248], [-58, 232], [-113, 184], [-150, 108], [-168, 18], [-170, -72], [-152, -150]]),
    hair: spline([[-152, -150], [-173, -214], [-140, -282], [-62, -322], [30, -327], [110, -297], [160, -240], [169, -182], [152, -150]]),
    fringe: spline([[-52, -320], [-44, -266], [-6, -222], [64, -196], [150, -188]]),
    browL: spline(browL),
    browR: spline(mirror(browL).map(([x, y]) => [x, y - 6] as [number, number])), // one brow raised
    lidL: spline(lidL),
    lidR: spline(mirror(lidL)),
    pupilL: circle(-76, -42, 10),
    pupilR: circle(76, -42, 10),
    nose: spline([[6, -36], [12, 8], [27, 46], [13, 61], [-7, 57]]),
    mouth: spline([[-66, 114], [-34, 133], [0, 138], [34, 133], [66, 114]]),
    earL: spline(earL),
    earR: spline(mirror(earL)),
  };
  const out = new Map<string, FaceStroke>();
  for (const [id, pts0] of Object.entries(raw)) {
    let pts = pts0;
    if (pts[0]!.x > pts[pts.length - 1]!.x + 1) pts = pts.slice().reverse(); // left end first
    const r = resample(pts);
    out.set(id, { id, pts: r.pts, len: r.len, cx: r.pts.reduce((a, p) => a + p.x, 0) / r.pts.length });
  }
  return out;
}

/** N evenly spaced points on a horizontal segment. */
export function segment(x0: number, x1: number, y: number, n = N): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) out.push({ x: lerp(x0, x1, i / (n - 1)), y });
  return out;
}

/**
 * Morph polyline a → b at progress p (0..1). The stroke is pulled by one end: point j starts `lag`·j/(n-1)
 * later (lead = 'start') or earlier, so it travels like a string being drawn out, with an arc `lift` (px).
 */
export function morph(a: V2[], b: V2[], p: number, lag = 0.3, lift = 0, lead: 'start' | 'end' = 'start'): V2[] {
  const n = a.length, out: V2[] = new Array(n);
  for (let j = 0; j < n; j++) {
    const f = lead === 'start' ? j / (n - 1) : 1 - j / (n - 1);
    const m = ease.inOutCubic(clamp((p - lag * f) / (1 - lag)));
    out[j] = { x: lerp(a[j]!.x, b[j]!.x, m), y: lerp(a[j]!.y, b[j]!.y, m) - lift * Math.sin(Math.PI * m) };
  }
  return out;
}

export function strokePath(c: CanvasRenderingContext2D, pts: V2[]) {
  c.beginPath();
  c.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
  c.stroke();
}
