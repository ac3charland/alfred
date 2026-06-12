import { readFileSync } from 'node:fs';

import { createFFmpeg } from '@ffmpeg/ffmpeg';

type FFmpeg = ReturnType<typeof createFFmpeg>;

/**
 * High-quality GIF recipe. Cap the width at 640 without ever upscaling — the
 * escaped comma keeps `min(iw,640)` *inside* the scale argument instead of
 * splitting the filtergraph — thin the frame rate to 15fps, then generate and
 * apply a per-clip 256-colour palette so flat UI colours stay crisp and the file
 * stays small. `-loop 0` makes the GIF loop forever.
 */
const GIF_FILTERS = String.raw`fps=15,scale=min(iw\,640):-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

/**
 * Load the ffmpeg.wasm core. The 0.11 Node build's emscripten glue reaches for a
 * global `fetch` to pull in its `.wasm`, but hands it a bare filesystem path that
 * the WHATWG `fetch` shipped with Node 18+ rejects ("Failed to parse URL"). Hiding
 * `fetch` for just the duration of `load()` makes the glue fall back to its Node
 * `fs` reader; we restore it immediately so nothing else in the process is affected.
 */
async function loadCore(ffmpeg: FFmpeg): Promise<void> {
  const globalWithFetch = globalThis as { fetch?: typeof globalThis.fetch | undefined };
  const savedFetch = globalWithFetch.fetch;
  globalWithFetch.fetch = undefined;
  try {
    await ffmpeg.load();
  } finally {
    globalWithFetch.fetch = savedFetch;
  }
}

/**
 * Convert a Playwright screen recording (`.webm`) to an animated GIF entirely in
 * WASM via `@ffmpeg/ffmpeg`. GitHub's file and markdown viewers don't render
 * `.webm`, but a GIF inlines as a plain markdown image — so this is what lets a
 * recorded animation actually show up in a committed demo doc.
 *
 * Pinned to `@ffmpeg/ffmpeg` v0.11.x on purpose: 0.12+ dropped the Node entry
 * point and runs only in the browser. The 0.11 Node build needs no system
 * `ffmpeg` binary (so there's nothing to add to our environments); it loads its
 * companion `@ffmpeg/core` WASM through a CommonJS `require`.
 *
 * Returns the GIF bytes; the caller decides where they land.
 */
export async function convertWebmToGif(webmPath: string): Promise<Uint8Array> {
  const ffmpeg = createFFmpeg({ log: false });
  await loadCore(ffmpeg);
  try {
    ffmpeg.FS('writeFile', 'input.webm', readFileSync(webmPath));
    await ffmpeg.run('-i', 'input.webm', '-vf', GIF_FILTERS, '-loop', '0', 'output.gif');
    // Copy out of the WASM heap so the bytes survive the teardown below.
    return new Uint8Array(ffmpeg.FS('readFile', 'output.gif'));
  } finally {
    // Tear the WASM runtime down. Without this, ffmpeg.wasm leaves the Node event
    // loop pinned open and the calling process (e.g. `npm run demo -- video`) hangs
    // forever *after* the conversion has already finished, instead of exiting. (We
    // can't `process.exit()` to escape it — see the showboat skill's hard rules.)
    ffmpeg.exit();
  }
}
