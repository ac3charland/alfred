import type { Locator, Page } from '@playwright/test';

import { makeReaderOverview, makeReaderPost, makeReaderPublication } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Sending a post's Further reading links, in the browser: the checklist drawn under the
 * overview, the select-then-send bar, and the sent marks the answer draws. The send route is
 * stubbed with `page.route()`, so this pins the request the component makes and how it redraws
 * from the answer; the route itself is covered by its own tests.
 */

const PUBLICATION = makeReaderPublication('Jane Doe', {
  id: '66666666-6666-4666-8666-666666666666',
});
const POST_ID = '77777777-7777-4777-8777-777777777771';
const TITLE = 'The week in benchmark releases';

const LINKS = [
  {
    url: 'https://example.com/ai-model-costs',
    title: 'The real cost of a frontier model',
    note: 'The source of the training-cost figures the post leans on.',
  },
  {
    url: 'https://example.com/benchmark-roundup',
    title: 'This month in benchmark releases',
    note: 'The roundup the first section summarises.',
  },
  {
    url: 'https://example.com/sim-to-real-rebuttal',
    title: 'Why sim-to-real gaps are overstated',
    note: 'The strongest counter-argument to the robotics result.',
  },
] as const;
const [COSTS, ROUNDUP, REBUTTAL] = LINKS;

function seededPost(sentReader: string[] = []) {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Jane Doe',
    canonical_url: 'https://janedoe.substack.com/p/the-week-in-benchmark-releases',
    word_count: 2100,
    summary_state: 'done',
    gist: 'Two of the three releases are re-releases with new baselines.',
    overview: { ...makeReaderOverview(), further_reading: [...LINKS] },
    further_sent_reader: sentReader,
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

/** Stub the send route, answering every request with a full success, and record each body. */
async function stubSend(page: Page): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route('**/api/reader/posts/*/further-reading', async (route) => {
    bodies.push(route.request().postDataJSON());
    const { text: _text, html: _html, ...row } = seededPost([COSTS.url, REBUTTAL.url]);
    await route.fulfill({ status: 200, json: { post: row, unsent: [] } });
  });
  return bodies;
}

async function openRow(page: Page): Promise<Locator> {
  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await row.getByRole('button', { name: 'Overview' }).click();
  await expect(row.getByRole('heading', { name: 'Further reading' })).toBeVisible();
  return row;
}

test.describe('sending Further reading links', () => {
  test('ticks two links and sends them to the Reader, which marks them and leaves the third tickable', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    const bodies = await stubSend(page);
    await page.goto('/reader');

    const row = await openRow(page);
    await row.getByRole('checkbox', { name: new RegExp(COSTS.title) }).click();
    await row.getByRole('checkbox', { name: new RegExp(REBUTTAL.title) }).click();
    await expect(row.getByText('2 selected')).toBeVisible();
    await row.getByRole('button', { name: 'Send to Reader' }).click();

    await expect(row.getByText('In Reader', { exact: true })).toHaveCount(2);
    expect(bodies).toEqual([{ destination: 'reader', urls: [COSTS.url, REBUTTAL.url] }]);
    await expect(row.getByRole('group', { name: 'Selected links' })).toBeHidden();
    await expect(row.getByRole('checkbox', { name: new RegExp(COSTS.title) })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: new RegExp(ROUNDUP.title) })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // The sent link still opens the article.
    await expect(row.getByRole('link', { name: `Open ${COSTS.title}` })).toHaveAttribute(
      'href',
      COSTS.url,
    );
  });
});
