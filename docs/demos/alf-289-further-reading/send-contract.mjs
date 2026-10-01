#!/usr/bin/env node
/**
 * POST /api/reader/posts/:id/further-reading, against the real Next app booted by `with-app.sh`.
 *
 *   docs/demos/alf-289-further-reading/with-app.sh <section>...
 *
 *   reader        two links → the "To Reader" folder: 200, both marked In Reader, two bookmarks/add
 *   instapaper    one link → Unread: no folder_id, marked In Instapaper
 *   no-folder     an account with no "To Reader" folder: 409, nothing saved, nothing marked
 *   nothing-left  a URL already sent and one the overview never offered: 200, row unchanged
 *   refused       bad bodies (400) and Instapaper rejecting the credentials (502, nothing marked)
 *
 * REAL: the route handler, the signed Instapaper calls, `@supabase/ssr` sign-in and cookies, the
 * `append_further_reading_sent` RPC as the mock implements it. STOOD UP LOCALLY: Supabase and
 * Instapaper, both the E2E harness's in-memory mock (`frontend/scripts/mock-supabase.mjs`), which
 * records every Instapaper request it was handed. Output is deterministic: ids are literals and
 * the mock numbers its bookmark ids in sequence.
 */
import process from 'node:process';

import { createServerClient } from '@supabase/ssr';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
const print = (text = '') => console.log(text);

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
  const response = await fetch(`${APP}/api/reader/posts/${POST_ID}/further-reading`, {
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

/** Every Instapaper call the mock has answered since the seed. */
async function instapaperRequests() {
  return (await (await fetch(`${MOCK}/__mock__/state`)).json()).instapaperRequests;
}

// ── Fixed rows ──────────────────────────────────────────────────────────────
const PUBLICATION = {
  id: '44444444-4444-4444-8444-444444444444',
  handle: 'importai',
  name: 'Import AI',
  domain: 'importai.substack.com',
};
const POST_ID = '55555555-5555-4555-8555-555555555589';
const SIM_TO_REAL = 'https://substack.com/redirect/3d7a91c2-6b04-4e58-a1f3-0c52de9b7e10';
const WHY_EVALS = 'https://substack.com/redirect/b82e4f10-93ac-4d6e-8c17-5a0e61f3d2b9';
const FOLDBENCH = 'https://example.org/foldbench-v2';
const SCEPTIC = 'https://example.org/scale-the-simulator-reply';
const FURTHER_READING = [
  {
    url: SIM_TO_REAL,
    title: 'The sim-to-real gap in dexterous manipulation',
    note: 'The paper behind the lead item — per-task numbers for the folding benchmark.',
  },
  {
    url: WHY_EVALS,
    title: 'Why most robotics evals don’t transfer',
    note: 'An essay arguing the suite measures the simulator, not the policy.',
  },
  { url: FOLDBENCH, title: 'FoldBench v2 release notes', note: 'The eval itself; skim it for the task list.' },
  {
    url: SCEPTIC,
    title: 'A sceptic’s reply to “scale the simulator”',
    note: 'The counter-argument the author calls the best case against his own view.',
  },
];
const POST = {
  id: POST_ID,
  publication_id: PUBLICATION.id,
  gmail_message_id: 'demo-gmail-289',
  title: 'Import AI 412: three new evals, and a robot that folds',
  author: 'Jack Clark',
  canonical_url: 'https://importai.substack.com/p/import-ai-412',
  text: 'Roundup issue.',
  word_count: 2100,
  summary_state: 'done',
  prompt_version: 2,
  gist: 'Roundup issue. Most of it restates last week’s benchmark releases; the one new item is a robotics dexterity eval with a surprising sim-to-real gap.',
  overview: {
    novel_ideas: [],
    evidence: [],
    argument: 'Three evals, one of which matters.',
    who_should_read: 'Robotics people; everyone else can stop here.',
    further_reading: FURTHER_READING,
  },
  received_at: '2026-09-16T12:00:00.000Z',
};

/** Send `body`, then print the answer's marks and every Instapaper call it made. */
async function sendAndShow(body) {
  const before = (await instapaperRequests()).length;
  print(`POST /api/reader/posts/${POST_ID}/further-reading`);
  print(JSON.stringify(body, undefined, 2));
  const sent = await send(body);
  print();
  if (sent.status === 200) {
    print(`→ 200`);
    print(`further_sent_reader     ${JSON.stringify(sent.json.post.further_sent_reader)}`);
    print(`further_sent_instapaper ${JSON.stringify(sent.json.post.further_sent_instapaper)}`);
    print(`unsent                  ${JSON.stringify(sent.json.unsent)}`);
    print(`has "text" key          ${String('text' in sent.json.post)}`);
  } else {
    print(`→ ${String(sent.status)}  ${sent.text}`);
  }
  print();
  const calls = (await instapaperRequests()).slice(before);
  print(`Instapaper calls: ${String(calls.length)}`);
  for (const call of calls) {
    const { url, title, description, folder_id: folderId, content } = call.params;
    const signed = call.authorization.includes('oauth_signature=') ? 'signed' : 'UNSIGNED';
    print(`  ${call.path}  (${signed})`);
    if (!call.path.endsWith('/bookmarks/add')) continue;
    print(`    url          ${url}`);
    print(`    title        ${title}`);
    print(`    description  ${description ?? '(none)'}`);
    print(`    folder_id    ${folderId ?? '(none — Unread)'}`);
    print(`    content      ${content === undefined ? '(none — Instapaper fetches the page)' : 'PRESENT'}`);
  }
}

async function reader() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  print('Two links to the Reader — saved one at a time into the "To Reader" folder (id 7 in the mock):');
  print();
  await sendAndShow({ destination: 'reader', urls: [SIM_TO_REAL, FOLDBENCH] });
}

async function instapaper() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  print('One link straight to Instapaper — no folder, so it lands in Unread, and no folders/list call:');
  print();
  await sendAndShow({ destination: 'instapaper', urls: [WHY_EVALS] });
}

