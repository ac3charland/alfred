import type { Locator, Page } from '@playwright/test';

import {
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A post's Further reading, in the browser: expand the overview, tick links, send them to the
 * Reader, and see them marked. The send route is stubbed with `page.route()` — its own Instapaper
 * traffic (the folder listing, one save per link, the append) is pinned by the route's Jest suite —
 * so this is the checklist, the store's reconcile and the marks the row redraws from its answer.
 */

const PUBLICATION = makeReaderPublication('Gridwork', {
  id: '66666666-6666-4666-8666-666666666666',
});
const POST_ID = '77777777-7777-4777-8777-777777777771';
const TITLE = 'Gridwork 212: three new evals, and a robot that folds';
const ITEMS = makeFurtherReading();
const [PAPER, ESSAY, RELEASE] = ITEMS as [
  (typeof ITEMS)[number],
  (typeof ITEMS)[number],
  (typeof ITEMS)[number],
];

function roundupPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Tove Hallam',
    canonical_url: 'https://open.substack.com/pub/gridwork/p/gridwork-212',
    word_count: 1980,
    summary_state: 'done',
    gist: 'Mostly restates last week; the one new item is a dexterity eval with a sim-to-real gap.',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    prompt_version: 2,
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

async function openRow(page: Page): Promise<Locator> {
  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await row.getByRole('button', { name: 'Overview' }).click();
  await expect(row.getByRole('heading', { name: 'Further reading' })).toBeVisible();
  return row;
}

test.describe('sending Further reading to the Reader', () => {
  test('ticks two links, sends them to the Reader, and marks them “In Reader”', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [roundupPost()] });

    const requests: unknown[] = [];
    await page.route(`**/api/reader/posts/${POST_ID}/further-reading`, async (route) => {
      requests.push(route.request().postDataJSON());
      const { text: _text, html: _html, ...row } = roundupPost();
      await route.fulfill({
        status: 200,
        json: { post: { ...row, further_sent_reader: [PAPER.url, RELEASE.url] }, unsent: [] },
      });
    });

    await page.goto('/reader');
    const row = await openRow(page);

    // The section is last in the overview, after "Who should read it".
    const headings = await row.getByRole('heading', { level: 3 }).allTextContents();
    expect(headings.at(-1)).toBe('Further reading');

    await row.getByRole('checkbox', { name: new RegExp(PAPER.title) }).click();
    await row.getByRole('checkbox', { name: new RegExp(RELEASE.title) }).click();
    await expect(row.getByText('2 selected')).toBeVisible();
    await row.getByRole('button', { name: 'Send to Reader' }).click();

    expect(requests).toEqual([{ destination: 'reader', urls: [PAPER.url, RELEASE.url] }]);
    await expect(row.getByText('In Reader')).toHaveCount(2);
    await expect(row.getByRole('checkbox', { name: new RegExp(PAPER.title) })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: new RegExp(RELEASE.title) })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: new RegExp(ESSAY.title) })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(row.getByRole('group', { name: 'Selected links' })).toBeHidden();

    // Each item's open link stays, and opens the link itself in a new tab.
    const open = row.getByRole('link', { name: `Open ${PAPER.title}` });
    await expect(open).toHaveAttribute('href', PAPER.url);
    await expect(open).toHaveAttribute('target', '_blank');
  });
});
