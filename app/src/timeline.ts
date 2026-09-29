// The edit (BEATSHEET.md) and the time helpers every scene uses.
//
// - SCENES: the 16 scenes with the BEATSHEET's start times, each boundary snapped to the beat grid
//   of data/audio.json (or anchored to a sung word / a section downbeat from data/sections.json).
// - Timeline: pure functions of song time t: beat(t), bar(t), phases, beat pulses, section lookup,
//   per-word lyric state, scene lookup and transitions.
//
// Nothing here reads a clock: every value is a function of t and the analysed data.
import type { SceneClass, PostOverrides } from './engine/scene';
import type { AudioData } from './engine/audio';
import type { Lyrics, Line, Word } from './engine/lyrics';

// ------------------------------------------------------------------------------------------ types

export interface SectionsJSON {
  bpm: number;
  beat_period: number;
  sections: { name: string; key: string; start: number; end: number; bars: [number | null, number | null]; first_word: number; last_word: number }[];
}

export interface SectionInfo {
  /** Display name ('Chorus 1') and key ('chorus1'). */
  name: string;
  key: string;
  start: number;
  end: number;
  /** 0..1 progress through the section. */
  p: number;
}

/**
 * How a scene hands over to the next one.
 * - 'cut' (default): hard cut at the boundary, no overlap.
 * - 'crossfade': both scenes render over an overlap of `beats` beats and the engine mixes them.
 * - 'custom': both render over the overlap and the INCOMING scene composites `f.under` (the outgoing
 *   frame) itself, using `f.tin` 0→1. The outgoing scene sees `f.tout` 0→1.
 * The overlap sits `before` the cut (default: the transition lands on the downbeat), `after` it, or
 * `center`ed on it. The cut time itself (entry.end / next entry.start) never moves.
 */
export interface TransitionSpec {
  kind: 'cut' | 'crossfade' | 'custom';
  beats?: number;
  align?: 'before' | 'after' | 'center';
  /** What BEATSHEET.md asks for (scene authors implement it inside their scenes). */
  note?: string;
}

export interface TimelineEntry {
  /** 's01'..'s16'. */
  id: string;
  /** Scene module file in src/scenes/ (without .ts). */
  file: string;
  title: string;
  /** Song section the scene belongs to (BEATSHEET). */
  section: string;
  /** Cut window (song seconds, beat-snapped). Frame.lt / Frame.p are relative to it. */
  start: number;
  end: number;
  /** Active window: the cut window widened by transition overlaps. */
  activeStart: number;
  activeEnd: number;
  transitionIn: TransitionSpec;
  transitionOut: TransitionSpec;
  /** Lazy module loader; the module's default export is the Scene class. */
  load: () => Promise<{ default: SceneClass }>;
  /** Default post overrides for this entry (the scene's own overrides win). */
  post?: PostOverrides;
  /** Free-form params handed to the scene as ctx.params. */
  params?: Record<string, any>;
  /** Cap on adaptive motion-blur sub-frames while this entry is on screen. */
  maxSamples?: number;
}

export type WordPhase = 'future' | 'active' | 'sung';

export interface WordState {
  word: Word;
  /** Display text of the word (typographic quotes). */
  text: string;
  /** 'future' before its start, 'active' while sung, 'sung' after its end. */
  phase: WordPhase;
  /** true once the word has started (active or sung): the word is magenta from here on. */
  on: boolean;
  /** 0..1 sung progress (karaoke wipe). */
  p: number;
  /** Seconds since the word started (negative before). */
  since: number;
}

export interface LyricState {
  /** The line on screen: being sung, or held for a moment after it ends, or cued just before it starts. */
  line: Line | null;
  /** true while t is inside line.start..line.end. */
  singing: boolean;
  /** Per-word state of `line`. */
  words: WordState[];
  /** The word being sung right now (null between words). */
  word: Word | null;
  /** The last word that started at or before t (anywhere in the song). */
  lastWord: Word | null;
  /** The next line to start after t. */
  next: Line | null;
  /** 0..1 progress through `line` (by time). */
  lineP: number;
}

export interface TransitionState {
  from: TimelineEntry;
  to: TimelineEntry;
  kind: TransitionSpec['kind'];
  /** 0..1 progress through the overlap. */
  k: number;
  start: number;
  end: number;
}

// ------------------------------------------------------------------------------------------ the edit

// Scene modules are discovered lazily so a missing/broken scene never breaks the build.
const modules = import.meta.glob<{ default: SceneClass }>('./scenes/*.ts');
const loader = (file: string) => () => {
  const m = modules[`./scenes/${file}.ts`];
  return m ? m() : Promise.reject(new Error(`scene module not found: scenes/${file}.ts`));
};

