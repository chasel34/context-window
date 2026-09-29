// s14 · hook3 (Final Chorus, damage 1). The strongest hook: the parametric hook (src/shared/hook.ts) at full
// damage, cut through with flash-backs of earlier scenes (drawn here, simplified): the pin (s03), KV cells
// (s06), the bullet list (s10), "User was kind." (s11) and the error dialog (s12).
//   - holds after "Context!" and the gaps: a fragment flashes on every 8th note; inside lines, on beats
//     that carry no sung onset
//   - "(window!)": the window shows the fragments, one per 8th (the window is the memory)
//   - lines: the fragment of the beat sits behind the type as a faint drawing
//   - "Token ×4": the counter reads OVERFLOW, once more per token, off the edge of the frame;
//     "a million more" → ∞ (counter.ts); "Where did we begin?" → NaN
//   - "Where did we begin?": everything collapses to the centre (fragments fly in, the frame shrinks,
//     then switches off like a CRT) and leaves a single point that breathes on the beat until s15.
import type { Frame, PostOverrides } from '../engine/scene';
import { W, H } from '../engine/gl';
import { rgba } from '../engine/palette';
import { F, font, measure } from '../engine/type';
import { clamp, ease, hash, lerp, prog, pulse } from '../engine/util';
import { HookScene, CUT_LEAD, type Rect, type Shot } from '../shared/hook';
import { drawErrorDialog, drawKVCells, drawBullets, drawPin } from '../shared/b_ui';

type Frag = 'pin' | 'kv' | 'bullets' | 'oracle' | 'error';
const FRAGS: Frag[] = ['pin', 'kv', 'bullets', 'error', 'oracle'];
const FLASH = 0.085;

export default class S14Hook3 extends HookScene {
  collapseT = Infinity;
  beginT = Infinity;
  offT = Infinity;
  flashes: { t0: number; t1: number; kind: Frag; inv: boolean }[] = [];

  override init() {
    super.init();
    const { tl, start } = this.ctx;
    const last = this.shots.find((s) => /^Where did we begin/i.test(s.line.text));
    if (last) {
      this.collapseT = last.line.words[0]!.start - CUT_LEAD;
      this.beginT = last.line.words[3]!.start - CUT_LEAD;
      this.offT = this.beginT + 0.34;
    }
    this.tailT = Infinity;
    // flash schedule on the 8th-note grid
    const onsets = this.shots.flatMap((s) => s.line.words.map((w) => w.start));
    const b0 = Math.ceil(tl.beat(start + 0.1) * 2), b1 = Math.floor(tl.beat(this.collapseT - 0.1) * 2);
    let n = 0;
    for (let e = b0; e <= b1; e++) {
      const g = tl.timeOfBeat(e / 2);
      if (onsets.some((x) => Math.abs(x - g) < 0.11)) continue;
      if (this.windowAmount(g) > 0.01 || this.windowAmount(g + FLASH) > 0.01) continue;
      if (this.hitT > 0 && Math.abs(g - this.hitT) < 0.05) continue;
      const shot = this.shotAt(g);
      if (!shot || shot.kind === 'tokens' || shot.kind === 'hundred') continue;
      const held = g > shot.line.end + 0.05 || (shot.kind === 'stutter' && g > shot.line.words[shot.line.words.length - 1]!.start + 0.15);
      if (!held && e % 2 !== 0) continue; // inside a sung line: on the beat only
      this.flashes.push({ t0: g - CUT_LEAD, t1: g + FLASH, kind: FRAGS[n % FRAGS.length]!, inv: n % 2 === 1 });
      n++;
    }
  }

  // ------------------------------------------------------------------ flash-backs

  override interject(c: CanvasRenderingContext2D, f: Frame, shot: Shot | null): boolean {
    const t = f.t;
    if (t >= this.collapseT) return false;
    // inside a (window!): the fragments, one per 8th
    const wk = this.windowAmount(t);
    if (wk > 0.3) {
      const cue = this.windows.find((w) => t >= w.start - 0.05 && t < w.out) ?? this.windows[0]!;
      const e = Math.floor((t - cue.start) / (this.ctx.tl.beatPeriod / 2) + 1e-6);
      const k = FRAGS[(Math.max(0, e) + this.windows.indexOf(cue) * 2) % FRAGS.length]!;
      this.fragment(c, k, e % 2 === 0, t, cue.start + e * this.ctx.tl.beatPeriod / 2);
      return true;
    }
    const fl = this.flashes.find((x) => t >= x.t0 && t < x.t1);
    if (!fl) return false;
    void shot;
    this.fragment(c, fl.kind, fl.inv, t, fl.t0);
    return true;
  }

