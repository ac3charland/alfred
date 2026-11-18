import type { Locator, Page } from '@playwright/test';

import { makeReaderOverview, makeReaderPost, makeReaderPublication } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A reader row's Add-to-Inbox field, end to end: the `a` key on the selected row, a typed line,
 * the real POST /api/items it sends, the post staying on the list, and the toast that carries the
 * owner to the Inbox, where the new item already sits.
 */

const PUBLICATION = makeReaderPublication('Import AI', {
  id: '99999999-9999-4999-8999-999999999999',
});
const URL = 'https://importai.substack.com/p/import-ai-412';
const TITLE = 'Import AI 412: the eval that wouldn’t transfer';
const TEXT = 'Ask Ana whether our classifier evals have a sim-to-real gap too';

function seededPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    title: TITLE,
    author: 'Import AI',
    canonical_url: URL,
    word_count: 1840,
    summary_state: 'done',
    gist: 'A robotics dexterity benchmark shows a sim-to-real gap a bigger simulator doesn’t close.',
    overview: makeReaderOverview(),
    received_at: '2026-09-16T11:00:00.000Z',
  });
}

/** Point the keyboard at the row; the hotkeys are a client listener, so retry until hydrated. */
async function select(page: Page, row: Locator): Promise<void> {
  await expect(async () => {
    if ((await row.getAttribute('data-selected')) !== 'true') await page.keyboard.press('j');
    await expect(row).toHaveAttribute('data-selected', 'true', { timeout: 1000 });
  }).toPass();
}

test('a typed line on a reader post becomes an Inbox item linked back to it', async ({
  page,
  seed,
}) => {
  await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
  await page.goto('/reader');

  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await select(page, row);
  await page.keyboard.press('a');

  const field = row.getByRole('textbox', { name: 'New Inbox item' });
  await expect(field).toBeFocused();
  await field.fill(TEXT);

  const create = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/items'),
  );
  await field.press('Enter');

  const request = await create;
  expect(request.postDataJSON()).toMatchObject({
    title: TEXT,
    raw_capture: TEXT,
    item_type: 'unclassified',
    source_url: URL,
    notes: `From the Reader: “${TITLE}” — Import AI\n${URL}`,
  });

  // The post stays put, and the field is ready for the next one.
  await expect(row).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();

  await page.getByRole('link', { name: 'Added to Inbox' }).click();

  await expect(page).toHaveURL(/\/\?view=inbox$/);
  await expect(page.getByText(TEXT)).toBeVisible();
});
