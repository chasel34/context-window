#!/usr/bin/env bun
// Offline renderer. Drives the app in headless Chrome (?export=1): frames are rendered in the page,
// streamed raw over a WebSocket and piped into ffmpeg (libx264), with the song muxed in.
// Adapted from mexicat/pdoom-video (MIT), see LICENSE-THIRD-PARTY.md.
//
//   video (default): bun scripts/render.ts video [--from 0] [--to 147.6] [--scene s05] [--preview]
//                    [--samples 4|auto] [--shutter 0.5] [--fps 60] [--scale 1] [--crf 16] [--preset slow]
//                    [--out ../out/x.mp4] [--noaudio]
//      --preview    960x540 at 30 fps, x264 veryfast / crf 20 (the layout is identical, rendered at half scale)
//      --samples N  motion blur: every frame averages N sub-frames over shutter×(1/fps) (default 4; 1 = off);
//                   'auto' picks 4/12/36/108/324 per frame until converged (see Engine.render)
//      --scene sNN  render just that scene's window (loads only that scene)
//   stills:  bun scripts/render.ts stills --t 1.5,23,40.2 [--scene s05 | --only s05,s06] [--out dir]
//   sheet:   bun scripts/render.ts sheet --from 20 --to 35 [--n 12] [--cols 4] [--out file.png]   (or --times a,b,c | --cuts)
//   perf:    bun scripts/render.ts perf --from 20 --to 25 [--samples 4]   (ms per frame incl. readback)
//   gpu:     print the WebGL renderer string
// --scale S (all modes): 0.5 = 960x540, 1 = 1920x1080, 2 = 3840x2160. Scenes always lay out in 1920x1080.
// Starts a private Vite server without live reload (so saving a file can't reload the page mid-render),
// unless --url points at a running one.
import { chromium, type Page } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const MODES = ['video', 'stills', 'sheet', 'perf', 'gpu'];
const mode = argv[0] && MODES.includes(argv[0]) ? argv[0] : 'video';
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (k: string) => argv.includes(`--${k}`);
const APP = path.resolve(import.meta.dir, '..');
const PREVIEW = flag('preview');
const SCALE = (() => { const s = +opt('scale', PREVIEW ? '0.5' : '1')!; return s < 1 ? 0.5 : Math.min(4, Math.round(s)); })();
const OW = Math.round(1920 * SCALE), OH = Math.round(1080 * SCALE); // output size
const FPS = +opt('fps', PREVIEW ? '30' : '60')!;
// --samples N (fixed, default 4) or --samples auto [--min-samples 4] [--max-samples 324] [--tol 3] (adaptive, see Engine.render)
const SAMPLES = opt('samples', mode === 'video' ? '4' : '1') === 'auto'
  ? { min: +opt('min-samples', '4')!, max: +opt('max-samples', '324')!, tol: +opt('tol', '3')! }
  : Math.max(1, Math.round(+opt('samples', mode === 'video' ? '4' : '1')!));
const SHUTTER = +opt('shutter', '0.5')!;
const SCENE = opt('scene');
const hist = (h: Record<string, number>) => Object.entries(h).sort((a, b) => +a[0] - +b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
const ROOT = path.resolve(APP, '..');

async function reachable(url: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}

async function ensureServer(): Promise<{ url: string; stop: () => void }> {
  const given = opt('url');
  if (given) {
    if (await reachable(given)) return { url: given, stop: () => {} };
    throw new Error(`--url ${given} is not reachable`);
  }
  const port = 5300 + Math.floor(Math.random() * 500);
  // no live reload: a file saved mid-render must not reload the page
  const proc = Bun.spawn(['bunx', 'vite', '--port', String(port), '--strictPort'], { cwd: APP, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, CW_NO_HMR: '1' } });
  const u = `http://localhost:${port}`;
  for (let i = 0; i < 100 && !(await reachable(u)); i++) await Bun.sleep(100);
  return { url: u, stop: () => proc.kill() };
}

async function openPage(url: string) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !flag('headed'),
    args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const logs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  const only = opt('only') ?? SCENE;
  await page.goto(`${url}/?export=1${only ? `&only=${only}` : ''}${SCALE !== 1 ? `&scale=${SCALE}` : ''}`);
  await page.waitForFunction(() => (window as any).__cw?.ready || (window as any).__cw?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => (window as any).__cw.error);
  if (err) throw new Error(`app failed to boot:\n${err}\n${logs.join('\n')}`);
  const size: [number, number] = await page.evaluate(() => [(window as any).__cw.width ?? 1920, (window as any).__cw.height ?? 1080]);
  if (size[0] !== OW || size[1] !== OH) throw new Error(`app renders ${size[0]}x${size[1]}, expected ${OW}x${OH} (--scale ${SCALE})`);
  const sceneErrors: string[] = await page.evaluate(() => (window as any).__cw.errors);
  if (sceneErrors.length) console.error('SCENE ERRORS:\n' + sceneErrors.join('\n'));
  return { browser, page, logs };
}

