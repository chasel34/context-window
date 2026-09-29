# Context Window — renderer

A code-rendered music video: TypeScript + three.js, bun + Vite. Every frame is a pure function of the
song time `t`, so the browser preview and the offline 1080p60 export show the same pictures.
Architecture adapted from mexicat/pdoom-video (MIT, see [`LICENSE-THIRD-PARTY.md`](../LICENSE-THIRD-PARTY.md)).

Inputs (read-only for scenes): [`BEATSHEET.md`](BEATSHEET.md), [`STYLE.md`](STYLE.md), `data/lyrics.json`,
`data/audio.json`, `data/sections.json`, `song/context-window.mp3` (the preview plays it; the export muxes
`song/Context Window.wav`).

## Commands

```sh
cd app
bun install
bun run dev                                  # http://localhost:5173 — plays in sync with the mp3
bun run typecheck
bun run render --preview                     # whole song, 960x540 30fps → ../out/context-window_preview.mp4
bun run render                               # whole song, 1920x1080 60fps, 4 motion-blur samples
bun run render --from 32 --to 50 --preview   # a time range
bun run render --scene s05 --preview         # one scene's window (loads only that scene)
bun scripts/render.ts stills --t 33.2,39.5 --scene s05 --out ../out/wip/s05    # PNGs to look at
bun scripts/render.ts sheet --scene s05 --n 12 --out ../out/wip/s05/sheet.png  # contact sheet
bun scripts/render.ts perf --from 32 --to 36                                   # ms/frame
```

Render options: `--samples N` (motion-blur sub-frames per frame, default 4; `1` = off; `auto` = adaptive
4…324), `--shutter 0.5` (fraction of the frame time), `--fps`, `--scale 0.5|1|2`, `--crf`, `--preset`,
`--out file.mp4`, `--noaudio`, `--only s05,s06`, `--url http://localhost:5173` (use a running server;
by default the script starts its own server without live reload). Output goes to `../out/`.

The final 1080p60 render with `--samples auto` takes about 50 min for the whole song on an Apple Silicon Mac.

### Preview keys

| Key | Action |
|---|---|
| space / click | play / pause |
| ← / → | seek ±1 s (shift: ±5 s) |
| `,` / `.` | ±1 frame |
| `[` / `]` | previous / next scene |
| `1`…`9`, `0` | jump to s01…s09, s10 |
| shift + `1`…`6` | jump to s11…s16 |
| `l` | loop the current scene |
| `h` | hide the UI |

URL params: `?t=32.5` (start time), `?scene=s05` (start at a scene; add `&loop` to loop it),
`?only=s05` (load only that scene: faster, isolates you from other broken scenes), `?scale=0.5|2`.
Editing a scene file hot-reloads that scene; editing `src/shared/` reloads all scenes.

## Layout

```
src/
  main.ts            preview player + export API (window.__cw)
  timeline.ts        SCENES (the edit) + Timeline helpers (beats, lyrics, sections, transitions)
  engine/            renderer core: engine, gl (FSPass, Layer2D, Compositor), post, type (fonts),
                     lyrics, audio, util (easing, seeded random), lines (GPU line batches), hud
  shared/            modules scenes share: lyric, counter, cursor, chat, hook, placeholder
  scenes/sNN_name.ts one module per scene (s01_boot … s16_new_chat)
scripts/render.ts    offline renderer (headless Chrome → raw frames → ffmpeg x264 + audio)
public/fonts/        Unbounded 400/800/900, IBM Plex Mono, Cormorant Garamond Italic (OFL)
```

## The edit (`src/timeline.ts`)

`SCENES` lists the 16 scenes of BEATSHEET.md. Each start is anchored, never hand-typed as a float:
a section downbeat from `data/sections.json` (`{ section: 'verse1' }`), the grid point at/before a sung
line (`{ cut: 'Your face is a bullet list', div: 2 }`), or a BEATSHEET time snapped to the grid
(`{ snap: 84.7, div: 2 }`). The resulting cut points:

