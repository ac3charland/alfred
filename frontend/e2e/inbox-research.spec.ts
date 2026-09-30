import type { APIRequestContext, Page } from '@playwright/test';

import {
  MOCK_URL,
  RESEARCH_DELIVERY_KEY,
  RESEARCH_ROUTINE_FIRE_TOKEN,
  makeItem,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Research rows, end to end: a capture classified as Research wears the binoculars, and Dispatch
 * turns it into a queued Reader post and fires the research Routine — then the Routine's session
 * delivers its report through the keyed delivery route and the post becomes an ordinary one,
 * waiting on its summary. Proven across the whole stack because the claim spans it: the row menu,
 * the store's request, the route's RPC and its fire (which leaves the Next server, so the mock
 * answers `/fire` itself — RESEARCH_ROUTINE_FIRE_URL in playwright.config.ts — and records what it
 * was sent), the Reader row's phases, and the delivery route's write.
 */

interface MockState {
  items: { id: string }[];
  routineFires: { authorization: string; beta: string; text: string }[];
  readerPosts: {
    id: string;
    source: string;
    title: string;
    research_state: string | null;
    research_session_url: string | null;
    research_error: string | null;
    summary_state: string;
    word_count: number;
  }[];
}

async function mockState(request: APIRequestContext): Promise<MockState> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  return (await response.json()) as MockState;
}

/** How many fires the stand-in Routine has recorded. */
async function fireCount(request: APIRequestContext): Promise<number> {
  const { routineFires } = await mockState(request);
  return routineFires.length;
}

const QUESTION = 'Is a cold-climate heat pump worth it for our Chicago house?';
const NOTES = 'Compare against the gas furnace — running cost, rebates, what happens at −10°F.';

const REPORT = [
  `# ${QUESTION}`,
  '',
  '*Researched 2026-09-29 · 2 sources*',
  '',
  '## Bottom line',
  '',
  'Probably yes, if the furnace has under five years left [1][2].',
  '',
  '## Sources',
  '',
  '[1] Cold-climate field study — NREL, 2025. https://example.org/nrel',
  '[2] State rebate schedule — Illinois, 2026. https://example.org/rebates',
].join('\n');

/** The Inbox row for a title. */
function inboxRow(page: Page, title: string) {
  return page.getByRole('listitem').filter({ hasText: title });
}

/** The Reader row for a title. */
function readerRow(page: Page, title: string) {
  return page.getByTestId('reader-row').filter({ hasText: title });
}

/** Classify an Inbox row as Research from its menu, then Dispatch it from the same menu. */
async function classifyAndDispatch(page: Page, title: string): Promise<void> {
  const row = inboxRow(page, title);
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
  await page.getByRole('menuitem', { name: 'Research' }).click();

  // The binoculars name the row, and research being configured makes it dispatch-ready.
  await expect(row.getByRole('img', { name: 'Research' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Ready to dispatch' })).toBeVisible();

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();
}

test('classify a capture as Research, dispatch it, and deliver its report to the Reader', async ({
  page,
  request,
  seed,
}) => {
  const question = makeItem(QUESTION, {
    id: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
    notes: NOTES,
  });
  await seed({ items: [question] });

  await page.goto('/?view=inbox');
  await expect(inboxRow(page, QUESTION)).toBeVisible();
  await classifyAndDispatch(page, QUESTION);

  // The question leaves the Inbox, and the toast says where it went.
  await expect(page.getByText('Sent 1 question to research')).toBeVisible();
  await expect(inboxRow(page, QUESTION)).toHaveCount(0);

  // One fire, authenticated and versioned, carrying the new post's id and the brief.
  await expect.poll(() => fireCount(request)).toBe(1);
  const { routineFires, readerPosts, items } = await mockState(request);
  expect(items).toHaveLength(0);
  const [post] = readerPosts;
  expect(post).toMatchObject({
    source: 'research',
    title: QUESTION,
    research_state: 'researching',
    research_session_url: 'https://claude.ai/code/session_mock0001',
  });
  const [fire] = routineFires;
  expect(fire?.authorization).toBe(`Bearer ${RESEARCH_ROUTINE_FIRE_TOKEN}`);
  expect(fire?.beta).toBe('experimental-cc-routine-2026-04-01');
  expect(fire?.text).toBe(`post_id=${String(post?.id)}\n---\n${QUESTION}\n\n${NOTES}`);

  // The Reader shows the question researching, with its session one click away.
  await page.goto('/reader');
  const row = readerRow(page, QUESTION);
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Research', { exact: true })).toBeVisible();
  await expect(row.getByText('researching…', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Session' })).toHaveAttribute(
    'href',
    'https://claude.ai/code/session_mock0001',
  );
  await expect(row.getByRole('button', { name: 'Send to Instapaper' })).toBeDisabled();

  // The session delivers. A wrong key is refused, the right one lands, and a second is a 409.
  const url = `/api/reader/research/${String(post?.id)}`;
  const wrong = await request.put(url, {
    headers: { Authorization: 'Bearer not-the-key' },
    data: { report: REPORT },
  });
  expect(wrong.status()).toBe(401);
  const delivered = await request.put(url, {
    headers: { Authorization: `Bearer ${RESEARCH_DELIVERY_KEY}` },
    data: { report: REPORT },
  });
  expect(delivered.status()).toBe(200);
  const again = await request.put(url, {
    headers: { Authorization: `Bearer ${RESEARCH_DELIVERY_KEY}` },
    data: { report: REPORT },
  });
  expect(again.status()).toBe(409);

  // On the next load the post is an ordinary one waiting on its summary, and Send is live.
  await page.reload();
  await expect(row.getByText('summarising…', { exact: true })).toBeVisible();
  await expect(row.getByText('researching…', { exact: true })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Send to Instapaper' })).toBeEnabled();
  const { readerPosts: after } = await mockState(request);
  const [stored] = after;
  expect(stored).toMatchObject({ research_state: 'done', summary_state: 'pending' });
  expect(stored?.word_count).toBeGreaterThan(0);
});

test('a refused fire reads as no report, and Retry research starts a new session', async ({
  page,
  request,
  seed,
}) => {
  const question = makeItem('What is the evidence on creatine for older adults?', {
    id: '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c',
  });
  await seed({ items: [question], routineFireStatus: 429 });

  await page.goto('/?view=inbox');
  await classifyAndDispatch(page, question.title);
  // A refused fire doesn't change the toast: the question left the Inbox either way.
  await expect(page.getByText('Sent 1 question to research')).toBeVisible();

  await page.goto('/reader');
  const row = readerRow(page, question.title);
  await expect(row.getByText('no report', { exact: true })).toBeVisible();
  await expect(row.getByText(/daily run cap or usage limit was reached/)).toBeVisible();

  // The cap lifts; a retry fires again and the row is researching.
  await request.post(`${MOCK_URL}/__mock__/routine/respond`, { data: { status: 200 } });
  await row.getByRole('button', { name: 'Retry research' }).click();
  await expect(row.getByText('researching…', { exact: true })).toBeVisible();
  await expect(row.getByText('no report', { exact: true })).toHaveCount(0);

  await expect.poll(() => fireCount(request)).toBe(2);
  const { readerPosts } = await mockState(request);
  const [post] = readerPosts;
  expect(post).toMatchObject({ research_state: 'researching', research_error: null });
});
