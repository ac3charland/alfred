/**
 * The Worker's real Reader tick (`runReaderTick`) over feeds, tick after tick: what it fetches,
 * what it writes, and what it hands the summariser. Everything outside the Worker is a stand-in —
 * PostgREST is an in-memory roster and post table, the blogs are canned responses (the committed
 * mlarson.org capture, an excerpt-only feed with its entry page, and a feed that 404s and then
 * recovers) — and the one module replaced is the summariser, whose input is printed instead of
 * being sent to the model. The tick's ordering, slot arithmetic, dedupe and stamps are the
 * production code's.
 *
 * Run from the repo root: `node docs/demos/reader-feeds/tick-harness.mjs`
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const SUPABASE_URL = 'https://proj.supabase.co';

/** The summariser, replaced: it prints what the tick asked of it and answers a done summary. */
const summarizeStub = {
  name: 'summarize-stub',
  setup(build_) {
    build_.onResolve({ filter: /^\.\/summarize$/ }, () => ({ path: 'summarize', namespace: 'stub' }));
    build_.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      loader: 'js',
      contents: `export async function summarizePost(input) {
        console.log('    summarise: kind=' + input.kind + ' publication=' + JSON.stringify(input.publication) +
          ' title=' + JSON.stringify(input.title) + ' words=' + input.wordCount);
        return { kind: 'done', summary: { kind: input.kind, headline: 'h', gist: 'g',
          overview: { novel_ideas: [], evidence: [], argument: 'a', who_should_read: 'w', further_reading: [] } } };
      }`,
    }));
  },
};

const outDir = mkdtempSync(path.join(tmpdir(), 'reader-feeds-tick-'));
try {
  const outfile = path.join(outDir, 'tick.mjs');
  await build({
    stdin: {
      contents: `export { runReaderTick } from '${ROOT}/workers/src/reader/scheduled.ts';
                 export { MLARSON_FEED, RSS_DESCRIPTION_ONLY_FEED, ENTRY_PAGE }
                   from '${ROOT}/workers/src/reader/fixtures/feeds/index.ts';`,
      resolveDir: path.join(ROOT, 'workers'),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
    plugins: [summarizeStub],
  });
  const { runReaderTick, MLARSON_FEED, RSS_DESCRIPTION_ONLY_FEED, ENTRY_PAGE } = await import(outfile);

  // ── The stand-in world ─────────────────────────────────────────────────────
  const roster = [
    feed('pub-mlarson', 'mlarson.org', 'https://mlarson.org/feed.xml', 'essay'),
    feed('pub-quiet', 'Quiet Cities', 'https://quiet.example/feed.xml', 'roundup'),
    feed('pub-dead', 'Dead Blog', 'https://dead.example/rss', 'essay'),
  ];
  const posts = [];
  /** What each blog answers, by URL; the 404 feed is switched back on for the last tick. */
  const web = {
    'https://mlarson.org/feed.xml': () => new Response(MLARSON_FEED, { headers: { ETag: '"m1"' } }),
    'https://quiet.example/feed.xml': () =>
      new Response(RSS_DESCRIPTION_ONLY_FEED, { headers: { 'Last-Modified': 'Sun, 08 Nov 2026 07:00:00 GMT' } }),
    'https://quiet.example/posts/cities': () => new Response(ENTRY_PAGE),
    'https://dead.example/rss': () => new Response('gone', { status: 404 }),
  };

  function feed(id, name, url, kind) {
    return {
      id, name, summary_kind: kind, enabled: true, handle: null, feed_url: url,
      feed_etag: null, feed_last_modified: null, feed_checked_at: null,
      feed_last_success_at: null, feed_last_error: null, feed_last_error_at: null,
    };
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'x' });
    if (!url.startsWith(SUPABASE_URL)) {
      const conditional = new Headers(init.headers).get('If-None-Match');
      console.log(`    GET ${url}${conditional ? ` (If-None-Match ${conditional})` : ''}`);
      const answer = web[url];
      return answer === undefined ? new Response('', { status: 404 }) : answer();
    }
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const { pathname, searchParams } = new URL(url);
    const table = pathname.replace('/rest/v1/', '');
    if (table === 'reader_publications' && method === 'PATCH') {
      const row = roster.find((r) => `eq.${r.id}` === searchParams.get('id'));
      Object.assign(row, body);
      console.log(`    stamp ${row.name}: ${JSON.stringify(body)}`);
      return Response.json([{ id: row.id }]);
    }
    if (table === 'reader_publications') return Response.json(roster);
    if (table === 'reader_posts' && method === 'POST') {
      if (posts.some((p) => p.publication_id === body.publication_id && p.feed_entry_id === body.feed_entry_id)) {
        return new Response('duplicate key', { status: 409 });
      }
      posts.push(body);
      console.log(
        `    insert reader_posts: source=${body.source} feed=${body.publication_id} ` +
          `entry=${body.feed_entry_id} received_at=${body.received_at} words=${body.word_count}`,
      );
      return Response.json([{ id: `post-${posts.length}` }]);
    }
    if (table === 'reader_posts' && searchParams.has('feed_entry_id')) {
      const feedId = searchParams.get('publication_id').slice(3);
      return Response.json(posts.filter((p) => p.publication_id === feedId).map((p) => ({ feed_entry_id: p.feed_entry_id })));
    }
    if (table === 'reader_posts' && method === 'GET' && !searchParams.has('summary_state')) {
      return new Response('[]', { headers: { 'Content-Range': '0-0/0' } });
    }
    return Response.json(method === 'PATCH' ? [{ id: 'row' }] : []);
  };

  const env = {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'k', ANTHROPIC_API_KEY: 'k', READER_MODEL: 'claude-sonnet-5',
    READER_DAILY_CAP: '30', GMAIL_OAUTH_CLIENT_ID: 'c', GMAIL_OAUTH_CLIENT_SECRET: 's',
    GMAIL_PERSONAL_REFRESH_TOKEN: 'r',
  };
  let clock = Date.parse('2026-11-09T12:00:00.000Z');
  async function tick(label, minutesLater = 5) {
    const now = new Date(clock);
    console.log(`\n${now.toISOString()} — ${label}`);
    const summary = await runReaderTick(env, now, () => 0);
    console.log(`    → feed: ${JSON.stringify(summary.feed)}; tick failures: ${JSON.stringify(summary.failures)}`);
    clock += minutesLater * 60_000;
  }

  await tick('three never-checked feeds: ONE is polled a tick, the lowest id first — it 404s');
  await tick("the next never-checked feed: mlarson.org's one entry inside seven days is imported");
  await tick('the excerpt-only feed: its entry page is read and its article stored');
  await tick('every feed was checked within the hour: nothing is due', 60);
  await tick('an hour on: the dead blog is retried (hourly, not every tick) and still 404s');
  await tick("mlarson.org re-polled with its ETag: its entry is already a post, so nothing is taken");
  await tick('Quiet Cities re-polled: nothing new', 50);
  web['https://dead.example/rss'] = () =>
    new Response('<rss><channel><title>Dead Blog</title></channel></rss>');
  await tick("the dead blog answers again: a success stamped after its error, so its card's amber line clears");
  console.log(`\nposts stored: ${posts.length}`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
