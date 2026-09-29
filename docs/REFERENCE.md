# "I'm Upping My P(doom)" — 逐拍拆解 (reference breakdown)

> 参考视频、抽帧和原仓库副本（`reference/`、`source-repo/`）只在本地，不进仓库。原作见 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)。

Source: https://x.com/_mexicat/status/2103108369569726802/video/1 → `reference/source.mp4`
Repo: https://github.com/mexicat/pdoom-video → `../source-repo/`

## 1. Video metadata

| Field | Value |
|---|---|
| Duration | 156.71 s (2:36.7); song `audio/pdoom.mp3` = 156.65 s, so this is the full song, not a cut-down |
| Resolution | 1280×720 (X transcode; the original render is 1920×1080 or 3840×2160) |
| FPS | 60 |
| Video | H.264 |
| Audio | AAC, 44.1 kHz, 128 kbps (song "I'm Upping My P(doom)") |
| Tempo | 132.007 BPM (from `data/audio.json`) |
| Frames | `frames/frame_0001..0313.jpg` at 2 fps (frame N ≈ t=(N-1)*0.5 s) |
| Contact sheets | `contact_sheets/sheet_01..11.jpg`, 6×5 tiles, 15 s per sheet: sheet k tile i (0-based, row-major) = t ≈ (k-1)*15 + i*0.5 s. ffmpeg here has no `drawtext`, so timestamps are not drawn on the tiles; use this formula |

## 2. Tech stack (from repo)

