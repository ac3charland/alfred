/**
 * What the Worker's feed leg makes of mlarson.org's real feed: the entries it reads, each one's
 * identity and date, whether it is an excerpt (so its page would be fetched), and which of them a
 * poll on 2026-11-09 takes — only the ones inside the seven-day horizon.
 *
 * The parser and planner are the Worker's own (`workers/src/reader/feeds.ts`), headless: their
 * only surface is the posts the leg inserts. `workers/src` imports are extensionless, so the
 * modules and the committed fixture are bundled with esbuild (already a dependency) first.
 *
 * Run from the repo root: `node docs/demos/reader-feeds/parse-mlarson.mjs`
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();

/** The capture day: the poll this evidence replays. */
const NOW = new Date('2026-11-09T12:00:00.000Z');

const outDir = mkdtempSync(path.join(tmpdir(), 'reader-feeds-'));
try {
  const outfile = path.join(outDir, 'modules.mjs');
  await build({
    stdin: {
      contents: `export * from '${ROOT}/workers/src/reader/feeds.ts';
                 export { MLARSON_FEED } from '${ROOT}/workers/src/reader/fixtures/feeds/mlarson.ts';`,
      resolveDir: path.join(ROOT, 'workers'),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  const feeds = await import(outfile);

  const parsed = feeds.parseFeed(feeds.MLARSON_FEED, 'https://mlarson.org/feed.xml');
  console.log(`feed: ${parsed.title} (author ${parsed.author}), ${parsed.entries.length} entries`);
  const dated = [];
  for (const entry of parsed.entries) {
    const identity = await feeds.entryIdentity(entry);
    const date = feeds.entryDate(entry, NOW);
    dated.push({ ...entry, identity, date });
    console.log(
      `- ${entry.title}\n    id ${identity}\n    date ${date.toISOString()}  ` +
        `excerpt? ${feeds.isExcerpt(entry) ? 'yes — the page would be read' : 'no — full content'}`,
    );
  }

  const plan = feeds.planFeedEntries(dated, new Set(), NOW, 5);
  console.log(`\npoll at ${NOW.toISOString()}, five slots free:`);
  console.log(`takes ${plan.take.map((entry) => entry.title).join(', ') || 'nothing'}`);
  console.log(`drained: ${String(plan.drained)} (so the feed is stamped checked)`);

  const again = feeds.planFeedEntries(dated, new Set(plan.take.map((e) => e.identity)), NOW, 5);
  console.log(`re-poll with that post stored takes: ${again.take.length} entries`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
