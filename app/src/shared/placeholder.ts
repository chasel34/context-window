// Phase-1 placeholder scene: shows the scene id + title, the active lyric line (sung words magenta),
// the cursor, a beat/bar indicator and the scene's progress, so the whole video plays end to end.
// Scene authors replace their module's body; keep the default-exported Scene class.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { drawLyricLine, type LyricStyle } from './lyric';
import { drawCursor } from './cursor';

export class PlaceholderScene extends Scene {
  layer = new Layer2D();
  /** Ground colour (linear, palette key). */
  ground: keyof typeof LIN = 'ink';
  /** Lyric style (family/size/colours). */
  lyricStyle: LyricStyle = { size: 88, align: 'center', maxWidth: 1500 };
  /** Where the lyric line sits (first baseline anchor). */
  lyricAt = { x: W / 2, y: H / 2 + 30 };
  /** Show the lyric line at all. */
  showLyric = true;

  /** Draw scene-specific content under the lyric (override). */
  drawContent(_c: CanvasRenderingContext2D, _f: Frame): void {}
  /** Post overrides (override). */
  postFx(_f: Frame): PostOverrides { return {}; }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl, entry } = this.ctx;
    clearRT(renderer, out, LIN[this.ground]);
    const L = this.layer;
    L.clear();
    const c = L.ctx;
    const ink = this.ground !== 'ink' && this.ground !== 'ink2';
    const fg = ink ? 'ink' : 'bone';

    this.drawContent(c, f);

    // scene label (top left)
    c.textBaseline = 'alphabetic';
    c.font = font(F.mono(600), 22);
    c.fillStyle = rgba(fg, 0.9);
    c.fillText(`${entry.id} · ${entry.title}`, 64, 80);
    c.font = font(F.mono(400), 15);
    c.fillStyle = rgba(fg, 0.5);
    c.fillText(`${entry.section.toUpperCase()}  ${entry.start.toFixed(3)}–${entry.end.toFixed(3)}s  lt ${f.lt.toFixed(2)}s  p ${f.p.toFixed(2)}`, 64, 108);
    if (entry.transitionOut.note) c.fillText(`→ ${entry.transitionOut.note}`, 64, 132);

    // active lyric line
    const line = this.showLyric ? f.lyric.line : null;
    const size = this.lyricStyle.size ?? 88;
    if (line) {
      const lay = drawLyricLine(c, line, f.t, this.lyricAt.x, this.lyricAt.y, { ...(ink ? { base: 'ink', baseAlpha: 0.3, sung: 'ink' } : {}), ...this.lyricStyle });
      const last = lay.rows[lay.rows.length - 1]!; // the cursor waits at the end of the line
      drawCursor(c, last.x + last.w + size * 0.12, last.y, size, f.t, tl, { color: ink ? 'ink' : 'signal' });
    } else if (this.showLyric) {
      drawCursor(c, this.lyricAt.x - size * 0.16, this.lyricAt.y, size, f.t, tl, { color: ink ? 'ink' : 'signal' });
    }

    // beat indicator (bottom left): 4 squares, current beat lit, flash on the beat
    const bi = tl.beatInBar(f.t), pulse = tl.beatPulse(f.t, 0.08);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i === bi ? rgba(ink ? 'ink' : 'signal', 0.5 + 0.5 * pulse) : rgba(fg, 0.18);
      c.fillRect(64 + i * 26, H - 84, 18, 18);
    }
    c.font = font(F.mono(400), 15);
    c.fillStyle = rgba(fg, 0.5);
    c.fillText(`bar ${Math.floor(f.bar) + 1}  beat ${bi + 1}  ${f.t.toFixed(2)}s`, 180, H - 69);
    // progress through the scene window
    c.fillStyle = rgba(fg, 0.15);
    c.fillRect(64, H - 48, W - 128, 2);
    c.fillStyle = rgba(ink ? 'ink' : 'signal', 0.9);
    c.fillRect(64, H - 48, (W - 128) * Math.max(0, Math.min(1, f.p)), 2);

    comp.draw(renderer, L.upload(), out);
    return { ...(ink ? { paper: 1, bloomThreshold: 1.3, bloom: 0.25 } : {}), ...this.postFx(f) };
  }
}