| id | scene | start (s) | anchor |
|---|---|---|---|
| s01 | boot | 0.000 | |
| s02 | system | 3.593 | 8th note before "You" (3.58); beat 3.793 would clip it |
| s03 | first token | 14.592 | verse1 downbeat |
| s04 | scroll | 27.392 | pre1 |
| s05 | hook1 | 32.191 | chorus1 |
| s06 | KV cache | 49.791 | verse2 |
| s07 | truncate | 56.190 | pre2 |
| s08 | hook2 | 60.990 | chorus2 |
| s09 | compress | 75.389 | bridge |
| s10 | bullet list | 77.989 | 8th note before "Your" (78.16) |
| s11 | oracle | 84.789 | 8th note between "…single line" and "User was kind" |
| s12 | overflow | 88.189 | break |
| s13 | keystorm | 99.388 | drop |
| s14 | hook3 | 113.788 | chorus_final |
| s15 | where do we— | 130.587 | beat before "Where" (130.62) |
| s16 | new chat | 132.687 | 16th note at/before "New chat!" (132.76), a 16th before the outro downbeat 132.987; the counter resets to 0 here |

## Scene API

A scene is `src/scenes/sNN_name.ts` default-exporting a class that extends `Scene`
(`src/engine/scene.ts`). The placeholders extend `PlaceholderScene` (`src/shared/placeholder.ts`);
replace that with your own:

```ts
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../engine/scene';
import { Layer2D, FSPass, W, H, clearRT } from '../engine/gl';
import { LIN, rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { drawLyricLine } from '../shared/lyric';
import { drawCursor } from '../shared/cursor';

export default class S06KvCache extends Scene {
  layer = new Layer2D();                       // 1920x1080 Canvas2D → texture
  override async init() { /* precompute geometry, text outlines, word lists */ }
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, tl } = this.ctx;
    clearRT(renderer, out, LIN.ink);            // must fully overwrite `out` (linear HDR)
    const c = this.layer.ctx; this.layer.clear();
    const lay = f.lyric.line && drawLyricLine(c, f.lyric.line, f.t, W / 2, H / 2, { size: 110, align: 'center' });
    if (lay) drawCursor(c, lay.caret.x + 12, lay.caret.y, 110, f.t, tl);
    comp.draw(renderer, this.layer.upload(), out);
    return { bloom: 0.6, rgbSplit: 4 * tl.beatPulse(f.t) };
  }
}
```

### Time: the `Frame` (`f`)

| field | meaning |
|---|---|
| `f.t` | song time (s) — the only input; everything must be a function of it |
| `f.lt`, `f.p` | local time since the scene's cut start, and 0..1 progress through its window |
| `f.start`, `f.end` | the scene's cut window |
| `f.beat`, `f.bar` | continuous beat / bar index from the analysed grid (150.007 bpm, beat = 0.4 s) |
| `f.beatPhase`, `f.barPhase` | 0..1 within the beat / bar (0 = on it) |
| `f.a` | audio features: `rms low mid high vocal drums bass other` (0..1) and hit pulses `kick snare hat vonset` |
| `f.lyric` | lyric state (below) |
| `f.section` | `{ name, key, start, end, p }` — e.g. `Chorus 1` |
| `f.under`, `f.tin`, `f.tout` | transitions (below) |
| `f.dt`, `f.seeked`, `f.preroll` | for `stateful` scenes only |

### Helpers: `this.ctx.tl` (`Timeline`)

- Beat grid: `beat(t)`, `bar(t)`, `beatPhase(t)`, `barPhase(t)`, `beatInBar(t)` (0..3), `timeOfBeat(i)`,
  `timeOfBar(i)`, `snap(t, div)`, `floorGrid(t, div)`, `beatPeriod`.
- Pulses (1 on the event, halving every `halfLife` s): `beatPulse(t, halfLife = 0.08, div = 1)` (div 2 = 8ths),
  `barPulse(t)`, `pulseAt(t, times, halfLife)` for any list of times (e.g. word starts).