  /** A fragment, full frame. `inv`: ink ground with signal drawing; else signal ground, ink drawing. */
  fragment(c: CanvasRenderingContext2D, kind: Frag, inv: boolean, t: number, t0: number, alpha = 1, ground = true) {
    const bg = inv ? 'ink' : 'signal', fg = inv ? 'signal' : 'ink';
    const age = Math.max(0, t - t0);
    const s = 1 + 0.05 * (1 - ease.outExpo(clamp(age / 0.08)));
    c.save();
    c.globalAlpha *= alpha;
    if (ground) { c.fillStyle = rgba(bg, 1); c.fillRect(0, 0, W, H); }
    c.translate(W / 2, H / 2); c.scale(s, s); c.translate(-W / 2, -H / 2);
    const label = (txt: string) => {
      c.font = font(F.mono(600), 16); c.letterSpacing = '4px';
      c.fillStyle = rgba(fg, 0.7); c.fillText(txt, 96, 76); c.letterSpacing = '0px';
    };
    if (kind === 'pin') {
      label('S03 · FIRST TOKEN · PINNED');
      const bx = 380, by = 420, bw = 1160, bh = 250;
      c.strokeStyle = rgba(fg, 1); c.lineWidth = 5;
      c.beginPath(); c.roundRect(bx, by, bw, bh, 28); c.stroke();
      c.font = font(F.mono(600), 46); c.fillStyle = rgba(fg, 1);
      c.fillText('user: my name, the date,', bx + 60, by + 104);
      c.fillText('      my favourite song', bx + 60, by + 170);
      drawPin(c, bx + 40, by - 10, 2.1, fg);
    } else if (kind === 'kv') {
      label('S06 · KV CACHE · KEY | VALUE');
      drawKVCells(c, 120, 170, 8, 5, 210, 150, fg, 0.3 + 0.7 * clamp(age / 0.08), 3);
    } else if (kind === 'bullets') {
      label('S10 · SUMMARY');
      drawBullets(c, 300, 330, ['your face', 'your voice', 'one single line', 'user was kind'], 84, fg, 4);
    } else if (kind === 'oracle') {
      label('S11 · ORACLE');
      c.font = font(F.oracle(500), 230);
      c.fillStyle = rgba(fg, 1);
      const txt = 'User was kind.';
      c.fillText(txt, (W - measure(txt, F.oracle(500), 230)) / 2, H / 2 + 70);
    } else {
      label('S12 · SYSTEM');
      c.translate(W / 2, H / 2 - 20); c.scale(1.45, 1.45); c.translate(-W / 2, -(H / 2 - 20));
      drawErrorDialog(c, W / 2, H / 2 - 20, inv ? { words: 3 } : { words: 3, body: 'ink', frame: 'bone', text: 'bone' });
    }
    c.restore();
  }

  /** Lines: the beat's fragment as a faint drawing behind the type. */
  override drawFurniture(c: CanvasRenderingContext2D, f: Frame, shot: Shot | null, counterShot: boolean) {
    if (shot && shot.kind === 'line' && f.t < this.collapseT) {
      const b = Math.floor(this.ctx.tl.beat(f.t) + 1e-6);
      this.fragment(c, FRAGS[((b % FRAGS.length) + FRAGS.length) % FRAGS.length]!, false, f.t, this.ctx.tl.timeOfBeat(b), 0.12, false);
    }
    super.drawFurniture(c, f, shot, counterShot);
  }

  // ------------------------------------------------------------------ OVERFLOW ×n, ∞

  override drawCounterValue(c: CanvasRenderingContext2D, f: Frame, shot: Shot, v: number, x: number, base: number, size: number): number {
    const st = this.counter.state(f.t);
    if (st.text === 'OVERFLOW') {
      // once more per sung token, running off the frame
      const n = Math.max(1, shot.line.words.filter((w) => f.t >= w.start - CUT_LEAD).length);
      const text = Array.from({ length: n }, () => 'OVERFLOW').join(' ');
      c.font = font(F.mono(600), size); c.fillStyle = rgba(this.fg, 1);
      c.fillText(text, x, base);
      return Math.min(W, measure(text, F.mono(600), size));
    }
    if (st.text === '∞') {
      const age = f.t - st.stepT;
      const big = size * 2.3 * (1 + 0.25 * (1 - ease.outExpo(clamp(age / 0.2))));
      c.save();
      c.font = font(F.mono(500), big);
      c.fillStyle = rgba(this.fg, 1);
      c.textAlign = 'center';
      c.fillText('∞', W / 2, base + big * 0.08);
      c.restore();
      return W / 2 + big * 0.3 - x;
    }
    return super.drawCounterValue(c, f, shot, v, x, base, size);
  }

  // ------------------------------------------------------------------ the collapse

