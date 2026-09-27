#!/usr/bin/env node
/**
 * POST /api/reader/posts/:id/wiki with Evidence picks, against the real Next app booted by
 * `with-app.sh`.
 *
 *   docs/demos/alf-271-evidence-to-wiki/with-app.sh <section>...
 *
 *   mixed          one idea + one piece of evidence → one commit, one headed picks file
 *   evidence-only  evidence alone → a picks file with only `## Evidence`
 *   ideas-only     the `{ ideas }` body an older tab still posts → still one commit, now headed
 *   refused        a stale evidence bullet (409), a stale idea reported first, nothing fresh
 *
 * REAL: the route handler, the wiki writer's Git Data API calls, `@supabase/ssr` sign-in and
 * cookies, the `append_wiki_sent_picks` RPC as the mock implements it. STOOD UP LOCALLY: Supabase
 * and GitHub, both the E2E harness's in-memory mock (`frontend/scripts/mock-supabase.mjs`).
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

async function send(body) {
  const response = await fetch(`${APP}/api/reader/posts/${POST_ID}/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify(body),
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

async function github() {
  return (await (await fetch(`${MOCK}/__mock__/state`)).json()).github;
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
];
const EVIDENCE = [
  'Lally et al. (2010): median 66 days to automaticity, ranging from 18 to 254.',
  'A survey of 2,000 habit-app users: streak users lapsed 40% more often after a first miss.',
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
  gist: "Routines anchored to an existing cue survive; routines anchored to a clock time don't.",
  overview: {
    novel_ideas: IDEAS,
    evidence: EVIDENCE,
    argument: 'Cue-anchored routines survive a disrupted day; clock-anchored ones do not.',
    who_should_read: 'Anyone rebuilding a routine.',
  },
  received_at: '2026-09-16T12:00:00.000Z',
};

/** Send `body`, then print the answer and the one commit it put on main, picks file in full. */
async function sendAndShow(body) {
  const before = (await github()).head;
  print(`POST /api/reader/posts/${POST_ID}/wiki`);
  print(JSON.stringify(body, undefined, 2));
  const sent = await send(body);
  print();
  print(`→ ${String(sent.status)}  (the row, as the list shows it)`);
  print(`wiki_sent_ideas    ${JSON.stringify(sent.json.wiki_sent_ideas)}`);
  print(`wiki_sent_evidence ${JSON.stringify(sent.json.wiki_sent_evidence)}`);
  print(`has "text" key     ${String('text' in sent.json)}`);
  print();
  const after = await github();
  const head = after.commits.find((commit) => commit.sha === after.head);
  print(`main moved ${before} → ${after.head}, parents ${JSON.stringify(head.parents)}`);
  print(`commits on main ${String(after.commits.length)} (the mock's init commit + this one)`);
  for (const path of Object.keys(head.files).toSorted()) print(`  ${path}`);
  const picks = Object.keys(head.files).find((path) => /\/picks-[\d-]+\.md$/.test(path));
  print();
  print(`── ${picks} ──`);
  print(head.files[picks].trimEnd());
}

async function mixed() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  print('One idea and one piece of evidence, one request:');
  print();
  await sendAndShow({ ideas: [IDEAS[1]], evidence: [EVIDENCE[0]] });
}

async function evidenceOnly() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  print('Evidence alone:');
  print();
  await sendAndShow({ evidence: EVIDENCE });
}

async function ideasOnly() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  print("Today's `{ ideas }` body, as a tab still on the previous bundle posts it:");
  print();
  await sendAndShow({ ideas: [IDEAS[0]] });
}

async function refused() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  const start = (await github()).head;
  const cases = [
    ['an evidence bullet the overview no longer offers', { evidence: ['Reworded evidence.'] }],
    ['a stale idea AND stale evidence', { ideas: ['A reworded idea.'], evidence: ['Reworded.'] }],
    ['an idea sent as evidence', { evidence: [IDEAS[0]] }],
    ['neither list', {}],
    ['a blank evidence bullet', { evidence: ['  '] }],
  ];
  for (const [label, body] of cases) {
    const answer = await send(body);
    print(`${label}: ${JSON.stringify(body)}`);
    print(`  → ${String(answer.status)}  ${answer.text}`);
  }
  print();
  print('Sending one piece of evidence, then the same one again: the second has nothing fresh.');
  await send({ evidence: [EVIDENCE[0]] });
  const once = (await github()).head;
  const again = await send({ evidence: EVIDENCE.slice(0, 1) });
  const after = await github();
  print(`  → ${String(again.status)}  main still at ${after.head} (was ${once})`);
  print(`  wiki_sent_evidence ${JSON.stringify(again.json.wiki_sent_evidence)}`);
  print(`  every refusal above committed nothing: main went ${start} → ${once} once`);
}

const SECTIONS = {
  mixed,
  'evidence-only': evidenceOnly,
  'ideas-only': ideasOnly,
  refused,
};
const section = SECTIONS[process.argv[2]];
if (section === undefined) {
  console.error(`picks-contract.mjs: unknown section ${process.argv[2]}`);
  process.exitCode = 2;
} else {
  print(`════ ${process.argv[2]} ════`);
  await section();
  print();
}
