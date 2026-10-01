#!/usr/bin/env node
/**
 * The owner's journey through a post's Further reading, in the real app booted by `with-app.sh`,
 * shot with the E2E suite's own Chromium. Every send below goes through the real route, the real
 * signed Instapaper calls and the real append RPC — against the mock that stands in for Supabase
 * and Instapaper.
 *
 *   docs/demos/alf-289-further-reading/with-app.sh journey journey-unconfigured
 *
 *   configured     picking → sent to the Reader → one sent to Instapaper → a send that part-lands
 *                  → an account with no "To Reader" folder (the 409 toast)
 *   unconfigured   the same post on a deployment without Instapaper credentials: a plain list
 *
 * Shots land in <tmpdir>/alf-289-journey/journey-<state>.png (the path is printed at the end);
 * the doc embeds copies of them with `demo image`.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';

const APP = process.env.APP_URL;
const MOCK = process.env.MOCK_URL;
// Shots go to a scratch folder, printed at the end; the doc embeds copies (`demo image`), so a
// re-run never writes beside the committed ones.
const OUT = path.join(tmpdir(), 'alf-289-journey');
mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, `journey-${name}.png`);

const PUBLICATION = {
  id: '44444444-4444-4444-8444-444444444444',
  handle: 'importai',
  name: 'Import AI',
  domain: 'importai.substack.com',
};
const POST_ID = '55555555-5555-4555-8555-555555555589';
const TITLE = 'Import AI 412: three new evals, and a robot that folds';
const SIM_TO_REAL = 'The sim-to-real gap in dexterous manipulation';
const WHY_EVALS = 'Why most robotics evals don’t transfer';
const FOLDBENCH = 'FoldBench v2 release notes';
const SCEPTIC = 'A sceptic’s reply to “scale the simulator”';
const FURTHER_READING = [
  {
    url: 'https://substack.com/redirect/3d7a91c2-6b04-4e58-a1f3-0c52de9b7e10',
    title: SIM_TO_REAL,
    note: 'The paper behind the lead item — per-task numbers for the folding benchmark.',
  },
  {
    url: 'https://substack.com/redirect/b82e4f10-93ac-4d6e-8c17-5a0e61f3d2b9',
    title: WHY_EVALS,
    note: 'An essay arguing the suite measures the simulator, not the policy.',
  },
  { url: 'https://example.org/foldbench-v2', title: FOLDBENCH, note: 'The eval itself; skim it for the task list.' },
  {
    url: 'https://example.org/scale-the-simulator-reply',
    title: SCEPTIC,
    note: 'The counter-argument the author calls the best case against his own view.',
  },
];
const POST = {
  id: POST_ID,
  publication_id: PUBLICATION.id,
  gmail_message_id: 'demo-gmail-289',
  title: TITLE,
  author: 'Jack Clark',
  canonical_url: 'https://importai.substack.com/p/import-ai-412',
  text: 'Roundup issue.',
  word_count: 2100,
  summary_state: 'done',
  prompt_version: 2,
  model: 'the summariser',
  summarized_at: '2026-09-16T12:05:00.000Z',
  gist: 'Roundup issue. Most of it restates last week’s benchmark releases; the one new item is a robotics dexterity eval with a surprising sim-to-real gap. Worth the links more than the issue.',
  overview: {
    novel_ideas: ['A robotics dexterity eval with a sim-to-real gap nobody expected.'],
    evidence: ['FoldBench v2: per-task numbers for the folding benchmark.'],
    argument: 'Three evals, one of which matters: the folding benchmark’s sim-to-real gap.',
    who_should_read: 'Robotics people; everyone else can stop at the links.',
    further_reading: FURTHER_READING,
  },
  received_at: '2026-09-16T12:00:00.000Z',
};

async function seed(state) {
  await fetch(`${MOCK}/__mock__/reset`, { method: 'POST' });
  const response = await fetch(`${MOCK}/__mock__/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readerPublications: [PUBLICATION], readerPosts: [POST], ...state }),
  });
  if (!response.ok) throw new Error(`seed failed: ${response.status}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
try {
  await page.goto(`${APP}/login`);
  await page.getByLabel('Email').fill('demo@alfred.test');
  await page.getByLabel('Password').fill('demo-password-123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));

  const row = () => page.getByTestId('reader-row').filter({ hasText: TITLE });
  const open = async () => {
    await page.goto(`${APP}/reader`);
    await row().getByRole('button', { name: 'Overview' }).click();
    await row().getByRole('heading', { name: 'Further reading' }).waitFor();
  };
  const tick = (title) => row().getByRole('checkbox', { name: new RegExp(title) }).click();
  const settle = () => page.waitForTimeout(600);

  if (process.argv[2] === 'unconfigured') {
    await seed({});
    await open();
    await settle();
    await row().screenshot({ path: shot('unconfigured') });
    console.log('unconfigured: a plain list of links, no ticks, no bar');
  } else {
    // 1. Picking: two ticked, the bar with its two sends.
    await seed({});
    await open();
    await tick(SIM_TO_REAL);
    await tick(FOLDBENCH);
    await row().getByText('2 selected').waitFor();
    await settle();
    await row().screenshot({ path: shot('picking') });
    console.log('picking: 2 selected');

    // 2. Send to Reader: both land in the To Reader folder and read In Reader.
    await row().getByRole('button', { name: 'Send to Reader' }).click();
    await row().getByTestId('further-reading-in-reader').nth(1).waitFor();
    await settle();
    await row().screenshot({ path: shot('sent-to-reader') });
    console.log('sent to Reader: 2 marked In Reader');

    // 3. Send one to Instapaper: it reads In Instapaper, muted.
    await tick(WHY_EVALS);
    // The bar's button, not the row's own Send verb, which shares its name.
    await row()
      .getByRole('group', { name: 'Selected links' })
      .getByRole('button', { name: 'Send to Instapaper' })
      .click();
    await row().getByTestId('further-reading-in-instapaper').waitFor();
    await settle();
    await row().screenshot({ path: shot('sent-to-instapaper') });
    const calls = (await (await fetch(`${MOCK}/__mock__/state`)).json()).instapaperRequests;
    console.log(
      `sent to Instapaper: 1 marked In Instapaper; Instapaper calls so far: ${calls
        .map((call) => `${call.path.split('/').slice(-2).join('/')}${call.params.folder_id ? ' folder ' + call.params.folder_id : ''}`)
        .join(', ')}`,
    );

    // 4. A send that part-lands: the second add fails, the first is marked, the other stays ticked.
    await seed({ instapaperAddFailAfter: 1 });
    await open();
    await tick(SIM_TO_REAL);
    await tick(SCEPTIC);
    await row().getByRole('button', { name: 'Send to Reader' }).click();
    await page.getByText(/^Sent 1 of 2 to Reader/).waitFor();
    await settle();
    await page.screenshot({ path: shot('one-send-failed') });
    console.log(`one send failed: toast "${await page.getByText(/^Sent 1 of 2 to Reader/).innerText()}"`);

    // 5. No "To Reader" folder: a 409 and nothing saved.
    await seed({ instapaperFolders: [] });
    await open();
    await tick(SIM_TO_REAL);
    await row().getByRole('button', { name: 'Send to Reader' }).click();
    await page.getByText(/There is no “To Reader” folder/).waitFor();
    await settle();
    await page.screenshot({ path: shot('no-folder') });
    const after = (await (await fetch(`${MOCK}/__mock__/state`)).json()).instapaperRequests;
    console.log(
      `no folder: toast "${await page.getByText(/There is no “To Reader” folder/).innerText()}"; adds made: ${after.filter((call) => call.path.endsWith('/add')).length}`,
    );
  }
} finally {
  await browser.close();
  console.log(`shots in ${OUT}`);
}
