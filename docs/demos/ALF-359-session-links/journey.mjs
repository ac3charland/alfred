#!/usr/bin/env node
/**
 * The session-links journey against the real Next app booted by `with-app.sh`:
 *
 *   1. ALF-5 open in the story detail with no sessions recorded: no Sessions section.
 *   2. The hook's first-prompt write, POSTed to the real record route: the row it leaves, with the
 *      launch lane the route read from the prompt.
 *   3. The first stop, carrying a later message and another ref: the prompt, ref and lane stay.
 *   4. A backfill re-run with no lane keeps the recorded one.
 *   5. ALF-5 reopened: the Sessions section lists the session (and not the same ref recorded in
 *      another repo, nor the epic's own session, both seeded beside it).
 *
 * REAL: the record route, its lane classification, the shell layout's seed read, the store and the
 * story detail. STOOD UP LOCALLY: Supabase, as the E2E harness's in-memory mock, which mirrors the
 * RPCs' column ownership but has no realtime socket — so step 5 reopens the page; a live arrival
 * over the `code_sessions` channel is pinned by the code-store tests instead.
 */
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
const SHOTS = process.argv[2];
const LEDGER = { 'Content-Type': 'application/json', Authorization: 'Bearer mock_ledger_key' };

const PROJECT = '11111111-1111-4111-8111-111111111111';
const EPIC = '22222222-2222-4222-8222-222222222222';
const ITEM = '44444444-4444-4444-8444-444444444444';
const SESSION = 'session_01DemoRefine';
const PROMPT = [
  'ALF-5: Log the session URL back to the ticket',
  '',
  'You are refining the ticket ALF-5. Produce a SPEC ONLY — describe the concrete change.',
].join('\n');

async function post(url, body, headers = { 'Content-Type': 'application/json' }) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${url}: ${String(response.status)} ${await response.text()}`);
  return response.json();
}

async function row(label) {
  const state = await (await fetch(`${MOCK}/__mock__/state`)).json();
  const found = state.codeSessions.find((s) => s.session_id === SESSION);
  const { session_id, ref, launch_lane, prompt_source, prompt } = found;
  console.log(`${label}:`);
  console.log(JSON.stringify({ session_id, ref, launch_lane, prompt_source, prompt }, null, 2));
}

await post(`${MOCK}/__mock__/seed`, {
  projects: [{ id: PROJECT, name: 'Alfred', key: 'ALF', repo_owner: 'ac3charland', repo_name: 'alfred' }],
  epics: [{ id: EPIC, project_id: PROJECT, name: 'Session ledger', ref_number: 1, ref: 'ALF-1' }],
  items: [{ id: ITEM, title: 'Log the session URL back to the ticket', item_type: 'code' }],
  codeItems: [
    { item_id: ITEM, project_id: PROJECT, epic_id: EPIC, ref_number: 5, ref: 'ALF-5', factory_state: 'in_refinement' },
  ],
  codeSessions: [
    // Not ALF-5's: the same ref recorded in another repo, and the epic's own session.
    { session_id: 'session_01Elsewhere', repo: 'ac3charland/realplay', ref: 'ALF-5', launch_lane: 'bug', session_created_at: '2026-11-22T09:00:00Z' },
    { session_id: 'session_01Epic', repo: 'ac3charland/alfred', ref: 'ALF-1', launch_lane: 'epic-refinement', session_created_at: '2026-11-19T11:47:00Z' },
  ],
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${APP}/login`);
await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL);
await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(`${APP}/`);

async function shoot(name) {
  await page.goto(`${APP}/code/${PROJECT}`);
  await page.getByRole('button', { name: /open ALF-5/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.screenshot({ path: path.join(SHOTS, name) });
  const sections = await dialog.getByRole('heading', { level: 3 }).allTextContents();
  const links = await dialog.getByRole('link').evaluateAll((all) =>
    all.filter((a) => a.href.startsWith('https://claude.ai/code/')).map((a) => `${a.textContent} → ${a.href}`),
  );
  console.log(`${name}: sections ${JSON.stringify(sections)}; session links ${JSON.stringify(links)}`);
}

await shoot('before.png');

await post(`${APP}/api/code/sessions/record`, {
  event: 'session-start', session_id: SESSION, repo: 'ac3charland/alfred',
  session_created_at: '2026-11-21T09:14:00Z', base_sha: 'a'.repeat(40), builder_sha: null, warnings: [],
}, LEDGER);
await post(`${APP}/api/code/sessions/record`, {
  event: 'prompt', session_id: SESSION, repo: 'ac3charland/alfred', prompt: PROMPT, skills: [],
  ref: 'ALF-5', warnings: [],
}, LEDGER);
await row('after the first-prompt write');

await post(`${APP}/api/code/sessions/record`, {
  event: 'stop', session_id: SESSION, repo: 'ac3charland/alfred', prompt: 'ALF-9: a later message',
  skills: [], ref: 'ALF-9', warnings: [],
}, LEDGER);
await row('after the first stop');

await post(`${MOCK}/rest/v1/rpc/upsert_code_sessions`, {
  p_rows: [{ session_id: SESSION, repo: 'ac3charland/alfred', ref: null, launch_lane: null, prompt: 'a rebuilt guess', prompt_source: 'reconstructed' }],
});
await row('after a backfill re-run with no lane');

await shoot('after.png');
await browser.close();
