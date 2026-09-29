# Third-party code and assets

## mexicat/pdoom-video (MIT)

The renderer architecture and much of the engine code are adapted from
[mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) ("I'm Upping My P(doom)" music video),
adapted from commit `bdbad53`. Adapted files carry a header comment saying so:

- `app/src/engine/`: `engine.ts`, `gl.ts`, `scale.ts`, `post.ts`, `glsl/common.ts`, `util.ts`, `audio.ts`,
  `lyrics.ts`, `lines.ts`, `scene.ts`, `type.ts`, `hud.ts` (palette values, fonts, counter HUD, RGB split,
  fractional preview scale, transition windows are ours)
- `app/src/main.ts`, `app/scripts/render.ts`, `app/index.html`, `app/vite.config.ts`
- `analysis/`: `align.py`, `analyze.py`, `common.py` (alignment and beat analysis pipeline)

Changes: new palette (docs/STYLE.md), fonts, token counter instead of P(doom), timeline/transition API,
lyric/cursor/chat/hook modules, 0.5× preview scale, render CLI (`--preview`, `--scene`, default 4 samples).

License text of the original:

```
MIT License

Copyright (c) 2026 Giacomo Magnanini

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts (SIL Open Font License 1.1)

Downloaded from Google Fonts into `public/fonts/` (static instances); license texts alongside:

- Unbounded — `public/fonts/Unbounded-OFL.txt`
- IBM Plex Mono — `public/fonts/IBMPlexMono-OFL.txt`
- Cormorant Garamond — `public/fonts/CormorantGaramond-OFL.txt`

## Simplex noise

`src/engine/glsl/common.ts` includes the GLSL simplex noise by Ashima Arts / Stefan Gustavson (MIT).
