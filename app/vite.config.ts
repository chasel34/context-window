// Adapted from mexicat/pdoom-video (MIT), see LICENSE-THIRD-PARTY.md.
import { defineConfig, normalizePath, type Plugin } from 'vite';
import { cpSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const assetDirs = ['song', 'data'];
// What a build ships: the preview mp3 and the timing data (not the WAV or stems).
const buildAssets = ['song/context-window.mp3', 'data'];

// Git can check out directory symlinks as plain files on Windows. Serve the
// original assets through Vite and copy them into builds without using symlinks.
function repoAssets(): Plugin {
  return {
    name: 'repo-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (assetDirs.some((dir) => req.url?.startsWith(`/${dir}/`))) {
          req.url = `/@fs/${encodeURI(normalizePath(repoRoot))}${req.url}`;
        }
        next();
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      for (const p of buildAssets) {
        cpSync(path.join(repoRoot, p), path.join(options.dir, p), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  publicDir: 'public',
  plugins: [repoAssets()],
  // CW_NO_HMR=1: no live reload (export renders must not reload mid-run when a file changes)
  server: { port: 5173, strictPort: false, hmr: process.env.CW_NO_HMR ? false : undefined, fs: { allow: [repoRoot] } },
  resolve: { alias: { '@root': repoRoot } },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