/**
 * How a scene boundary is placed:
 * - { section: key }       the section's first downbeat from data/sections.json
 * - { cut: lyric, nth, div } the last grid point at/before the first word of that lyric line (never cuts a word)
 * - { snap: seconds, div }   the grid point nearest a BEATSHEET time
 * div: 1 = beat grid (default), 2 = eighth notes.
 */
type Anchor = { at: 0 } | { section: string } | { cut: string; nth?: number; div?: number } | { snap: number; div?: number };

interface SceneDef {
  id: string;
  file: string;
  title: string;
  section: string;
  /** BEATSHEET start (s), for reference/verification only. */
  sheet: number;
  anchor: Anchor;
  /** Transition into the next scene. */
  out: TransitionSpec;
  params?: Record<string, any>;
  post?: PostOverrides;
}

export const SCENES: SceneDef[] = [
  { id: 's01', file: 's01_boot', title: 'boot', section: 'Intro', sheet: 0.0, anchor: { at: 0 },
    out: { kind: 'cut', note: '硬切（卡在第一句歌词上）' } },
  // "You" is sung at 3.58, 13 ms before the 8th-note 3.593 and 0.21 s after beat 3.393: cut on the 8th note
  { id: 's02', file: 's02_system', title: 'system', section: 'Intro', sheet: 3.6, anchor: { cut: 'You are a helpful assistant!', div: 2 },
    out: { kind: 'cut', note: '文字折叠成一行，被推到画面顶端，成为第一条消息' } },
  { id: 's03', file: 's03_first_token', title: 'first token', section: 'Verse 1', sheet: 14.6, anchor: { section: 'verse1' },
    out: { kind: 'cut', note: '镜头开始向下滚动' } },
  { id: 's04', file: 's04_scroll', title: 'scroll', section: 'Pre-Chorus 1', sheet: 27.4, anchor: { section: 'pre1' },
    out: { kind: 'cut', note: '竖条收拢成一个光标，然后爆开成满屏洋红' } },
  { id: 's05', file: 's05_hook1', title: 'hook1', section: 'Chorus 1', sheet: 32.2, anchor: { section: 'chorus1' },
    out: { kind: 'cut', note: '窗口框缩小，退回界面，露出下面的缓存' }, params: { damage: 0 } },
  { id: 's06', file: 's06_kv_cache', title: 'KV cache', section: 'Verse 2', sheet: 49.8, anchor: { section: 'verse2' },
    out: { kind: 'cut', note: '墙倾斜，变成一张俯视的表格' } },
  { id: 's07', file: 's07_truncate', title: 'truncate', section: 'Pre-Chorus 2', sheet: 56.2, anchor: { section: 'pre2' },
    out: { kind: 'cut', note: '光标爆开，切到满屏洋红' } },
  { id: 's08', file: 's08_hook2', title: 'hook2', section: 'Chorus 2', sheet: 61.0, anchor: { section: 'chorus2' },
    out: { kind: 'cut', note: '画面整体被"选中"，高亮成蓝色，然后被压缩' }, params: { damage: 0.4 } },
  { id: 's09', file: 's09_compress', title: 'compress', section: 'Bridge', sheet: 75.4, anchor: { section: 'bridge' },
    out: { kind: 'cut', note: '压扁的一行展开成列表' } },
  // "Your" is sung at 78.16, 29 ms before beat 78.189: cut on the 8th note before it
  { id: 's10', file: 's10_bullet_list', title: 'bullet list', section: 'Bridge', sheet: 78.2, anchor: { cut: 'Your face is a bullet list', div: 2 },
    out: { kind: 'cut', note: '镜头推进到剩下的唯一一行' } },
  // beat 84.589 would clip "line" (ends 84.68): the 8th note 84.789 sits between the two lines
  { id: 's11', file: 's11_oracle', title: 'oracle', section: 'Bridge', sheet: 84.7, anchor: { snap: 84.7, div: 2 },
    out: { kind: 'cut', note: '计数器突然回到画面，跳成 999,999' }, post: { counter: 0 } },
  { id: 's12', file: 's12_overflow', title: 'overflow', section: 'Break', sheet: 88.2, anchor: { section: 'break' },
    out: { kind: 'cut', note: '对话框被点掉，画面全黑' } },
  { id: 's13', file: 's13_keystorm', title: 'keystorm', section: 'Drop', sheet: 99.4, anchor: { section: 'drop' },
    out: { kind: 'cut', note: '在 113.8 秒的重拍上硬切到满屏洋红' } },
  { id: 's14', file: 's14_hook3', title: 'hook3', section: 'Final Chorus', sheet: 113.8, anchor: { section: 'chorus_final' },
    out: { kind: 'cut', note: '坍缩成一个点' }, params: { damage: 1 } },
  { id: 's15', file: 's15_where_did_we', title: 'where do we—', section: 'Final Chorus', sheet: 130.6, anchor: { cut: 'Where did we', nth: 3 },
    out: { kind: 'cut', note: '"New chat!" 时硬切' } },
  // hard cut on "New chat!" (sung 132.76): the 16th at/before the word (132.687), not the outro downbeat 132.987
  { id: 's16', file: 's16_new_chat', title: 'new chat', section: 'Outro', sheet: 132.76, anchor: { cut: 'New chat!', div: 4 },
    out: { kind: 'cut', note: '回到第 1 场' } },
];