async function noFolder() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST], instapaperFolders: [] });
  print('The owner’s Instapaper has no "To Reader" folder:');
  print();
  await sendAndShow({ destination: 'reader', urls: [SIM_TO_REAL] });
}

async function nothingLeft() {
  await seed({
    readerPublications: [PUBLICATION],
    readerPosts: [{ ...POST, further_sent_reader: [SIM_TO_REAL] }],
  });
  print('A URL already sent to the Reader, sent again to Instapaper, beside one the overview never offered:');
  print();
  await sendAndShow({
    destination: 'instapaper',
    urls: [SIM_TO_REAL, 'https://example.org/not-in-this-post'],
  });
}

async function refused() {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST] });
  const cases = [
    ['no urls', { destination: 'reader', urls: [] }],
    ['eleven urls', { destination: 'reader', urls: Array.from({ length: 11 }, (_, i) => `https://example.org/${String(i)}`) }],
    ['a javascript: link', { destination: 'reader', urls: ['javascript:alert(1)'] }],
    ['an unknown destination', { destination: 'wiki', urls: [SIM_TO_REAL] }],
  ];
  for (const [label, body] of cases) {
    const answer = await send(body);
    print(`${label}: → ${String(answer.status)}  ${answer.text}`);
  }
  print();
  print('Instapaper rejecting alfred’s credentials (error 1042) on the first save: nothing lands, nothing is marked.');
  await seed({ readerPublications: [PUBLICATION], readerPosts: [POST], instapaperErrorCode: 1042 });
  await sendAndShow({ destination: 'instapaper', urls: [SIM_TO_REAL, WHY_EVALS] });
}

const SECTIONS = {
  reader,
  instapaper,
  'no-folder': noFolder,
  'nothing-left': nothingLeft,
  refused,
};
const section = SECTIONS[process.argv[2]];
if (section === undefined) {
  console.error(`send-contract.mjs: unknown section ${process.argv[2]}`);
  process.exitCode = 2;
} else {
  print(`════ ${process.argv[2]} ════`);
  await section();
  print();
}