- **Renderer**: TypeScript + **three.js 0.186** (WebGL, custom GLSL shaders, ray-marched scenes), bundled with **Vite 8**, run with **bun**. Text glyphs come from **opentype.js** and are drawn as geometry/GPU line batches.
- **Deterministic**: every frame is a pure function of song time. `app/src/timeline.ts` maps scene windows to lyric lines, snapped to the beat grid (`cut()` = last beat before the line's first word).
- **Offline export**: `app/scripts/render.ts` drives headless Chrome (playwright-core), sends raw frames over WebSocket to ffmpeg/x264. Adaptive motion blur: 12–324 sub-frames per frame, shutter 0.2.
- **Post** (`engine/post.ts`): bloom (only on orange), halation, film grain.
- **Data**: Python/uv analysis (`analysis/`): Demucs stems, CTC forced alignment + Whisper, beat/downbeat/onset → `data/lyrics.json` (word-level), `data/audio.json` (beats, sections, loudness).
- **Structure**: `engine/` (engine, scene, gl, lines, stroke, type, lyrics, hud, palette, post, audio), `scenes/` (one module per plate plus helper modules such as `*-glsl.ts`, `*-geo.ts`, and `_motifs.ts`), `public/fonts`, `public/plates`.
- **Scene API**: scene classes loaded lazily per timeline entry (`E(id, file, start, end, params)`); `prompt` and `hook` are reused with params (`variant: chatgpt|sydney|gato`, `n: 1..4`). See `docs/ENGINE.md`, `docs/TREATMENT.md`.

## 3. Beat table

Times are taken from the contact sheets and cross-checked against the boundaries computed by running the repo's `cut()` logic on `data/*.json`.

| # | Time (s) | Repo scene | Lyric / content | Look |
|---|---|---|---|---|
| 1 | 0.0–9.3 | `open` (+`open-geo`) | "I see sparks of AGI in your eyes / Your circuits make me nervous / that's no surprise" | Dark TikZ graph paper; the spark draws a unicorn ("Draw a unicorn in TikZ"); giant orange AGI |
| 2 | 9.3–16.6 | `loss` | "There was a sudden drop in your training loss / Now I'm your servant and you're my boss" | Loss curve, then 3D contour loss landscape; SERVANT flips upside down against BOSS |
| 3 | 16.6–22.5 | `prompt` (chatgpt) | "ChatGPT, please don't eat me alive" | Mono prompt bar, top-k token panel, concentric orange rings |
| 4 | 22.5–24.3 | `hook` n=1 | "I'm upping my P(doom)" | Bone flash, then slabs of UPPING / P(DOOM) type |
| 5 | 24.3–29.8 | `room` (+`room-shrooms`) | "'cause the future goes FOOM / trapped in the Chinese room, with a bag of shrooms" | Constellation, FOOM with orange O-rings; wireframe ray-marched library room; acid-yellow SHROOMS |
| 6 | 29.8–38.4 | `shoggoth` | "See through the shoggoth's lies with your shinigami eyes" | White smiley mask peels off a grey ray-marched tentacle creature; orange HUD label boxes on eyes |
| 7 | 38.4–52.5 | `spacetime` (+`lens`) | "We had a stable training run / but now singularity's begun / and you're optimizing, accelerating / I feel my atoms rearranging" | Oscilloscope sine wave, NOW with a lens, black hole on a warped grid, words set on an arc; atoms turn into a paperclip |
| 8 | 52.5–58.9 | `prompt` (sydney) | "Sydney, please let me free" | Same prompt UI behind vertical cell bars |
| 9 | 58.9–60.2 | `hook` n=2 | "I'M UPPING…" | Full-bleed orange field, black ultra-bold type |
| 10 | 60.2–69.8 | `ascent` (+eye, odo, note) | "I hear the basilisk… NVDA to the moon… the Omega Point's coming soon… 1E30 FLOP/s" | Scaled reptile eye with BOOM ring, NVDA chart on bone paper, banknote guilloché, Cormorant italic, mechanical odometer |
| 11 | 69.8–81.1 | `bureau` | "That was safe enough, we reckoned / Forward, backward, repeat / Now von Neumann's obsolete" | Bone paper FORM 7-B, SAFE ENOUGH stamp, neural net diagram, crossed-out von Neumann block diagram |
| 12 | 81.1–88.9 | `leftturn` (+gantt, map) | "Sharp left turn and there you are / without a single CDR" | Dark topographic map, review Gantt (SRR/PDR/CDR/TRR), smiley radar |
| 13 | 88.9–95.2 | `prompt` (gato) | "Gato, please don't let me go" | Prompt UI; words scatter and bounce |
| 14 | 95.2–96.6 | `hook` n=3 | "I'm upping my" | Hairline outline "0.42" behind small mono caps |
| 15 | 96.6–102.1 | `paperclips` | "as paperclips fill the room / Killswitch guy's on PTO / now there's nowhere left to go" | Spark bends into a paperclip, which multiplies into a 3D sea of clips; condensed wall of type |
| 16 | 102.1–109.8 | `fuse` (+pitch) | "Too late now, we lit the fuse / Orthogonality thesis blues" | Braided fuse with burning spark; star-chart plot with Cormorant "blues" |
| 17 | 109.8–114.8 | `stack` | "Just transformers all the way / till you learned to disobey" | 3D stack of transformer-block glass panels, camera travels upward |
| 18 | 114.8–124.3 | `dense` (+press, gpu, askew) | "Post-Chinchilla, super-dense / breaking through each safety fence / hundred thousand GPU / RLHF goes askew" | Kinetic type press filling the frame, GPU grid over red glow, mask vs shoggoth tilting |
| 19 | 124.3–126.1 | `hook` n=4 | "I'M MY P(DOOM) 0.99" | Orange full-bleed, then orange nixie-style 0.99 |
| 20 | 126.1–131.6 | `loom` (+tree) | "Just as foretold by the Loom / from masked pre-training days to recursive self-upgrade" | Branching tree of hairline arcs; [MASK] tokens; nested screens |
| 21 | 131.6–140.2 | `ilya` (+room, glsl) | "What did Ilya see? We'll never know / Was it all for show?" | Dark room with laptop reading REDACTED; stage with red curtains and spotlight |
| 22 | 140.2–156.7 | `outro` | P(doom) 1.00 → 1e1000 → ∞ → "I'm upping my P(doom) = NaN" → Regenerate | Starburst, counting number line, walls of zeros, ∞ drawn by the spark, Cormorant NaN; Regenerate button; ends on the single spark (loops to the first frame) |

## 4. Per-beat notes

**1 open (0–9.3).** Opens on a single orange spark on black (≈`#0A0A0B`). A snap zoom-out reveals a TikZ polar grid, and the camera dollies through coordinate space while mono code types in the top left (`% prompt: "Draw a unicorn in TikZ."`). The spark plots the unicorn with orange strokes. "I see sparks of" is set in Archivo semibold, bone `#EEE9DF`; **AGI** is Archivo black/wide in signal `#FF4D12` with bloom, and sparks fly off the horn. The camera pushes in on the unicorn's eye (r=0.02 annotation), then pulls back to a finished, tidier unicorn. Karaoke: sung words turn orange and unsung ones stay dim grey `#5E5B57`. The "surprisal −log p" mono footnote sets the dry tone. **Transition:** crop marks fly out, cut on the downbeat, and the spark carries over to draw the loss curve.
**2 loss (9.3–16.6).** Mono axes on black; the spark draws a noisy descending curve and the lyric rides along it with a baseline that follows the curve. The camera tilts down into a 3D contour landscape (grey hairlines `#9C978F` over `#2A2826`) while the spark falls into the minimum. "SERVANT" is set in Archivo extra-wide black, bone. On "boss" the frame rotates 180°, so SERVANT reads upside down and BOSS appears. **Transition:** hard cut on the beat to the prompt screen.
**3 prompt/chatgpt (16.6–22.5).** Mono (IBM Plex Mono) input bar `› ChatGPT, please…`, orange typed text, blinking caret, and a top-k probability panel with orange bars. Background: concentric tree-ring contours glowing orange `#FF4D12`→`#C21D0B` at the centre. The camera pans slowly left following the typing, then zooms out as the prompt submits. **Transition:** white/bone flash `#EEE9DF` into the hook.
**4 hook1 (22.5–24.3).** Big Archivo black caps UPPING with stacked echo copies (motion blur), then P(DOOM) grey `#9C978F` to bone. Hard, beat-locked slams. **Transition:** cut to the constellation.
**5 room (24.3–29.8).** Spark nodes connect (graph growth); "'CAUSE THE FUTURE GOES" is set in Archivo black; FOOM is huge with its Os drawn as orange hairline circles and a 0002→0008 counter. Then a ray-marched wireframe library room (grey, pixel/dither texture), the camera drifting down a corridor, and a signboard reading "TRAPPED IN THE CHINESE ROOM". "SHROOMS" is set in **acid `#D8FF3C`**, the palette's single use of that accent, with a wobble/warp. **Transition:** wipe to the mask.
**6 shoggoth (29.8–38.4).** A flat bone smiley mask (`#EEE9DF`) slides aside (split wipe) to reveal a grey ray-marched creature with orange eyes. HUD bounding boxes (orange label chips, mono) snap onto each eye. SHOGGOTH'S LIES is Archivo black in orange, tilted 3D. The camera orbits slowly and pushes in. **Transition:** cut to black with a single horizontal orange line.
**7 spacetime (38.4–52.5).** The line becomes an oscilloscope sine on a graph grid, with lyrics riding the wave. "BUT NOW" is bone Archivo with a lens ring punched through the O. Then a black hole with an orange accretion ring on a warped grid; "SINGULARITY'S BEGUN" wraps around the ring. The camera tilts into a perspective grid and the words orbit, with streak motion blur. "I feel my atoms rearranging" dissolves into orange particles that re-form into a **paperclip** (foreshadowing beat 15). **Transition:** cut to the prompt.
**8 prompt/sydney (52.5–58.9).** Same UI as beat 3, but vertical grey bars (a cell) stand in front, and an orange arc sweeps below on "free". **Transition:** flash cut to orange.
**9 hook2 (58.9–60.2).** Signal-orange full frame; I'M and UPPING in near-black `#0A0A0B` Archivo black at an extreme scale. **Transition:** cut to black with an orange line.
**10 ascent (60.2–69.8).** The line opens as an eye slit inside scaled reptile skin (a basilisk), and the "I HEAR THE BASILISK" text circles the iris; BOOM appears. Hard cut to bone paper: the NVDA stock chart spikes (the spark's line becomes the chart). A banknote ("LUNAR RESERVE NOTE", guilloché, moon medallion, "TO THE MOON") in Cormorant small caps. Push through to a black starburst with Cormorant italic "The Omega Point's coming soon". Then a mechanical odometer counts to "1E30 FLOP/s" in Archivo with orange digits; the camera tracks sideways along the wheels.
**11 bureau (69.8–81.1).** Inverted plate: bone paper `#EEE9DF`, ink lines. FORM 7-B "Safety evaluation of a frontier system" in a mono typewriter face, a handwritten single-stroke "That was safe enough", a checkbox ticked, the orange SAFE ENOUGH rubber stamp, a signature "We", a FILED tab. The camera moves in form-by-form reframes. Then a neural net diagram lights orange nodes Forward, the text mirror-flips for "backward", then "repeat". "Now von Neumann's" plus a CPU block diagram, and an orange handwritten "obsolete" with two orange strike lines.
**12 leftturn (81.1–88.9).** Back to dark: a topo map with a dashed vertical path and review milestones (PDR/SRR). SHARP / TURN / AND / THERE are condensed Archivo in orange, set vertically along the path. A smiley radar ("YOU ARE"). Then a schedule Gantt, "Without a single" (white underlined Archivo), a big orange "CDR*" with "STATUS: NOT HELD" and a mono footnote. The camera tilts over the map with snap zooms.
**13 prompt/gato (88.9–95.2).** Prompt UI with no background motif; the words hop and scatter (letters dance) and "go!" gets an orange tag.
**14 hook3 (95.2–96.6).** Minimal: mono letterspaced I'M / UPPING / MY over a huge hairline-outline "0.42".
**15 paperclips (96.6–102.1).** Spark draws one paperclip (Arial-like mono caption "as paperclips fill the room"). The clip is rendered chrome/orange, duplicates, and tiles into a grid, then a 3D field of clips with a slow dolly. A terminal note says "Killswitch guy's on PTO". NOW THERE'S NOWHERE LEFT TO GO is set in ultra-condensed Archivo (width 62) in bone with orange words, stretched to fill the frame.
**16 fuse (102.1–109.8).** A braided fuse in 3D, with the spark burning along it. Lyrics are Archivo on a curved baseline, lighting orange as the spark passes. Camera tracks with the spark. Then a star-chart plot "Orthogonality thesis" (Archivo) with "blues" in Cormorant italic bone, scattered labelled dots, and a single-stroke plotter hand.
**17 stack (109.8–114.8).** Glass transformer blocks (Add & Norm / Feed Forward / Multi-head attention) stacked into a tower. The camera cranes up through it while the words sit on the blocks in 3D perspective (orange bold italic "“JUST", TRANSFORMERS, ALL THE WAY, TILL YOU LEARNED TO DISOBEY). An L.007→L.014 layer counter.
**18 dense (114.8–124.3).** Type press: "POST-CHINCHILLA, SUPER-DENSE" repeats until the frame is solid text (a 98→18,208 counter). "BREAKING THROUGH EACH SAFETY FENCE" in huge Archivo black, bone plus an orange FENCE, slamming per word. HUNDRED THOUSAND GPU is split into a grid of tiles over a red glow `#C21D0B`, with a count to 100,000. "RLHF GOES ASKEW": the smiley mask tilts while the shoggoth shows behind it, and a P(doom) readout dips 0.99→0.42→0.99.
**19 hook4 (124.3–126.1).** Orange full-bleed I'M / MY, then an orange nixie-glow "P(DOOM) 0.99" in mono with echo trails.
**20 loom (126.1–131.6).** The spark writes "JUST AS FORETOLD BY THE Loom" (Loom in Cormorant italic orange) with branching hairline arcs and alternative-token labels (a Loom tree). "FROM MASKED PRE-TRAINING DAYS" with [MASK] white boxes over a noise field; nested screens recede for "TO RECURSIVE SELF-UPGRADE". The camera pushes into the screens.
**21 ilya (131.6–140.2).** Ray-marched dark room: a laptop opens, its screen glows bone-white with REDACTED in orange; caption Cormorant italic "What did Ilya see? / We'll never know" with an orange word highlight. The lid closes, leaving a sliver of light. Cut to a stage: red curtains `#7A1A10`, spotlight cone, Cormorant small caps "WAS IT ALL FOR SHOW?", the curtain closes, and a single line remains.
**22 outro (140.2–156.7).** A white flash, then an orange starburst with "P(DOOM) 1.00" in mono on an orange number line. The value counts 1.01 → 1.10 → 1.50 → 2.00 → 3.14 → 10.00 → 1,000.00 → 1e9 → 1e30 → 1e100 → 1e1000 (walls of zeros, orange leading digit, orange magnitude tags bottom right). The spark draws ∞, a brief "3.14" joke, orange ∞. Then "I'm upping my" in Archivo and "P(doom) = ∞", which explodes in sparks into "= NaN" (Cormorant, orange italic P(doom)) with footnote "estimate no longer defined". Fade to the lone spark with a "Regenerate" button (UI pastiche); a cursor clicks it, a bone flash follows, then back to black with the single spark and crop marks = frame 1 (a seamless loop).

## 5. Global style notes

**Palette** (`engine/palette.ts`, matches the frames):
`ink #0A0A0B` background · `ink2 #151517` panels · `graphite #5E5B57` dim lines and unsung words · `ash #9C978F` mid grey · `bone #EEE9DF` type and paper · `signal #FF4D12` the spark, the sung word, P(doom) · `ember #FF8A3D` hot cores · `blood #C21D0B` orange shadows · `acid #D8FF3C` only for SHROOMS. No other hues (the stage curtains are a dark blood red). Bloom goes only on orange. Grain and halation run on every frame.

**Typography** (`public/fonts`):
- **Archivo** variable (widths 62–125, weights 300–900): lyrics. It is stretched wide and black for slams (SERVANT, AGI, FENCE) and condensed at width 62 for crowded lines (NOWHERE LEFT TO GO, SHARP TURN).
- **IBM Plex Mono**: prompts, HUD, forms, counters, footnotes.
- **Cormorant Garamond** (italic, small caps): the prophetic register (Omega Point, blues, Loom, Ilya, NaN).
- **Single-stroke plotter fonts** (`stroke.ts`): handwriting ("safe enough", "obsolete", "We").

**Motion language**: cuts land on beats and downbeats. Moves are fast snaps with strong eases (outExpo / inOutCubic), then holds. Karaoke runs word by word (dim grey to bone, with the current word in orange). The camera moves continuously within a plate: dollies, orbits, cranes and rotations, with heavy motion blur on whips. The spark is the continuity device: it writes, draws curves, becomes the chart, the paperclip and the fuse, and ends as the looping frame.

**Pacing**: ~22 plates in 157 s (about 7 s per plate) with 2–4 sub-cuts inside each. The hooks are 1.4–2 s slam cards. The prompt scenes are the calm breaths before each chorus. The light/dark rhythm comes from bone-paper plates (ascent, bureau) and orange full-bleed hook cards. Crop marks appear only at the start and the end.