// ------------------------------------------------------------------------------------------ helpers

export class Timeline {
  scenes: TimelineEntry[] = [];
  readonly beatPeriod: number;
  readonly duration: number;

  constructor(public audio: AudioData, public lyrics: Lyrics, public sectionsData: SectionsJSON) {
    this.duration = audio.duration;
    const b = audio.beats;
    this.beatPeriod = b.length > 1 ? (b[b.length - 1]! - b[0]!) / (b.length - 1) : 60 / audio.bpm;
    this.scenes = this.build();
  }

  // ---- beat grid -------------------------------------------------------------------------------

  /** Continuous beat index (0 at the first analysed beat, fractional between beats). */
  beat(t: number) { return this.audio.beatAt(t); }
  /** Continuous bar index (0 at the first downbeat). */
  bar(t: number) { return this.audio.barAt(t); }
  /** 0..1 phase within the current beat (0 = on the beat). */
  beatPhase(t: number) { const b = this.beat(t); return b - Math.floor(b); }
  /** 0..1 phase within the current bar (0 = on the downbeat). */
  barPhase(t: number) { const b = this.bar(t); return b - Math.floor(b); }
  /** Beat within the bar: 0..3 (0 = downbeat). */
  beatInBar(t: number) { return Math.floor(this.barPhase(t) * 4 + 1e-6) % 4; }
  /** Time of (fractional) beat index i, and of bar index i. */
  timeOfBeat(i: number) { return this.audio.timeOfBeat(i); }
  timeOfBar(i: number) {
    const d = this.audio.downbeats;
    const p = this.beatPeriod * 4;
    if (i <= 0) return d[0]! + i * p;
    if (i >= d.length - 1) return d[d.length - 1]! + (i - (d.length - 1)) * p;
    const k = Math.floor(i);
    return d[k]! + (d[k + 1]! - d[k]!) * (i - k);
  }
  /** Nearest grid point: div 1 = beats, 2 = 8th notes, 4 = 16ths, 0.25 = bars. */
  snap(t: number, div = 1) { return this.timeOfBeat(Math.round(this.beat(t) * div) / div); }
  /** Last grid point at or before t (+ tol). */
  floorGrid(t: number, div = 1, tol = 0.02) { return this.timeOfBeat(Math.floor(this.beat(t + tol) * div + 1e-6) / div); }
  /** Seconds since the last beat (div: subdivisions, 2 = 8ths). */
  sinceBeat(t: number, div = 1) { const b = this.beat(t) * div; return (b - Math.floor(b)) * this.beatPeriod / div; }
  /**
   * Decaying pulse on every beat: 1 on the beat, halving every `halfLife` seconds.
   * div 2 pulses on 8ths; div 0.25 on downbeats (see barPulse).
   */
  beatPulse(t: number, halfLife = 0.08, div = 1) {
    const s = this.sinceBeat(t, div);
    return t < this.timeOfBeat(0) ? 0 : Math.pow(0.5, s / halfLife);
  }
  /** Decaying pulse on every downbeat. */
  barPulse(t: number, halfLife = 0.15) {
    const b = this.bar(t);
    if (b < 0) return 0;
    const s = (b - Math.floor(b)) * this.beatPeriod * 4;
    return Math.pow(0.5, s / halfLife);
  }
  /** Decaying pulse after the most recent of `times` (e.g. word starts); 0 before the first. */
  pulseAt(t: number, times: number[], halfLife = 0.1) {
    let last = -Infinity;
    for (const x of times) if (x <= t && x > last) last = x;
    return last === -Infinity ? 0 : Math.pow(0.5, (t - last) / halfLife);
  }

  // ---- sections --------------------------------------------------------------------------------