- Lyrics: `lyricState(t)` (= `f.lyric`), `wordTimes('C-', t0, t1)` (start times of matching words — case and
  punctuation are ignored: `'scroll'` matches `Scroll-`), `Timeline.wordState(word, t)`, `cut(lyric, nth, div)`.
- Sections and scenes: `section(t)`, `sectionByKey('chorus2')`, `sceneAt(t)`, `scene('s05')`, `transitionAt(t)`.
- Raw data: `this.ctx.lyrics` — `get('Two hundred K', nth)` → a line with `words[i].start/end`,
  `findWords('token')`, `lineAt(t)`, `cues('window')` (the sung "(window!)" calls from `extras`);
  `this.ctx.audio` — `beats`, `downbeats`, `env(name, t)`, `hit(kind, t)`, `events(kind, t0, t1)`.
  Find lyrics by content, never hard-code times.

### Lyric words: `f.lyric`

```ts
f.lyric.line      // Line on screen: sung now, held 1.2 s after it ends, or cued 0.25 s before it starts (or null)
f.lyric.singing   // t is inside line.start..line.end
f.lyric.words     // per word: { word, text, phase: 'future'|'active'|'sung', on (started), p (0..1 sung), since }
f.lyric.word      // the word being sung now (null between words)
f.lyric.lastWord  // the last word that started, anywhere in the song
f.lyric.next      // the next line
```

Stutters are separate tokens: `C-` `C-` `Context!`, `Scroll-` ×4, `O-` ×3 `Overflow!`. The words of
"User was kind — that's all I find" omit the dash (the line text keeps it). At 130.62 the singer sings
"Where do we—" (data/lyrics.json keeps the line as "Where did we", so find it with `get('Where did we')`).

### Shared modules (`src/shared/`)

- **lyric.ts** — `drawLyricLine(c, line, t, x, y, style)`: Unbounded 900 by default, bone words turn signal
  magenta when sung. Style: `family, size, tracking, base/active/sung colours, baseAlpha, mode: 'word'|'wipe',
  align, maxWidth (wraps), lineHeight, revealOnly`. Returns the layout: per-word boxes (`words[i].x/y/w`,
  `state`), `rows`, and `caret` (end of the last sung word). `layoutLyric()` measures without drawing.
- **counter.ts** — `new TokenCounter(tl).state(t)` → `{ value, text, mode: 'count'|'overflow'|'text', stepT, bump }`
  following BEATSHEET (0 → 200,000 on "K" → … → 999,999 at the Break → OVERFLOW → 1,000,000 → ∞ → NaN →
  0 at the outro; anchors at the top of the file). `drawCounter(c, x, y, state, t, style)` draws it anywhere
  (`size, align, ink, label, corruption, text`). The global HUD draws it top right by default
  (`COUNTER_POS` in `engine/hud.ts`); hide it with `post.counter = 0` when your scene stages it itself.
- **cursor.ts** — `drawCursor(c, x, baselineY, fontSize, t, tl, { on, period, duty, color, width, glow })`, a
  magenta ▌ drawn as a rectangle, blinking on the beat (`on: true` while typing). `cursorOn(t, tl)`.
- **chat.ts** — `drawChat(c, messages, t, tl, { x, y, w, h, scroll | autoScroll, header, input, size })`.
  Messages `{ role: 'system'|'user'|'assistant', text, t0, typeDur, pinnedAt, strike, alpha }` type in over
  `typeDur`, can be pinned (magenta pin) or struck through (0..1). Returns message rects and content height.
  `typed(text, t, t0, dur)` for your own typing.
