import type { APIRequestContext, Page } from '@playwright/test';

import {
  MOCK_URL,
  makeReaderArticle,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * An article the owner moved into Instapaper's "To Reader" folder, as the Reader shows it once the
 * Worker has taken it in: its site as the eyebrow, "via Instapaper" in the meta line, and the same
 * Send verb every row has — which, for an article, moves the owner's own bookmark back to Unread
 * rather than saving a second one. The Instapaper call leaves the Next server, so the mock stands
 * in for Instapaper (INSTAPAPER_API_URL in playwright.config.ts) and records every call it gets.
 */

const PUBLICATION = makeReaderPublication('Import AI', {
  id: '77777777-7777-4777-8777-777777777777',
});

const ARTICLE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const BOOKMARK_ID = 1_900_042;
const TITLE = 'Cities Are Getting Quieter, and It’s Costing Them';

function seededArticle() {
  return makeReaderArticle({
    id: ARTICLE_ID,
    instapaper_bookmark_id: BOOKMARK_ID,
    title: TITLE,
    site: 'worksinprogress.co',
    canonical_url: 'https://worksinprogress.co/issue/quiet-cities',
    text: 'The article, as Instapaper had it.',
    word_count: 2760,
    summary_state: 'done',
    gist: 'Argues that falling street-level noise tracks lost foot traffic, not new ordinances.',
    overview: makeReaderOverview(),
    received_at: '2026-09-18T12:00:00.000Z',
  });
}

/** A newsletter beside it, so the article is shown to sit in the same list as one. */
function seededNewsletter() {
  return makeReaderPost(PUBLICATION.id, {
    title: 'Import AI 431: a benchmark for boring tasks',
    author: 'Import AI',
    canonical_url: 'https://importai.substack.com/p/import-ai-431',
    word_count: 2000,
    summary_state: 'done',
    gist: 'Roundup. Mostly restates last week’s eval releases.',
    overview: makeReaderOverview(),
    received_at: '2026-09-18T11:00:00.000Z',
  });
}

interface MockState {
  instapaperRequests: { path: string; params: Record<string, string> }[];
  readerPosts: {
    id: string;
    archived_at: string | null;
    instapaper_sent_at: string | null;
    instapaper_bookmark_id: number | null;
  }[];
}

async function mockState(request: APIRequestContext): Promise<MockState> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  return (await response.json()) as MockState;
}

/** How many calls the stand-in Instapaper has recorded. */
async function instapaperCalls(request: APIRequestContext): Promise<number> {
  const state = await mockState(request);
  return state.instapaperRequests.length;
}

/** The article as the mock holds it right now. */
async function storedArticle(
  request: APIRequestContext,
): Promise<MockState['readerPosts'][number] | undefined> {
  const state = await mockState(request);
  return state.readerPosts.find((post) => post.id === ARTICLE_ID);
}

function row(page: Page, title: string) {
  return page.getByTestId('reader-row').filter({ hasText: title });
}

test.describe('an Instapaper article in the reading list', () => {
  test('shows its site and "via Instapaper", and Send moves its own bookmark back to Unread', async ({
    page,
    seed,
    request,
  }) => {
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: [seededArticle(), seededNewsletter()],
    });
    await page.goto('/reader');

    const article = row(page, TITLE);
    await expect(article).toHaveCount(1);
    await expect(article.getByText('worksinprogress.co', { exact: true })).toBeVisible();
    await expect(article.getByText(/· via Instapaper$/)).toBeVisible();
    // The newsletter beside it is unchanged: its author, and no "via Instapaper".
    const newsletter = row(page, 'Import AI 431: a benchmark for boring tasks');
    await expect(newsletter.getByText('Import AI', { exact: true })).toBeVisible();
    await expect(newsletter.getByText(/via Instapaper/)).toHaveCount(0);

    await article.getByRole('button', { name: 'Send to Instapaper' }).click();

    // The row leaves the reading list the way a newsletter's does.
    await expect(row(page, TITLE)).toHaveCount(0);

    // Exactly one call, to bookmarks/unarchive for the article's own bookmark — no add.
    await expect.poll(() => instapaperCalls(request)).toBe(1);
    const { instapaperRequests } = await mockState(request);
    expect(instapaperRequests).toEqual([
      expect.objectContaining({
        path: '/api/1/bookmarks/unarchive',
        params: { bookmark_id: String(BOOKMARK_ID) },
      }),
    ]);

    // Stamped sent and archived, still holding the same bookmark.
    await expect
      .poll(() => storedArticle(request))
      .toMatchObject({
        instapaper_bookmark_id: BOOKMARK_ID,
        instapaper_sent_at: expect.any(String),
        archived_at: expect.any(String),
      });
  });
});
