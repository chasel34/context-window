# Context Window — music video

一支用代码渲染的歌词 MV。歌是一首关于大模型上下文窗口的 hyperpop（150 bpm），画面由 TypeScript + three.js 实时生成，歌词逐词对齐到人声。每一帧都只由歌曲时间 `t` 决定，所以浏览器里的实时预览和离线导出的 1080p60 视频是同一套画面。

**在线预览：** https://chasel34.github.io/context-window/ （按空格播放，需要能跑 WebGL2 的浏览器）

这是对 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)（"I'm Upping My P(doom)" MV）的复刻练习：沿用它的渲染架构和对齐流程，换了一首歌、一套视觉系统和 16 个新场景。致谢见[下文](#致谢)。

整个项目是在 Claude Code 里和 Claude 一起做的：拆解参考片、写歌、歌词对齐、节拍分析、渲染器和每个场景。

## 目录

| 路径 | 内容 |
|---|---|
| `app/` | 渲染器（TypeScript + three.js，bun + Vite）。`src/engine/` 核心，`src/scenes/` 每个场景一个文件，`src/timeline.ts` 剪辑点，`scripts/render.ts` 离线导出 |
| `analysis/` | Python（uv）分析脚本：Demucs 分轨、CTC 强制对齐 + Whisper 校对、节拍 / 段落 / 起音分析 |
| `data/` | 分析结果：`lyrics.json`（逐词时间）、`audio.json`（节拍、包络）、`sections.json`（段落） |
| `song/context-window.mp3` | 歌曲（预览用；导出时如有同目录的 WAV 会优先用 WAV） |
| `docs/` | 设计和技术文档，见下 |

文档：

- [`docs/BEATSHEET.md`](docs/BEATSHEET.md)：16 个场景的节拍表和镜头设计
- [`docs/STYLE.md`](docs/STYLE.md)：配色和字体
- [`docs/ENGINE.md`](docs/ENGINE.md)：渲染器命令、场景 API、时间轴和后期参数
- [`docs/SUNO.md`](docs/SUNO.md)：生成这首歌用的 Suno 风格提示词和歌词
- [`docs/REFERENCE.md`](docs/REFERENCE.md)：对原作 MV 的逐拍拆解
- [`docs/style-picker.html`](docs/style-picker.html)：早期挑配色和字体用的页面

## 运行

需要 [bun](https://bun.sh)。离线导出还需要 Google Chrome 和带 libx264 的 ffmpeg；分析脚本需要 [uv](https://docs.astral.sh/uv/)。

```sh
cd app
bun install
bun run dev        # http://localhost:5173
```

预览快捷键：空格播放/暂停，←/→ 跳 1 秒，`[` `]` 切场景，`l` 循环当前场景，`h` 隐藏界面。URL 参数 `?t=32.5` 从指定时间开始，`?scene=s05` 从指定场景开始。

导出视频：

```sh
cd app
bun run render --preview                          # 960x540 30fps 小样
bun run render --samples auto --shutter 0.2       # 1920x1080 60fps，自适应运动模糊
```

输出在 `out/`。完整参数见 [`docs/ENGINE.md`](docs/ENGINE.md)。

## 致谢

- **原作：** [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video)，Giacomo Magnanini 为 "I'm Upping My P(doom)" 做的代码渲染 MV（[YouTube](https://www.youtube.com/watch?v=5EoO5413dBY)）。本项目的渲染器架构（按歌曲时间确定性渲染、后期管线、headless Chrome 逐帧导出）、大部分引擎代码和歌词对齐 / 音频分析流程都改编自它，MIT 许可。改编过的文件在文件头注明，清单和原许可证全文见 [`LICENSE-THIRD-PARTY.md`](LICENSE-THIRD-PARTY.md)。原作的节拍拆解见 [`docs/REFERENCE.md`](docs/REFERENCE.md)。
- **原作的歌：** "I'm Upping My P(doom)"，歌词由 osmarks 等人创作，原作使用的是 deckard 发布的 Suno 版本。本仓库不包含这首歌，详见原仓库的 Credits。
- **本片的歌：** "Context Window"，用 Suno 生成，提示词和歌词见 [`docs/SUNO.md`](docs/SUNO.md)。
- **字体：** Unbounded、IBM Plex Mono、Cormorant Garamond，均为 SIL Open Font License，许可证随字体放在 `app/public/fonts/`。

## 许可

代码使用 [MIT 许可](LICENSE)；改编自 pdoom-video 的部分同时保留其原始 MIT 声明（[`LICENSE-THIRD-PARTY.md`](LICENSE-THIRD-PARTY.md)）。字体沿用各自的许可。歌曲音频和歌词不在 MIT 许可范围内。
