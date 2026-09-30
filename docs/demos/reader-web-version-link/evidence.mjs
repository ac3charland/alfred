/**
 * What a newsletter whose web-version link says "Read on web" becomes, before and after ALF-292.
 *
 * The extractor is the Worker's, and headless: its only surface is the `canonical_url` it stores,
 * which the app then reads twice — as the row's "Original" link and as the `url` a Send hands
 * Instapaper. So the evidence runs the REAL modules end to end: the Worker's `extractPost` at the
 * commit this branch was cut from and in the working tree, then the frontend's `postOpenLink` and
 * `buildBookmarkParams` over what each one stored. Nothing is restated here.
 *
 * `workers/src` imports are extensionless and the frontend's use the `@/` alias, so each entry is
 * bundled with esbuild (already a dependency) into a throwaway ESM module first; the base
 * commit's extractor is read out of git and bundled from its own directory, so its relative
 * imports resolve against the same email-text module the branch uses. `server-only` is stubbed:
 * it exists to throw in a client bundle, and this is not one.
 *
 * Run from the repo root: `node docs/demos/reader-web-version-link/evidence.mjs`
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The commit this branch was cut from: the extractor as it shipped before the fix. */
const BASE = '9372104';

const ROOT = process.cwd();
const EXTRACT = 'workers/src/reader/extract.ts';

/** The anchor texts a newsletter's web-version link carries, and one that is not that link. */
const WORDINGS = [
  'Read on web',
  'Read on the web',
  'View on web',
  'View this email in your browser',
  'View email in browser',
  'View in browser',
  'Read on the website',
];

/** `server-only` throws on import outside a React server bundle; here it has nothing to guard. */
const serverOnlyStub = {
  name: 'server-only-stub',
  setup(build_) {
    build_.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }));
    build_.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: '', loader: 'js' }));
  },
};

/** Bundle one entry's source into an importable ESM file. */
async function bundle(outDir, name, contents, resolveDir) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await build({
    stdin: { contents, resolveDir, loader: 'ts', sourcefile: `${name}.ts` },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    plugins: [serverOnlyStub],
  });
  return import(outfile);
}

/** Gmail's wire encoding for a part body: unpadded base64url. */
function encodeBody(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
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
      body: { size: html.length, data: encodeBody(html) },
    },
  };
}

/** Where the row's Original link goes, in a few words. */
function original(frontend, post) {
  const link = frontend.postOpenLink({
    canonical_url: post.canonical_url ?? null,
    rfc822_message_id: post.rfc822_message_id ?? null,
  });
  return link.kind === 'canonical' ? 'the web version' : `${link.kind} (Gmail permalink)`;
}

/** What a Send hands Instapaper for this post: its `url`, or the private-email mechanism. */
function send(frontend, post) {
  const params = frontend.buildBookmarkParams({
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
    const baseSource = execFileSync('git', ['show', `${BASE}:${EXTRACT}`], { encoding: 'utf8' });
    const before = await bundle(outDir, 'extract-before', baseSource, path.dirname(EXTRACT));
    const after = await bundle(
      outDir,
      'extract-after',
      `export { extractPost } from '${ROOT}/${EXTRACT}';`,
      ROOT,
    );
    const frontend = await bundle(
      outDir,
      'frontend',
      `export { postOpenLink } from '${ROOT}/frontend/lib/reader/open-link.ts';
       export { buildBookmarkParams } from '${ROOT}/frontend/lib/instapaper/bookmark.ts';`,
      path.join(ROOT, 'frontend'),
    );

    const publication = { name: 'Tidewrack Weekly' };
    for (const wording of WORDINGS) {
      const message = newsletter(wording);
      console.log(`"${wording}"`);
      for (const [label, extractor] of [
        [`before (${BASE})`, before],
        ['after (branch) ', after],
      ]) {
        const post = extractor.extractPost(message, publication);
        console.log(`  ${label}  canonical_url: ${post.canonical_url ?? 'none'}`);
        console.log(`                    Original → ${original(frontend, post)}`);
        console.log(`                    Send     → ${send(frontend, post)}`);
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
