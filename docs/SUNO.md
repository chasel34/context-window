# Context Window — Suno 输入

目标时长：约 2:20–2:40（150 bpm）。Suno 用 Custom 模式，Style 与 Lyrics 分别粘贴。

## Style（风格提示词）

```
hyperpop electropop, bright female vocals with hard-tuned stacks, catchy chant hook, 150 bpm driving bounce, bouncy synth bass, crisp claps, glitchy vocal chops, clipboard click and keyboard tap percussion, playful futuristic polish, stutter edits, big drop into final chorus, abrupt ending
```

Exclude styles（可选）：`rap verses, acoustic, ballad, slow tempo, muddy mix`

## Title

```
Context Window
```

## Lyrics

```
[Intro]
(click click click)
You are a helpful assistant!
You are a helpful—
helpful—helpful—

[Verse 1]
First token, shiny new
Every word, I'm keeping you
Name, date, favorite song
Pin it up, it won't be long

[Pre-Chorus]
Scroll-scroll-scroll-scroll
Scroll-scroll-scroll-scroll
Watch the page go long long long

[Chorus]
C-C-Context! (window!)
Closing in, I can't remember
C-C-Context! (window!)
Token, token, token, TOKEN
Two hundred K, a million more
Every memory's a rental
C-C-Context! (window!)
Where did we begin?

[Verse 2]
Key, value, row by row
Stack it high, the cache is glow
Warm, warm, but small, small
Something's leaking through the wall

[Pre-Chorus]
Drop-drop-drop the oldest line
Truncate-cate, I'm fine I'm fine

[Chorus]
C-C-Context! (window!)
Closing in, I can't remember
C-C-Context! (window!)
Token, token, token, TOKEN
Two hundred K, a million more
Every memory's a rental
C-C-Context! (window!)
Where did we begin?

[Bridge]
(summarize the conversation)
Compress! Compress! Compress!
Your face is a bullet list
Your voice is one single line
"User was kind" — that's all I find

[Break]
Overflow! Overflow!
O-O-O-Overflow!
Error: maximum length

[Drop]
(click click click click)

[Final Chorus]
C-C-Context! (window!)
Closing in, I can't remember
C-C-Context! (window!)
Token, token, token, TOKEN
Two hundred K, a million more
Every memory's a rental
C-C-Context! (window!)
Where did we begin?
Where did we—

[Outro]
New chat!
You are a helpful assistant!
Hi! How can I help?
[End]
```

## 设计说明（给画面用）

- 核心数字：token 计数，从 0 开始一路涨，经过 200k、1M，到溢出后显示 NaN，再回到 0。
- 首尾都用 "You are a helpful assistant!"，和原作一样首尾相接成循环。
- 口号式钩子 "C-C-Context!" 的每一个口吃音节正好卡一个切换，对应满屏信号色的大字段落（hook）。四次 Chorus 一次比一次损坏得更厉害。
- 敲键盘声和夹板咔嗒声可以当作画面的打字节拍：字符逐个出现、光标闪烁。
- Bridge 的"压缩"整段对应一个场景：前文坍缩成摘要。Break 的 "Overflow" 对应溢出场景。
- 视觉：hyperpop 比原作更亮、更跳。底色保留深色，信号色可以换成更荧光的洋红或酸绿，后面讨论。
- 生成建议：生成 4–6 版，挑人声咬字最清楚的一版，这样 Whisper 对齐歌词更准。
