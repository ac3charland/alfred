#!/usr/bin/env node
/**
 * The Reader tick's To Reader leg on a stubbed run: the REAL `runReaderTick` out of
 * `workers/src/reader/scheduled.ts` (bundled straight from source by esbuild, imported unmodified)
 * with a `fetch` that plays Instapaper's Full API, Supabase's PostgREST, Google's token endpoint
 * and the Anthropic Messages API in memory. It prints every subrequest the tick made, the posts
 * it wrote, the health row it left, and the tick's own summary.
 *
 *   node docs/demos/alf-272-to-reader/to-reader-harness.mjs <section>
 *
 *   take           three bookmarks in To Reader: an article, a Substack app link, a page with no text
 *   archive-fails  Instapaper fails the archive; the post stays; next tick archives it, no second post
 *   restore        a newsletter the owner sent to Instapaper, archived, then moved into To Reader
 *   refused        Instapaper rejects the credentials: newsletters' health is untouched
 *   capped         the day's 30 model calls are spent: no Instapaper call at all
 *   unconfigured   no Instapaper secrets: the leg is off
 *
 * REAL: the leg's listing, slot arithmetic, plan, intake, archive, health stamps and failure words;
 * the Instapaper client and its OAuth 1.0a signer; the summariser's request and parsing. STOOD UP
 * LOCALLY: Instapaper (folders, bookmarks, text views), PostgREST (an in-memory `reader_posts`
 * honouring the bookmark-id unique key), the token exchange, and a model that answers every post
 * with the same summary. `now` is pinned, so every stamp is a literal.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = mkdtempSync(path.join(tmpdir(), 'to-reader-'));
await build({
  entryPoints: [path.join(ROOT, 'workers/src/reader/scheduled.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(out, 'scheduled.mjs'),
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'silent',
});
const { runReaderTick } = await import(pathToFileURL(path.join(out, 'scheduled.mjs')).href);
rmSync(out, { recursive: true, force: true });

const NOW = new Date('2026-09-28T15:00:00.000Z');
const SECRETS = {
  INSTAPAPER_CONSUMER_KEY: 'ck',
  INSTAPAPER_CONSUMER_SECRET: 'cs',
  INSTAPAPER_ACCESS_TOKEN: 'tk',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts',
};
const BASE_ENV = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GMAIL_OAUTH_CLIENT_ID: 'client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
  GMAIL_PERSONAL_REFRESH_TOKEN: 'refresh-token',
  ANTHROPIC_API_KEY: 'sk-ant-demo',
  READER_MODEL: 'claude-sonnet-5',
  READER_DAILY_CAP: '30',
};

const SUMMARY = {
  headline: 'Quieter downtowns are emptier downtowns.',
  gist: 'Street noise tracks lost foot traffic, not new ordinances.',
  overview: {
    novel_ideas: ['Noise sensors as a proxy for foot traffic.'],
    evidence: ['Six downtowns, 2019–2026.'],
    argument: 'The quiet is a symptom of fewer people.',
    who_should_read: 'Anyone who works on downtown recovery.',
  },
};

const ARTICLE_HTML =
  '<h1>Cities Are Getting Quieter</h1><p>Street noise fell in six downtowns as foot traffic did.</p>';
const SUBSTACK_HTML = '<p>Every port keeps two sets of books, and only one of them is written.</p>';

const bookmark = (id, url, title, time) => ({ type: 'bookmark', bookmark_id: id, url, title, time });
const TAKE_BOOKMARKS = [
  bookmark(501, 'https://www.WorksInProgress.co/issue/quiet-cities', 'Cities Are Getting Quieter', 300),
  bookmark(502, 'https://open.substack.com/pub/harborline/p/the-grain-ledger', 'The Grain Ledger', 100),
  bookmark(503, 'https://example.org/interactive/a-page', '', 200),
];

// ── The stand-in world ──────────────────────────────────────────────────────
function world({
  bookmarks = [],
  texts = {},
  posts = [],
  callsToday = 0,
  fail = {},
  folders = [
    { type: 'folder', folder_id: 77, title: 'To Reader' },
    { type: 'folder', folder_id: 12, title: 'To Wiki' },
  ],
} = {}) {
  const calls = [];
  const health = {};
  let nextId = 1;
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init.method ?? 'GET';

    if (url.hostname === 'www.instapaper.com') {
      const call = url.pathname.replace(/^\/api\/1(\.1)?\//, '');
      const form = Object.fromEntries(new URLSearchParams(init.body ?? ''));
      const signed = String(init.headers?.Authorization ?? '').startsWith('OAuth oauth_consumer_key="ck"');
      calls.push(`Instapaper ${call}${form.bookmark_id ? ` #${form.bookmark_id}` : ''}${form.folder_id ? ` folder ${form.folder_id}` : ''}${signed ? ' (signed)' : ' (UNSIGNED)'}`);
      const failure = fail[call];
      if (failure !== undefined) return new Response(failure.body, { status: failure.status });
      if (call === 'folders/list') return json(folders);
      if (call === 'bookmarks/list') return json({ bookmarks, highlights: [] });
      if (call === 'bookmarks/get_text') {
        const html = texts[form.bookmark_id];
        return html === undefined
          ? json([{ type: 'error', error_code: 1550, message: 'Error generating text' }], 400)
          : new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }
      return json([{ type: 'bookmark', bookmark_id: Number(form.bookmark_id) }]);
    }

    if (url.hostname === 'oauth2.googleapis.com') {
      calls.push('Google token mint');
      return json({ access_token: 'ya29.demo', expires_in: 3600 });
    }

    if (url.hostname === 'api.anthropic.com') {
      const body = JSON.parse(init.body);
      const publication = /Publication: (.*)/.exec(body.messages[0].content)?.[1];
      calls.push(`Anthropic messages (Publication: ${publication})`);
      return json({
        id: 'msg_demo',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: JSON.stringify(SUMMARY) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 300 },
      });
    }

    const table = url.pathname.replace('/rest/v1/', '');
    const q = Object.fromEntries(url.searchParams);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;

    if (table === 'reader_health') {
      calls.push(`PATCH  reader_health ${Object.keys(body).filter((k) => !k.startsWith('calls_') && k !== 'daily_cap').join(', ')}`);
      Object.assign(health, body);
      return json([{ id: 1 }]);
    }
    if (table === 'reader_posts' && method === 'POST') {
      const clash = posts.find(
        (post) => post.source === 'instapaper' && post.instapaper_bookmark_id === body.instapaper_bookmark_id,
      );
      calls.push(`POST   reader_posts (bookmark #${body.instapaper_bookmark_id})${clash ? ' → 409' : ''}`);
      if (clash) return new Response('duplicate key', { status: 409 });
      const row = { id: `post-${String(nextId++)}`, archived_at: null, ...body };
      posts.push(row);
      return json([{ id: row.id }]);
    }
    if (table === 'reader_posts' && method === 'PATCH') {
      const id = q.id.replace('eq.', '');
      calls.push(`PATCH  reader_posts ${id} ${Object.keys(body).filter((k) => !['model', 'prompt_version', 'overview', 'headline'].includes(k)).join(', ')}`);
      const row = posts.find((post) => post.id === id);
      if (row) Object.assign(row, body);
      return json(row ? [{ id }] : []);
    }
    if (table === 'reader_posts' && q.instapaper_bookmark_id !== undefined) {
      const ids = q.instapaper_bookmark_id.replace(/^in\.\(|\)$/g, '').split(',').map(Number);
      calls.push(`GET    reader_posts where instapaper_bookmark_id in (${ids.join(',')})`);
      return json(
        posts
          .filter((post) => ids.includes(post.instapaper_bookmark_id))
          .map(({ id, archived_at, instapaper_bookmark_id }) => ({ id, archived_at, instapaper_bookmark_id })),
      );
    }
    if (table === 'reader_posts' && q.summary_state === 'eq.pending') {
      calls.push('GET    reader_posts (retries)');
      return json([]);
    }
    if (table === 'reader_posts') {
      calls.push('GET    reader_posts (ceiling count)');
      return new Response('[]', { headers: { 'Content-Range': `0-0/${String(callsToday)}` } });
    }
    calls.push(`${method.padEnd(6)} ${table}`);
    return json([]);
  };
  return { fetch, calls, posts, health };
}

// ── Printing ────────────────────────────────────────────────────────────────
const shown = (value) => (value === null ? 'null' : JSON.stringify(value));

function printCalls(state) {
  console.log(`subrequests ${String(state.calls.length)}`);
  for (const call of state.calls) console.log(`  ${call}`);
  state.calls.length = 0;
}

function printPosts(state) {
  console.log(`reader_posts (${String(state.posts.length)})`);
  for (const post of state.posts) {
    console.log(`  ${post.id}  source ${post.source ?? 'gmail'}  bookmark #${String(post.instapaper_bookmark_id)}`);
    console.log(`    title ${shown(post.title)}  site ${shown(post.site ?? null)}`);
    if (post.source === 'instapaper') {
      console.log(
        `    url ${shown(post.canonical_url ?? null)}  received ${post.received_at}  words ${String(post.word_count)}`,
      );
      console.log(
        `    publication_id ${shown(post.publication_id ?? null)}  account_key ${shown(post.account_key ?? null)}  gmail_message_id ${shown(post.gmail_message_id ?? null)}`,
      );
    }
    console.log(
      `    summary_state ${post.summary_state}${post.last_error ? ` (${post.last_error})` : ''}  archived_at ${shown(post.archived_at ?? null)}`,
    );
  }
}

function printHealth(state) {
  const columns = Object.fromEntries(
    Object.entries(state.health).filter(([key]) => !['daily_cap', 'calls_today', 'calls_day'].includes(key)),
  );
  console.log(`reader_health ${JSON.stringify(columns)}`);
}

async function tick(state, env = { ...BASE_ENV, ...SECRETS }) {
  globalThis.fetch = state.fetch;
  const summary = await runReaderTick(env, NOW, () => 0);
  console.log(`runReaderTick → summarised ${String(summary.summarized)}, failures ${JSON.stringify(summary.failures)}`);
  console.log(`  instapaper ${JSON.stringify(summary.instapaper)}`);
  return summary;
}

const sections = {
  async take() {
    const state = world({
      bookmarks: TAKE_BOOKMARKS,
      texts: { 501: ARTICLE_HTML, 502: SUBSTACK_HTML },
    });
    await tick(state);
    printCalls(state);
    printPosts(state);
    printHealth(state);
  },
  async 'archive-fails'() {
    const state = world({
      bookmarks: [TAKE_BOOKMARKS[0]],
      texts: { 501: ARTICLE_HTML },
      fail: { 'bookmarks/archive': { status: 500, body: 'Internal Server Error' } },
    });
    console.log('— tick 1: the archive fails');
    await tick(state);
    printCalls(state);
    printPosts(state);
    printHealth(state);
    console.log('\n— tick 2: Instapaper answers again; the bookmark is still in To Reader');
    const again = world({ bookmarks: [TAKE_BOOKMARKS[0]], texts: { 501: ARTICLE_HTML }, posts: state.posts });
    await tick(again);
    printCalls(again);
    printPosts(again);
    printHealth(again);
  },
  async restore() {
    const state = world({
      bookmarks: [bookmark(9001, 'https://harborline.substack.com/p/the-grain-ledger', 'The Grain Ledger', 50)],
      posts: [
        {
          id: 'post-newsletter',
          source: 'gmail',
          title: 'The Grain Ledger',
          instapaper_bookmark_id: 9001,
          summary_state: 'done',
          archived_at: '2026-09-27T09:00:00.000Z',
        },
      ],
    });
    await tick(state);
    printCalls(state);
    printPosts(state);
  },
  async refused() {
    const state = world({
      bookmarks: TAKE_BOOKMARKS,
      fail: { 'folders/list': { status: 401, body: 'Unauthorized' } },
    });
    await tick(state);
    printCalls(state);
    printHealth(state);
  },
  async capped() {
    const state = world({ bookmarks: TAKE_BOOKMARKS, callsToday: 30 });
    await tick(state);
    printCalls(state);
  },
  async unconfigured() {
    const state = world({ bookmarks: TAKE_BOOKMARKS });
    await tick(state, BASE_ENV);
    printCalls(state);
  },
};

const section = sections[process.argv[2] ?? ''];
if (section === undefined) {
  console.error(`usage: to-reader-harness.mjs <${Object.keys(sections).join(' | ')}>`);
  process.exitCode = 1;
} else {
  await section();
}
