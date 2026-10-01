import type { Locator, Page } from '@playwright/test';

import {
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A post's Further reading in the browser: expand a seeded post, tick two links, Send to Reader,
 * and see them marked "In Reader". The send route is stubbed with `page.route()` — the route,
 * its Instapaper calls and its append are pinned by its own suite and the database's — so this
 * flow is the checklist, the store and the request the browser makes, against a real page.
 */

const PUBLICATION = makeReaderPublication('Import AI', {
  id: '66666666-6666-4666-8666-666666666666',
});
const POST_ID = '77777777-7777-4777-8777-777777777771';
const TITLE = 'Import AI 412: three new evals, and a robot that folds';
const ITEMS = makeFurtherReading();
const [GAP, TRANSFER, , SCEPTIC] = ITEMS as [
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
  (typeof ITEMS)[0],
];

function roundup(sentReader: string[] = []) {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Import AI',
    word_count: 1900,
    summary_state: 'done',
    gist: 'Roundup issue. Worth the links more than the issue.',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    received_at: '2026-09-16T12:00:00.000Z',
    further_sent_reader: sentReader,
  });
}

async function openRow(page: Page): Promise<Locator> {
  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await row.getByRole('button', { name: 'Overview' }).click();
  await expect(row.getByRole('heading', { name: 'Further reading' })).toBeVisible();
  return row;
}

test.describe('Further reading', () => {
  test('ticks two links, sends them to the Reader, and shows them In Reader', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [roundup()] });
    const sent: unknown[] = [];
    await page.route(`**/api/reader/posts/${POST_ID}/further-reading`, async (route) => {
      sent.push(route.request().postDataJSON());
      const { text: _text, html: _html, ...row } = roundup([GAP.url, SCEPTIC.url]);
      await route.fulfill({ status: 200, json: { post: row, unsent: [] } });
    });
    await page.goto('/reader');

    const row = await openRow(page);
    // The section is last in the overview, with a selection of its own.
    await expect(row.getByRole('heading', { level: 3 }).last()).toHaveText('Further reading');
    const section = row.getByTestId('further-reading');
    await section.getByRole('checkbox', { name: new RegExp(GAP.title) }).click();
    await section.getByRole('checkbox', { name: /A sceptic/ }).click();
    await expect(section.getByText('2 selected')).toBeVisible();
    await section.getByRole('button', { name: 'Send to Reader' }).click();

    await expect(section.getByText('In Reader', { exact: true })).toHaveCount(2);
    await expect(section.getByRole('checkbox')).toHaveCount(2);
    await expect(
      section.getByRole('checkbox', { name: new RegExp(TRANSFER.title) }),
    ).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByRole('group', { name: 'Selected links' })).toBeHidden();
    expect(sent).toEqual([{ destination: 'reader', urls: [GAP.url, SCEPTIC.url] }]);

    // Each link opens in a new tab, sent or not.
    const open = section.getByRole('link', { name: `Open ${GAP.title}` });
    await expect(open).toHaveAttribute('href', GAP.url);
    await expect(open).toHaveAttribute('target', '_blank');
  });
});
