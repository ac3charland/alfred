/**
 * What a newsletter whose web-version link says "Read on web" (or any of its cousins) becomes.
 *
 * The extractor is the Worker's, and headless: its only surface is the `canonical_url` it stores,
 * which the app then reads twice — as the row's "Original" link and as the `url` a Send hands
 * Instapaper. So the evidence runs the REAL modules end to end: the Worker's `extractPost`, then
 * the frontend's `postOpenLink` and `buildBookmarkParams` over what it stored. Nothing is restated.
 *
 * `workers/src` imports are extensionless and the frontend's use the `@/` alias, so both are
 * bundled with esbuild (already a dependency) into a throwaway ESM module first. `server-only` is
 * stubbed: it exists to throw in a client bundle, and this is not one.
 *
 * Run from the repo root: `node docs/demos/reader-web-version-link/evidence.mjs`
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();

/** Web-version wordings, the one that always worked, and two links to some other site. */
const WORDINGS = [
  'Read on web',
  'Read on the web',
  'View this email in your browser',
  'View it in your browser',
  'View this issue online',
  'View as a web page',
  'Web version',
  'View in browser',
  'Read on the website',
  'Read on web.dev',
];

/** `server-only` throws on import outside a React server bundle; here it has nothing to guard. */
const serverOnlyStub = {
  name: 'server-only-stub',
  setup(build_) {
    build_.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
    build_.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: '', loader: 'js' }));
  },
};

/** Bundle the three production entry points into one importable ESM file. */
async function bundle(outDir) {
  const outfile = path.join(outDir, 'modules.mjs');
  await build({
    stdin: {
      contents: `export { extractPost } from '${ROOT}/workers/src/reader/extract.ts';
                 export { postOpenLink } from '${ROOT}/frontend/lib/reader/open-link.ts';
                 export { buildBookmarkParams } from '${ROOT}/frontend/lib/instapaper/bookmark.ts';`,
      resolveDir: path.join(ROOT, 'frontend'),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    plugins: [serverOnlyStub],
  });
  return import(outfile);
}

/** A small non-Substack newsletter: the web-version link up top, a cited link in the body. */
function newsletter(wording) {
  const html = `<html><body>
  <p style="font-size:12px"><a href="https://news.example.com/issues/42?t=abc">${wording}</a></p>
  <h1>Issue 42: the berth queue</h1>
  <p>The queue grew again, and <a href="https://example.org/berth-report">the port's report</a> says why.</p>
</body></html>`;
  return {
    id: 'demo-1',
    threadId: 'demo-thread-1',
    internalDate: '1790000000000',
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'Subject', value: 'Issue 42: the berth queue' },
        { name: 'From', value: 'Tidewrack Weekly <hello@news.example.com>' },
        { name: 'Message-ID', value: '<issue-42@news.example.com>' },
      ],
      // Gmail's wire encoding for a part body: unpadded base64url.
      body: { size: html.length, data: Buffer.from(html, 'utf8').toString('base64url') },
    },
  };
}

/** Where the row's Original link goes, in a few words. */
function original(modules, post) {
  const link = modules.postOpenLink({
    canonical_url: post.canonical_url ?? null,
    rfc822_message_id: post.rfc822_message_id ?? null,
  });
  return link.kind === 'canonical' ? 'the web version' : `${link.kind} (Gmail permalink)`;
}

/** What a Send hands Instapaper for this post: its `url`, or the private-email mechanism. */
function send(modules, post) {
  const params = modules.buildBookmarkParams({
    title: post.title,
    canonical_url: post.canonical_url ?? null,
    gist: null,
    html: post.html ?? null,
    text: post.text,
  });
  const anchors = (params.content.match(/<a\b/g) ?? []).length;
  const target =
    params.url === undefined
      ? `is_private_from_source=${params.is_private_from_source}, no url`
      : `url=${params.url}`;
  return `${target} · content with ${String(anchors)} links`;
}

async function main() {
  const outDir = mkdtempSync(path.join(tmpdir(), 'alfred-alf-292-demo-'));
  try {
    const modules = await bundle(outDir);
    for (const wording of WORDINGS) {
      const post = modules.extractPost(newsletter(wording), { name: 'Tidewrack Weekly' });
      console.log(`"${wording}"`);
      console.log(`  canonical_url: ${post.canonical_url ?? 'none'}`);
      console.log(`  Original → ${original(modules, post)}`);
      console.log(`  Send     → ${send(modules, post)}`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
