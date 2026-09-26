#!/usr/bin/env node
/**
 * The wiki send routes' contract, against the real Next app booted by `with-app.sh`.
 *
 *   docs/demos/alf-261-day-2-wiki/with-app.sh <section>
 *
 *   reader    POST /api/reader/posts/:id/wiki — the response, then the commit it put on main
 *   inbox     POST /api/wiki/items — a two-item dispatch, then a refused one
 *   secrets   what reaches the client: the wiki config, the page index, the Reader page HTML
 *
 * REAL: the route handlers, the wiki writer's Git Data API calls, `@supabase/ssr` sign-in and
 * cookies, the RPCs as the mock implements them. STOOD UP LOCALLY: Supabase and GitHub, both the
 * E2E harness's in-memory mock (`frontend/scripts/mock-supabase.mjs`). The session cookie is
 * minted by `@supabase/ssr` itself signing in against the mock — the same client the app uses —
 * so its name and encoding are the library's, not hand-built.
 *
 * Output is deterministic: ids are literals, the mock numbers its shas in sequence, and today's
 * UTC date (the inbox folder prefix and every `captured`) is masked as <today>.
 */
import process from 'node:process';

import { createServerClient } from '@supabase/ssr';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
const TODAY = new Date().toISOString().slice(0, 10);
const mask = (text) => text.replaceAll(TODAY, '<today>');
const print = (text = '') => console.log(mask(text));

// ── A session cookie, minted by the app's own auth library ──────────────────
const jar = new Map();
const auth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  },
);
const { error: signInError } = await auth.auth.signInWithPassword({
  email: 'demo@alfred.test',
  password: 'demo-password-123',
});
if (signInError) throw signInError;
const COOKIE = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

async function call(method, path, body, { cookie = COOKIE } = {}) {
  const response = await fetch(`${APP}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie === '' ? {} : { Cookie: cookie }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, json: text.startsWith('{') ? JSON.parse(text) : text };
}

async function seed(state) {
  await fetch(`${MOCK}/__mock__/reset`, { method: 'POST' });
  const response = await fetch(`${MOCK}/__mock__/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(`seed failed: ${response.status}`);
}

async function mockState() {
  return (await fetch(`${MOCK}/__mock__/state`)).json();
}

function headCommit(github) {
  return github.commits.find((commit) => commit.sha === github.head);
}

function showCommit(label, github, before) {
  const head = headCommit(github);
  print(`── ${label} ──`);
  print(`main moved      ${before} → ${github.head}`);
  print(`parents         ${JSON.stringify(head.parents)}`);
  print(`message         ${JSON.stringify(head.message)}`);
  print(`commits on main ${String(github.commits.length)} (the mock's init commit + this one)`);
  print('files');
  for (const path of Object.keys(head.files).toSorted()) print(`  ${path}`);
  print(`inbox/ now      ${JSON.stringify(github.inbox)}`);
  return head;
}

function showFile(path, content) {
  print();
  print(`── ${path} ──`);
  print(content.trimEnd());
}

// ── Fixed rows ──────────────────────────────────────────────────────────────
const PUBLICATION = {
  id: '44444444-4444-4444-8444-444444444444',
  handle: 'janedoe',
  name: 'Jane Doe',
  domain: 'janedoe.substack.com',
};
const POST_ID = '55555555-5555-4555-8555-555555555561';
const BODY = 'Habits are the compound interest of self-improvement.';
const IDEAS = [
  'Habit stacking works because the cue is an existing routine, not a time of day.',
  'Environment design beats willpower for the first thirty days.',
  'Streak-tracking helps only until the first miss.',
  'Identity-based framing outlasts outcome goals.',
];
const POST = {
  id: POST_ID,
  publication_id: PUBLICATION.id,
  gmail_message_id: 'demo-gmail-1',
  title: 'Why habits stick',
  author: 'Jane Doe',
  canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
  text: BODY,
  word_count: 1640,
  summary_state: 'done',
  headline: 'Cues beat clocks',
  gist: "Routines anchored to an existing cue survive; routines anchored to a clock time don't.",
  overview: {
    novel_ideas: IDEAS,
    evidence: ['A 90-day diary study of 212 participants.'],
    argument: 'Cue-anchored routines survive a disrupted day; clock-anchored ones do not.',
    who_should_read: 'Anyone rebuilding a routine.',
  },
  received_at: '2026-09-16T12:00:00.000Z',
};

async function reader() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  const before = (await mockState()).github.head;

  print(`POST /api/reader/posts/${POST_ID}/wiki`);
  const picked = [IDEAS[1], IDEAS[2]];
  print(JSON.stringify({ ideas: picked }, undefined, 2));
  const sent = await call('POST', `/api/reader/posts/${POST_ID}/wiki`, { ideas: picked });
  print();
  print(`→ ${String(sent.status)}  (the row, as the list shows it)`);
  print(`id              ${sent.json.id}`);
  print(`wiki_sent_ideas ${JSON.stringify(sent.json.wiki_sent_ideas, undefined, 2)}`);
  print(`has "text" key  ${String('text' in sent.json)}`);
  print(`body anywhere   ${String(sent.text.includes(BODY))}`);
  print();

  const { github } = await mockState();
  const head = showCommit('the commit on the mock GitHub', github, before);
  for (const path of Object.keys(head.files).toSorted()) showFile(path, head.files[path]);

  print();
  print('Sending the same two again: nothing left to send, so no commit.');
  const again = await call('POST', `/api/reader/posts/${POST_ID}/wiki`, { ideas: picked });
  const after = (await mockState()).github;
  print(`→ ${String(again.status)}  main still at ${after.head}  commits ${String(after.commits.length)}`);

  print();
  print('A bullet the overview no longer offers:');
  const stale = await call('POST', `/api/reader/posts/${POST_ID}/wiki`, { ideas: ['Not in it.'] });
  print(`→ ${String(stale.status)}  ${stale.text}`);
}