async function stills(page: Page, times: number[], outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const t of times) {
    const k: number = await page.evaluate(([t, s, sh]) => (window as any).__cw.still(t, s, sh), [t, SAMPLES, SHUTTER] as const);
    const f = path.join(outDir, `f_${t.toFixed(2).padStart(7, '0')}.png`);
    if (typeof SAMPLES !== 'number') console.log(`t=${t}: ${k} sub-frames`);
    // at scale > 1 the canvas is shown downscaled on the page: save the full-res pixel buffer instead
    if (SCALE !== 1) await Bun.write(f, Buffer.from(await page.evaluate(() => (window as any).__cw.png()), 'base64'));
    else await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    files.push(f);
  }
  return files;
}

async function sheet(page: Page, times: number[], cols: number, out: string) {
  const dataUrl: string = await page.evaluate(async ({ times, cols }) => {
    const P = (window as any).__cw;
    const cw = 480, ch = 270, pad = 4, lab = 18;
    const rows = Math.ceil(times.length / cols);
    const cv = document.createElement('canvas');
    cv.width = cols * (cw + pad) + pad; cv.height = rows * (ch + lab + pad) + pad;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#222'; c.fillRect(0, 0, cv.width, cv.height);
    const src = document.getElementById('c') as HTMLCanvasElement;
    times.forEach((t: number, i: number) => {
      P.still(t);
      const x = pad + (i % cols) * (cw + pad), y = pad + Math.floor(i / cols) * (ch + lab + pad);
      c.drawImage(src, x, y + lab, cw, ch);
      c.fillStyle = '#ddd'; c.font = '13px monospace'; c.fillText(`${t.toFixed(2)}s`, x + 2, y + 13);
    });
    return cv.toDataURL('image/png');
  }, { times, cols });
  mkdirSync(path.dirname(out), { recursive: true });
  await Bun.write(out, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function video(page: Page, from: number, to: number, fps: number, out: string) {
  mkdirSync(path.dirname(out), { recursive: true });
  const crf = opt('crf', PREVIEW ? '20' : '16')!;
  // mux the lossless WAV when present (same timeline as the analysis), else the mp3
  const wav = path.join(ROOT, 'song/Context Window.wav');
  const audio = existsSync(wav) ? wav : path.join(ROOT, 'song/context-window.mp3');
  const args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OW}x${OH}`, '-r', String(fps), '-i', 'pipe:0'];
  if (!flag('noaudio')) args.push('-ss', String(from), '-t', String(to - from), '-i', audio);
  // Frames are sRGB (toSRGB in the final pass): convert with the BT.709 matrix and tag the stream.
  args.push('-vf', 'vflip,scale=out_color_matrix=bt709,setparams=color_primaries=bt709:color_trc=bt709', '-c:v', 'libx264', '-preset', opt('preset', PREVIEW ? 'veryfast' : 'slow')!, '-crf', crf, '-pix_fmt', 'yuv420p', '-tune', 'grain', '-x264-params', opt('x264', 'aq-mode=3')!);
  if (!flag('noaudio')) args.push('-c:a', 'aac', '-b:a', '320k', '-shortest');
  args.push('-movflags', '+faststart', out);
  const ff = Bun.spawn(args, { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
  let frames = 0;
  const total = Math.round(to * fps) - Math.round(from * fps);
  const t0 = performance.now();
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response('ws only', { status: 400 }); },
    websocket: {
      maxPayloadLength: Math.max(64 * 1024 * 1024, OW * OH * 4 + 1024),
      async message(ws, msg) {
        ff.stdin.write(msg as Uint8Array);
        await ff.stdin.flush();
        frames++;
        ws.send(String(frames)); // ack: the page keeps at most a few frames ahead of ffmpeg
        if (frames % 30 === 0 || frames === total) {
          const el = (performance.now() - t0) / 1000;
          process.stdout.write(`\r${frames}/${total} frames  ${(frames / el).toFixed(1)} fps  eta ${((total - frames) / (frames / el)).toFixed(0)}s   `);
        }
      },
    },
  });
  const used: Record<string, number> = await page.evaluate((o) => (window as any).__cw.stream(o), { from, to, fps, ws: `ws://localhost:${server.port}`, samples: SAMPLES, shutter: SHUTTER, inflight: 4 });
  while (frames < total) await Bun.sleep(20);
  ff.stdin.end();
  await ff.exited;
  server.stop();
  const el = (performance.now() - t0) / 1000;
  console.log(`\nwrote ${out}: ${OW}x${OH} ${fps}fps, ${frames} frames in ${el.toFixed(1)}s = ${(el / (to - from)).toFixed(2)} s per video second (samples ${typeof SAMPLES === 'number' ? SAMPLES : 'auto'})`);
  console.log(`sub-frames per frame (count:frames): ${hist(used)}`);
}

const tl_starts = (tl: { id: string; start: number }[]) => tl.map((e) => `${e.id}@${e.start.toFixed(3)}`).join(' ');
/** --from/--to, or the window of --scene. */
let TL: { id: string; start: number; end: number }[] = [];
function range(dur: number): [number, number] {
  if (SCENE) {
    const e = TL.find((x) => x.id === SCENE);
    if (!e) throw new Error(`unknown scene ${SCENE} (have ${TL.map((x) => x.id).join(', ')})`);
    return [+opt('from', String(e.start))!, +opt('to', String(e.end))!];
  }
  return [+opt('from', '0')!, Math.min(dur, +opt('to', String(dur))!)];
}

const { url, stop } = await ensureServer();
const { browser, page, logs } = await openPage(url);
TL = await page.evaluate(() => (window as any).__cw.timeline);
try {
  if (mode === 'gpu') {
    console.log(await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }));
  } else if (mode === 'stills') {
    const times = (opt('t') ?? (SCENE ? String((range(1e9)[0] + range(1e9)[1]) / 2) : '0')).split(',').map(Number);
    const files = await stills(page, times, opt('out', path.join(ROOT, 'out/stills'))!);
    console.log(files.join('\n'));
  } else if (mode === 'sheet') {
    const [from, to] = SCENE ? range(1e9) : [+opt('from', '0')!, +opt('to', '10')!], n = +opt('n', '12')!;
    let times = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / Math.max(1, n - 1));
    if (opt('times')) times = opt('times')!.split(',').map(Number);
    if (flag('cuts')) {
      // 4 frames around every timeline boundary: 2 frames before, 2 after
      const tl: { id: string; start: number }[] = await page.evaluate(() => (window as any).__cw.timeline);
      // --cut-frames: offsets in 60 fps frames around each boundary (default 2 frames before/after + ±0.1 s)
      const offs = (opt('cut-frames') ?? '-6,-1,1,6').split(',').map((x) => +x / 60);
      times = tl.slice(1).flatMap((e) => offs.map((o) => e.start + o));
    }
    const out = opt('out', path.join(ROOT, `out/sheets/sheet_${from}-${to}.png`))!;
    if (flag('cuts')) console.log(tl_starts(TL));
    await sheet(page, times, +opt('cols', '4')!, out);
    console.log(out);
  } else if (mode === 'perf') {
    const [from, to] = SCENE ? range(1e9) : [+opt('from', '0')!, +opt('to', '5')!];
    const r = await page.evaluate(async ({ from, to, samples, shutter }) => {
      const P = (window as any).__cw;
      const ms: number[] = [];
      const buf = new Uint8Array(P.width * P.height * 4);
      P.still(from);
      const used: Record<number, number> = {};
      for (let t = from; t < to; t += 1 / 60) {
        const a = performance.now();
        const k = P.engine.render(t, 1 / 60, false, samples, shutter);
        used[k] = (used[k] ?? 0) + 1;
        await P.engine.readPixelsAsync(buf);
        ms.push(performance.now() - a);
      }
      ms.sort((a, b) => a - b);
      return { n: ms.length, avg: ms.reduce((a, b) => a + b, 0) / ms.length, p50: ms[ms.length >> 1], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], used };
    }, { from, to, samples: SAMPLES, shutter: SHUTTER });
    console.log(`frames ${r.n}  avg ${r.avg.toFixed(1)}ms  p50 ${r.p50.toFixed(1)}  p95 ${r.p95.toFixed(1)}  max ${r.max.toFixed(1)}  sub-frames ${hist(r.used)}`);
  } else if (mode === 'video') {
    const dur: number = await page.evaluate(() => (window as any).__cw.duration);
    const [from, to] = range(dur);
    const tag = `${from === 0 && Math.abs(to - dur) < 1e-3 ? '' : `_${SCENE ?? ''}${SCENE ? '_' : ''}${from.toFixed(1)}-${to.toFixed(1)}`}${PREVIEW ? '_preview' : ''}`;
    await video(page, from, to, FPS, path.resolve(opt('out', path.join(ROOT, `out/context-window${tag}.mp4`))!));
  }
  if (logs.length) console.error('BROWSER LOG:\n' + logs.slice(0, 40).join('\n'));
} finally {
  await browser.close();
  stop();
}