  override windowAmount(t: number) { return t >= this.collapseT ? 0 : super.windowAmount(t); }

  override windowRect(t: number, k: number): Rect {
    if (t < this.collapseT) return super.windowRect(t, k);
    const s = lerp(1, 0.4, prog(t, this.collapseT, this.beginT, ease.inCubic));
    let w = W * s, h = H * s;
    h = lerp(h, 3, prog(t, this.beginT, this.beginT + 0.16, ease.inCubic)); // CRT off: first to a line…
    w = lerp(w, 3, prog(t, this.beginT + 0.12, this.offT, ease.inCubic)); // …then to a point
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }

  override drawOutside(c: CanvasRenderingContext2D, f: Frame, r: Rect, k: number) {
    const t = f.t;
    if (t < this.collapseT) { super.drawOutside(c, f, r, k); return; }
    // everything falls into the centre: streaks and the fragments, shrinking as they go
    const q = prog(t, this.collapseT, this.offT, ease.inCubic);
    const a = 1 - prog(t, this.offT - 0.05, this.offT + 0.1);
    if (a <= 0) return;
    c.save();
    for (let i = 0; i < 48; i++) {
      const ang = hash(i, 1) * Math.PI * 2;
      const r0 = lerp(1300, 60, clamp(q + hash(i, 2) * 0.3)), r1 = r0 + 60 + 260 * q;
      c.strokeStyle = rgba(i % 3 === 0 ? 'signal' : 'bone', 0.35 * a);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(W / 2 + Math.cos(ang) * r0, H / 2 + Math.sin(ang) * r0);
      c.lineTo(W / 2 + Math.cos(ang) * r1, H / 2 + Math.sin(ang) * r1);
      c.stroke();
    }
    FRAGS.forEach((kind, i) => {
      const ang = (i / FRAGS.length) * Math.PI * 2 + 0.4;
      const d = lerp(900, 0, q);
      const s = lerp(0.34, 0.02, q);
      c.save();
      c.translate(W / 2 + Math.cos(ang) * d, H / 2 + Math.sin(ang) * d * 0.62);
      c.rotate((1 - q) * (hash(i, 5) - 0.5) * 0.8);
      c.scale(s, s);
      c.translate(-W / 2, -H / 2);
      this.fragment(c, kind, true, t, this.collapseT, a * 0.9, true);
      c.restore();
    });
    c.restore();
  }

  override drawOverlay(c: CanvasRenderingContext2D, f: Frame, r: Rect) {
    const t = f.t;
    if (t < this.beginT) return;
    void r;
    // the CRT line flash, then the point: breathing on the beat, shrinking until s15
    const flare = prog(t, this.beginT + 0.08, this.beginT + 0.16) * (1 - prog(t, this.beginT + 0.16, this.offT + 0.1));
    c.save();
    if (flare > 0) {
      c.fillStyle = rgba('signalHot', flare);
      c.fillRect(W / 2 - 900 * (1 - prog(t, this.beginT + 0.12, this.offT, ease.inCubic)), H / 2 - 2, 1800 * (1 - prog(t, this.beginT + 0.12, this.offT, ease.inCubic)), 4);
    }
    if (t >= this.offT - 0.04) {
      const bp = this.ctx.tl.beatPulse(t, 0.12);
      const vo = this.ctx.audio.hit('vocal', t, 0.15);
      const life = prog(t, this.offT, this.ctx.end, ease.outCubic);
      const rad = lerp(14, 5, life) * (1 + 0.5 * bp + 0.6 * vo) + 30 * pulse(t, this.offT, 0.06);
      const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, rad * 5);
      g.addColorStop(0, rgba('signalHot', 1));
      g.addColorStop(0.18, rgba('signal', 0.9));
      g.addColorStop(1, rgba('signal', 0));
      c.fillStyle = g;
      c.fillRect(W / 2 - rad * 5, H / 2 - rad * 5, rad * 10, rad * 10);
      c.fillStyle = rgba('bone', 1);
      c.beginPath(); c.arc(W / 2, H / 2, rad * 0.45, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }

  override post(f: Frame, s: Parameters<HookScene['post']>[1]): PostOverrides {
    const o = super.post(f, s);
    const t = f.t;
    // strobe: fragments flash with a kick of RGB split
    if (this.flashes.some((x) => t >= x.t0 && t < x.t1)) o.rgbSplit = (o.rgbSplit ?? 0) + 10;
    if (t >= this.collapseT) {
      o.paper = 0;
      o.shake = [0, 0];
      o.zoom = 1;
      o.rgbSplit = 4 * (1 - prog(t, this.collapseT, this.offT));
      o.bloom = 0.5; o.bloomThreshold = 0.9;
    }
    return o;
  }
}

