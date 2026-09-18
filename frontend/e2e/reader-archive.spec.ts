import type { Locator, Page } from '@playwright/test';

import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The archive (`/reader/archive`) and the reading list's keyboard — the round trip a post makes
 * out of the list and back, and one hotkey journey through the real browser.
 *
 * Both need a real browser rather than jsdom: the archive is a second scope read on navigation
 * (so the store's one post list has to survive a route change), and the hotkeys hang off
 * `document` while focus sits wherever the last click left it, which jsdom can only approximate.
 */

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '99999999-9999-4999-8999-999999999999',
});

const ALPHA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const BETA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

/** Two done posts on the reading list, Alpha the newer. */
function seededPosts() {
  return [
    makeReaderPost(PUBLICATION.id, {
      id: ALPHA_ID,
      title: 'How near is the intelligence explosion, really?',
      author: 'Second Thoughts',
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      word_count: 3220,
      summary_state: 'done',
      gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
      overview: makeReaderOverview({ novel_ideas: ['Only automated ML research has evidence.'] }),
      received_at: '2026-09-16T12:00:00.000Z',
    }),
    makeReaderPost(PUBLICATION.id, {
      id: BETA_ID,
      title: 'Import AI 412: three new evals, and a robot that folds',
      author: 'Import AI',
      canonical_url: 'https://importai.substack.com/p/import-ai-412',
      word_count: 1840,
      summary_state: 'done',
      gist: 'Roundup issue; the one new item is a robotics dexterity eval.',
      overview: makeReaderOverview(),
      received_at: '2026-09-16T11:00:00.000Z',
    }),
  ];
}

/**
 * Point the keyboard at `row` with `j`. The hotkeys are a client listener, so a press that lands
 * before the page has hydrated is swallowed with nothing to catch it — press until the selection
 * takes rather than once and hope. Idempotent in practice: each attempt waits out a real
 * selection before pressing again, so the retry only fires while nothing is listening yet.
 */
async function selectWithJ(page: Page, row: Locator): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('j');
    await expect(row).toHaveAttribute('data-selected', 'true', { timeout: 1000 });
  }).toPass();
}

/** What the mock holds for a post's `archived_at` right now. */
async function archivedAt(
  request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
  id: string,
): Promise<string | null | undefined> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as {
    readerPosts: { id: string; archived_at: string | null }[];
  };
  return state.readerPosts.find((post) => post.id === id)?.archived_at;
}

test.describe('the archive', () => {
  test('a post archived from the list is in the archive, and unarchiving brings it back', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    const alpha = page
      .getByTestId('reader-row')
      .filter({ hasText: 'How near is the intelligence explosion' });
    await alpha.getByRole('button', { name: 'Archive' }).click();

    await expect(page.getByTestId('reader-row')).toHaveCount(1);
    await expect(page.getByText('1 to read')).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Reader' })
      .getByRole('link', { name: 'Archive' })
      .click();
    await expect(page).toHaveURL(/\/reader\/archive$/);

    const archivedRow = page
      .getByTestId('reader-row')
      .filter({ hasText: 'How near is the intelligence explosion' });
    await expect(archivedRow).toHaveCount(1);
    // The one row, not two: the archive read upserts into the list the store already holds.
    await expect(page.getByTestId('reader-row')).toHaveCount(1);
    await expect(archivedRow.getByRole('button', { name: 'Unarchive' })).toBeVisible();

    await archivedRow.getByRole('button', { name: 'Unarchive' }).click();

    await expect(page.getByText('Nothing archived yet.')).toBeVisible();
    await expect.poll(() => archivedAt(request, ALPHA_ID)).toBeNull();

    await page
      .getByRole('navigation', { name: 'Reader' })
      .getByRole('link', { name: 'Reading list' })
      .click();
    await expect(page.getByTestId('reader-row')).toHaveCount(2);
    await expect(page.getByText('2 to read')).toBeVisible();
  });

  test('the archive rests on its empty state when nothing has been put away', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader/archive');

    await expect(page.getByRole('heading', { level: 2, name: 'Archive' })).toBeVisible();
    await expect(page.getByText('Nothing archived yet.')).toBeVisible();
    await expect(
      page.getByText('Archive a post from the reading list and it lands here.'),
    ).toBeVisible();
  });
});

test.describe('the reading list keyboard', () => {
  test('j selects the first row and e archives it', async ({ page, seed, request }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');
    await expect(page.getByTestId('reader-row')).toHaveCount(2);

    const alpha = page
      .getByTestId('reader-row')
      .filter({ hasText: 'How near is the intelligence explosion' });
    await selectWithJ(page, alpha);

    // The hints ride on the selected row and nowhere else.
    await expect(alpha.getByText('e', { exact: true })).toBeVisible();

    await page.keyboard.press('e');

    await expect(alpha).toHaveCount(0);
    await expect(page.getByText('1 to read')).toBeVisible();
    await expect.poll(() => archivedAt(request, ALPHA_ID)).toEqual(expect.any(String));

    // The selection moved on rather than being dropped, so the next `e` has a target.
    await expect(
      page.getByTestId('reader-row').filter({ hasText: 'Import AI 412' }),
    ).toHaveAttribute('data-selected', 'true');
  });

  test('v opens the selected row’s overview and Escape drops the selection', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    const alpha = page
      .getByTestId('reader-row')
      .filter({ hasText: 'How near is the intelligence explosion' });
    // The collapsed panel stays mounted for the height animation and is marked aria-hidden, so
    // "closed" is read off the accessibility tree rather than off a text locator.
    await expect(alpha.getByRole('heading', { name: 'Novel ideas' })).toBeHidden();

    await selectWithJ(page, alpha);
    await page.keyboard.press('v');

    await expect(alpha.getByRole('heading', { name: 'Novel ideas' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(alpha).toHaveAttribute('data-selected', 'false');
    // Escape drops the selection only — the panel the owner opened stays open.
    await expect(alpha.getByRole('heading', { name: 'Novel ideas' })).toBeVisible();
  });
});