- **hook.ts** — `HookScene`, the parametric hook for s05/s08/s14; `damage` comes from the timeline params
  (0 / 0.4 / 1). Magenta ground, ink Unbounded; `C-` syllables one at a time with a 1.06 zoom punch; the
  "(window!)" cue shrinks the frame to a window; "Token ×4" / "Two hundred K" fill the frame with the counter;
  damage adds ▒ glyphs, 1–2 frame offsets, RGB split and counter corruption. Subclass and override
  `drawLine`, `drawStutter`, `drawCounterFull`, `damageGlyphs`, `drawWindow`, `render`.
- **placeholder.ts** — the phase-1 placeholder (id, title, lyric, cursor, beat indicator).

### Drawing

- `Layer2D` (Canvas2D in logical 1920×1080 px, uploaded as an sRGB texture; 2–3 per scene at most),
  `FSPass(fragGLSL, uniforms)` (fullscreen shader; gets `GLSL_COMMON`: palette `C_INK C_BONE C_SIGNAL …`,
  noise, SDFs), `comp.draw(renderer, tex, out, { mode, opacity, tint, scale, offset })`, `makeRT()`,
  `LineBatch` (GPU line segments, 2D or 3D). For 3D scenes render your own `THREE.Scene` into `out`.
- Fonts (`engine/type.ts`): `F.display(800|900)` Unbounded, `F.mono(weight)` IBM Plex Mono,
  `F.oracle(weight)` Cormorant Garamond Italic; `font(family, px)`, `layout`, `glyphX`, `measure`, `fitSize`,
  `textPath2D` / `textPathCommands` (opentype.js outlines), `textPoints` (points filling the glyphs).
  Unbounded has no ▌ ▒ ∞ ✓: draw those with `F.mono()` or as shapes.
- Palette (`engine/palette.ts`, STYLE.md): `ink #0A0A0B`, `bone #EEE9DF`, `signal #FF2E88` (+ `signalDeep`,
  `signalHot` shades, greys `graphite`, `ash`, `ink2`, and `ok` — the one green ✓ of s07). `rgba('signal', a)` for
  Canvas2D, `LIN.signal` for GL (linear). One signal colour for the whole film.

### Post overrides (return from `render`)

`exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, halationTint, ca, rgbSplit, rgbSplitAngle,
grain, vignette, hud, counter, paper, counterText, counterCorruption, counterPos: [x, y], counterPlate, frame, fade,
flash, flashColor, shake: [x, y], zoom, invert`. `counterPos` moves the global counter (right edge, baseline);
`counterPlate` (0..1) puts an ink plate behind it for frames that are busy under the top-right corner (s06). Defaults in `engine/post.ts`. On the magenta ground return `paper: 1` (HUD in
ink) and a higher `bloomThreshold` (~1.3), or the whole frame blooms.

### Transitions

Each scene's `out` spec in `SCENES` describes the handover to the next (the BEATSHEET note is in `note`).
All are hard cuts for now (`kind: 'cut'`): the outgoing scene animates its exit before `f.end`, the next
starts on the cut. For an overlap set `{ kind: 'crossfade' | 'custom', beats: 2, align: 'before' | 'after' | 'center' }`:
both scenes then render over the overlap; with `crossfade` the engine mixes them, with `custom` the incoming
scene composites `f.under` (the outgoing frame, a texture) itself using `f.tin` (0→1), and the outgoing scene
sees `f.tout` (0→1). During the overlap `f.lt` is negative for the incoming scene and `f.p > 1` for the outgoing one.

### Rules

- Deterministic: no `Math.random()`, `Date.now()`, `performance.now()`. Use `mulberry32(seed)` / `hash(...)`
  (`engine/util.ts`). Per-frame flicker: seed with `frameIdx(t)`, not `Math.floor(t * 60)` (motion-blur
  sub-frames of one frame must agree).
- Sub-frames render out of order: no state carried between `render()` calls unless `stateful = true`
  (then reset in `reset()`; such scenes only export with a fixed `--samples`).
- Keep frames under ~25 ms; precompute in `init()`.
- Keep scene-specific code in the scene file (or `shared/` helpers when several scenes use it). `timeline.ts` owns the
  cut points; change anchors there, not in scenes.