  section(t: number): SectionInfo {
    const ss = this.sectionsData.sections;
    const s = ss.find((x) => t >= x.start && t < x.end) ?? (t < ss[0]!.start ? ss[0]! : ss[ss.length - 1]!);
    return { name: s.name, key: s.key, start: s.start, end: s.end, p: Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start))) };
  }
  sectionByKey(key: string) {
    const s = this.sectionsData.sections.find((x) => x.key === key);
    if (!s) throw new Error(`section not found: ${key}`);
    return s;
  }

  // ---- lyrics ----------------------------------------------------------------------------------

  static wordState(w: Word, t: number): WordState {
    const phase: WordPhase = t < w.start ? 'future' : t < w.end ? 'active' : 'sung';
    const p = t <= w.start ? 0 : t >= w.end ? 1 : (t - w.start) / Math.max(1e-3, w.end - w.start);
    return { word: w, text: w.w, phase, on: t >= w.start, p, since: t - w.start };
  }

  /**
   * Lyric state at t. The line on screen is the one being sung; in the gap after it, it is held for
   * `hold` s (or until the next line is `lead` s away); the next line is cued `lead` s early.
   */
  lyricState(t: number, hold = 1.2, lead = 0.25): LyricState {
    const L = this.lyrics;
    const cur = L.lineAt(t);
    const next = L.nextLine(t);
    let line: Line | null = cur;
    if (!line) {
      const last = L.lastLine(t);
      if (next && next.start - t <= lead) line = next;
      else if (last && t - last.end <= hold) line = last;
    }
    const words = line ? line.words.map((w) => Timeline.wordState(w, t)) : [];
    return {
      line, singing: !!cur, words, word: L.wordAt(t), lastWord: L.lastWord(t), next,
      lineP: line ? Math.min(1, Math.max(0, (t - line.start) / Math.max(1e-3, line.end - line.start))) : 0,
    };
  }

  /** Start times of all words matching `s` (normalized, e.g. 'C-' or 'scroll') inside [t0, t1). */
  wordTimes(s: string, t0 = -Infinity, t1 = Infinity) {
    return this.lyrics.findWords(s).map((w) => w.start).filter((x) => x >= t0 && x < t1);
  }

  /** The last grid point at/before the first word of a lyric line (a cut that never clips the word). */
  cut(lyric: string, nth = 0, div = 1, tol = 0.02) {
    return this.floorGrid(this.lyrics.get(lyric, nth).words[0]!.start, div, tol);
  }

  // ---- scenes & transitions -------------------------------------------------------------------

  sceneAt(t: number) { return this.scenes.find((e) => t >= e.start && t < e.end) ?? null; }
  scene(id: string) {
    const e = this.scenes.find((x) => x.id === id);
    if (!e) throw new Error(`scene not found: ${id}`);
    return e;
  }
  /** The transition overlap in progress at t, if any. */
  transitionAt(t: number): TransitionState | null {
    for (let i = 0; i + 1 < this.scenes.length; i++) {
      const a = this.scenes[i]!, b = this.scenes[i + 1]!;
      const s = b.activeStart, e = a.activeEnd;
      if (e > s && t >= s && t < e) return { from: a, to: b, kind: a.transitionOut.kind, k: (t - s) / (e - s), start: s, end: e };
    }
    return null;
  }

  private anchorTime(a: Anchor): number {
    if ('at' in a) return a.at;
    if ('section' in a) return this.sectionByKey(a.section).start;
    if ('cut' in a) return this.cut(a.cut, a.nth ?? 0, a.div ?? 1);
    return this.snap(a.snap, a.div ?? 1);
  }

  private build(): TimelineEntry[] {
    const starts = SCENES.map((d) => this.anchorTime(d.anchor));
    const entries: TimelineEntry[] = SCENES.map((d, i) => ({
      id: d.id, file: d.file, title: d.title, section: d.section,
      start: starts[i]!, end: i + 1 < SCENES.length ? starts[i + 1]! : this.duration,
      activeStart: starts[i]!, activeEnd: i + 1 < SCENES.length ? starts[i + 1]! : this.duration,
      transitionIn: i > 0 ? SCENES[i - 1]!.out : { kind: 'cut' },
      transitionOut: d.out,
      load: loader(d.file), params: d.params, post: d.post,
    }));
    // widen active windows by the transition overlaps
    for (let i = 0; i + 1 < entries.length; i++) {
      const a = entries[i]!, b = entries[i + 1]!, tr = a.transitionOut;
      if (tr.kind === 'cut' || !tr.beats) continue;
      const d = tr.beats * this.beatPeriod, cut = a.end;
      const [s, e] = tr.align === 'after' ? [cut, cut + d] : tr.align === 'center' ? [cut - d / 2, cut + d / 2] : [cut - d, cut];
      a.activeEnd = Math.max(a.activeEnd, e);
      b.activeStart = Math.min(b.activeStart, s);
    }
    for (const e of entries) if (!(e.end > e.start)) throw new Error(`scene ${e.id} has an empty window ${e.start}..${e.end}`);
    return entries;
  }
}

export function makeTimeline(lyrics: Lyrics, audio: AudioData, sections: SectionsJSON) {
  return new Timeline(audio, lyrics, sections);
}