async function inbox() {
  const knowledge = [
    {
      id: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
      title: 'Tests are back-pressure on generation',
      notes: 'A red check steers the next attempt; a weakened one steers nothing.',
      item_type: 'knowledge',
    },
    {
      id: '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c',
      title: 'Capture first, triage later',
      source_url: 'https://example.com/capture-first',
      item_type: 'knowledge',
    },
  ];
  const task = { id: '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e', title: 'Renew passport', item_type: 'task' };
  await seed({ items: [...knowledge, task] });
  const before = (await mockState()).github.head;

  const ids = knowledge.map((item) => item.id);
  print('POST /api/wiki/items');
  print(JSON.stringify({ ids }, undefined, 2));
  const sent = await call('POST', '/api/wiki/items', { ids });
  print(`→ ${String(sent.status)}  ${sent.text}`);
  print();

  const { github, items } = await mockState();
  const head = showCommit('ONE commit for both, one folder each', github, before);
  for (const path of Object.keys(head.files).toSorted()) showFile(path, head.files[path]);
  print();
  print(`Inbox rows left in Alfred: ${JSON.stringify(items.map((item) => item.title))}`);

  print();
  print('A task is not knowledge — refused whole, nothing committed:');
  const refused = await call('POST', '/api/wiki/items', { ids: [task.id] });
  const after = (await mockState()).github;
  print(`→ ${String(refused.status)}  ${refused.text}`);
  print(`main still at ${after.head}`);
}

async function secrets() {
  const PAGE_BODY = 'A new habit survives when its cue is something you already do.';
  await seed({
    readerPublications: [PUBLICATION],
    readerPosts: [POST],
    wikiPages: [
      {
        path: 'wiki/concepts/habit-stacking.md',
        title: 'Habit stacking',
        summary: 'Anchor a new habit to an existing one.',
        body: PAGE_BODY,
        blob_oid: 'b'.repeat(40),
        commit_oid: 'c'.repeat(40),
        synced_at: '2026-09-24T08:00:00.000Z',
      },
    ],
    wikiSync: [{ commit_oid: 'c'.repeat(40), synced_at: '2026-09-24T08:00:00.000Z' }],
  });
  const TOKEN = process.env.WIKI_GITHUB_TOKEN;

  print('Signed out, every wiki route is a 401:');
  for (const [method, path, body] of [
    ['GET', '/api/wiki/pages'],
    ['POST', `/api/reader/posts/${POST_ID}/wiki`, { ideas: [IDEAS[0]] }],
    ['POST', '/api/wiki/items', { ids: [POST_ID] }],
  ]) {
    const response = await call(method, path, body, { cookie: '' });
    print(`  ${method.padEnd(4)} ${path.padEnd(60)} → ${String(response.status)}`);
  }

  print();
  print('GET /api/wiki/pages (signed in) — the index and the sync row, no bodies:');
  const pages = await call('GET', '/api/wiki/pages');
  print(`  → ${String(pages.status)}  keys ${JSON.stringify(Object.keys(pages.json))}`);
  print(`  a page's keys  ${JSON.stringify(Object.keys(pages.json.pages[0]).toSorted())}`);
  print(`  its body text anywhere in the payload  ${String(pages.text.includes(PAGE_BODY))}`);
  print(`  sync  ${JSON.stringify(pages.json.sync)}`);

  print();
  print('GET /reader — the whole server-rendered page, RSC payload included:');
  const html = (await call('GET', '/reader')).text;
  const config = /\{\\?"repo\\?":\\?"[^"\\]+\\?",\\?"writable\\?":(?:true|false)\}/.exec(html);
  print(`  wiki config handed to the client  ${config === null ? '(none)' : config[0].replaceAll('\\"', '"')}`);
  print(`  "${TOKEN}" occurrences       ${String(html.split(TOKEN).length - 1)}`);
  print(`  "WIKI_GITHUB_TOKEN" occurrences   ${String(html.split('WIKI_GITHUB_TOKEN').length - 1)}`);
  print(`  post body (reader_posts.text)     ${String(html.split(BODY).length - 1)} occurrences`);
  print(`  a novel idea (proves the post IS rendered)  ${String(html.includes(IDEAS[0]))}`);
}

const sections = { reader, inbox, secrets };
const section = sections[process.argv[2]];
if (section === undefined) throw new Error(`section: one of ${Object.keys(sections).join(', ')}`);
await section();
