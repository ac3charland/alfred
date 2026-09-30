#!/usr/bin/env node
/**
 * The two Comms routes this change touches, against the real Next app booted by `with-app.sh`.
 *
 *   docs/demos/alf-221-rerun-feedback/with-app.sh <section>
 *
 *   snapshot    GET /api/comms/snapshot?watch=… — the named rows come back in `watched`, wherever
 *               they sit; a malformed id and too many ids are refused; none asked, none read
 *   reclassify  POST /api/comms/messages/:id/reclassify — asking again clears an earlier failure
 *
 * REAL: the route handlers, the read layer behind them, `@supabase/ssr` sign-in and its cookies.
 * STOOD UP LOCALLY: Supabase, as the E2E harness's in-memory mock (`frontend/scripts/mock-supabase.mjs`).
 *
 * Output is deterministic: ids are literals, and the one instant the server stamps is masked.
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

async function call(method, path) {
  const response = await fetch(`${APP}${path}`, { method, headers: { Cookie: COOKIE } });
  const text = await response.text();
  return { status: response.status, json: JSON.parse(text) };
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

// ── Fixed rows ──────────────────────────────────────────────────────────────
const ACCOUNT = { id: '11111111-1111-4111-8111-111111111111', key: 'personal', label: 'personal' };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DANA = id(1);

/** A judged inbound row; `n` sets its id and, newest first, how far back it arrived. */
function message(n, overrides = {}) {
  return {
    id: id(n),
    account_id: ACCOUNT.id,
    sender_handle: `sender${String(n)}@example.com`,
    sender_name: `Sender ${String(n)}`,
    subject: `Subject ${String(n)}`,
    tier: 'fyi',
    judged_by: 'model',
    ask: 'Nothing asked.',
    received_at: new Date(Date.UTC(2099, 0, 1) - n * 60_000).toISOString(),
    ...overrides,
  };
}

const brief = (row) => ({
  id: row.id,
  tier: row.tier,
  reclassify_requested_at: row.reclassify_requested_at,
  reclassify_failed_at: row.reclassify_failed_at,
});

async function snapshot() {
  // Dana's row was re-run and demoted to FYI. Three newer shelf rows sit above it, and this tab
  // holds a shelf page of ONE row — so the snapshot itself no longer reaches Dana's row at all.
  const dana = message(1, { subject: 'Thursday standup', received_at: '2098-12-31T00:00:00.000Z' });
  await seed({
    commAccounts: [ACCOUNT],
    commMessages: [dana, message(2), message(3), message(4)],
  });
  const heldIds = (json) => json.messages.map((row) => row.id.slice(-2));

  print('GET /api/comms/snapshot?shelf=1');
  const plain = await call('GET', '/api/comms/snapshot?shelf=1');
  print(`  status         ${String(plain.status)}`);
  print(`  messages held  ${JSON.stringify(heldIds(plain.json))}   (Dana is 01: not among them)`);
  print(`  watched        ${JSON.stringify(plain.json.watched)}`);

  print();
  print(`GET /api/comms/snapshot?shelf=1&watch=${DANA}`);
  const watched = await call('GET', `/api/comms/snapshot?shelf=1&watch=${DANA}`);
  print(`  status         ${String(watched.status)}`);
  print(`  messages held  ${JSON.stringify(heldIds(watched.json))}   (unchanged: watched is never merged in)`);
  print(`  watched        ${JSON.stringify(watched.json.watched.map(brief))}`);

  print();
  print(`GET /api/comms/snapshot?watch= (empty)`);
  const empty = await call('GET', '/api/comms/snapshot?watch=');
  print(`  status ${String(empty.status)}, watched ${JSON.stringify(empty.json.watched)}`);

  print();
  print(`GET /api/comms/snapshot?watch=${DANA},not-an-id`);
  const malformed = await call('GET', `/api/comms/snapshot?watch=${DANA},not-an-id`);
  print(`  status ${String(malformed.status)}, error ${JSON.stringify(malformed.json.error)}`);

  const many = (count) => Array.from({ length: count }, (_unused, index) => id(100 + index));
  print();
  print('GET /api/comms/snapshot?watch=<20 ids>');
  const atLimit = await call('GET', `/api/comms/snapshot?watch=${many(20).join(',')}`);
  print(`  status ${String(atLimit.status)}, watched ${JSON.stringify(atLimit.json.watched)}   (ids that match no row are simply absent)`);
  print('GET /api/comms/snapshot?watch=<21 ids>');
  const overLimit = await call('GET', `/api/comms/snapshot?watch=${many(21).join(',')}`);
  print(`  status ${String(overLimit.status)}, error ${JSON.stringify(overLimit.json.error)}`);
}

async function reclassify() {
  await seed({
    commAccounts: [ACCOUNT],
    commMessages: [
      message(1, {
        tier: 'today',
        classify_attempts: 5,
        reclassify_failed_at: '2098-12-31T09:58:00.000Z',
      }),
    ],
  });
  const stored = async () => (await mockState()).commMessages.find((row) => row.id === DANA);

  const before = await stored();
  print('the row, after a re-run the Worker gave up on');
  print(`  classify_attempts        ${String(before.classify_attempts)}`);
  print(`  reclassify_requested_at  ${String(before.reclassify_requested_at)}`);
  print(`  reclassify_failed_at     ${String(before.reclassify_failed_at)}`);

  print();
  print(`POST /api/comms/messages/${DANA}/reclassify`);
  const asked = await call('POST', `/api/comms/messages/${DANA}/reclassify`);
  print(`  status ${String(asked.status)}`);
  print(`  classify_attempts        ${String(asked.json.classify_attempts)}`);
  print(`  reclassify_requested_at  ${asked.json.reclassify_requested_at === null ? 'null' : '<now>'}`);
  print(`  reclassify_failed_at     ${String(asked.json.reclassify_failed_at)}`);
  print(`  tier                     ${asked.json.tier}   (the request only asks; the Worker judges)`);

  const after = await stored();
  print();
  print('the mock database, read back');
  print(`  reclassify_failed_at     ${String(after.reclassify_failed_at)}`);
  print(`  request pending          ${String(after.reclassify_requested_at !== null)}`);
}

const sections = { snapshot, reclassify };
const run = sections[process.argv[2] ?? ''];
if (run === undefined) throw new Error(`unknown section: ${process.argv[2]}`);
await run();
