import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Reader's Send verb, end to end: the button in the browser, the store's optimistic exit, the
 * route on the Next server reading the post and signing a request, the stand-in Instapaper in the
 * mock process, and the stamp written back. The Instapaper call leaves the Next server, where
 * `page.route()` can't reach it — so the mock answers `bookmarks/add` itself (INSTAPAPER_API_URL in
 * playwright.config.ts) and records what it was sent.
 */

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '99999999-9999-4999-8999-999999999999',
});

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TITLE = 'How near is the intelligence explosion, really?';
const EMAIL_HTML =
  '<html><body><h1>How near</h1><p>The whole paid post, as mailed.</p></body></html>';

function seededPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Second Thoughts',
    canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    word_count: 3220,
    text: 'How near\nThe whole paid post, as mailed.',
    html: EMAIL_HTML,
    html_extracted: true,
    summary_state: 'done',
    gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
    overview: makeReaderOverview(),
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

interface MockState {
  instapaperRequests: { authorization: string; params: Record<string, string> }[];
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

/** How many `bookmarks/add` requests the stand-in Instapaper has recorded. */
async function sentCount(request: APIRequestContext): Promise<number> {
  const state = await mockState(request);
  return state.instapaperRequests.length;
}

/** The post as the mock holds it right now. */
async function storedPost(
  request: APIRequestContext,
): Promise<MockState['readerPosts'][number] | undefined> {
  const state = await mockState(request);
  return state.readerPosts.find((post) => post.id === POST_ID);
}

/** The top edge of a locator's box, or undefined when it has none. */
async function topOf(locator: Locator): Promise<number | undefined> {
  const box = await locator.boundingBox();
  return box?.y;
}

function row(page: Page) {
  return page.getByTestId('reader-row').filter({ hasText: TITLE });
}

test.describe('sending a post to Instapaper', () => {
  test('a send from the list saves the post with its body, archives it and badges it', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');
    await expect(row(page)).toHaveCount(1);
    await expect(row(page).getByRole('link', { name: 'Open' })).toHaveCount(0);

    await row(page).getByRole('button', { name: 'Send to Instapaper' }).click();

    // The row leaves the reading list the way Archive's does.
    await expect(row(page)).toHaveCount(0);
    await expect(page.getByText('Nothing to read')).toBeVisible();

    // One signed request, carrying the email HTML as the body and the gist as the description.
    await expect.poll(() => sentCount(request)).toBe(1);
    const { instapaperRequests } = await mockState(request);
    const [sent] = instapaperRequests;
    expect(sent?.authorization).toMatch(/^OAuth /);
    expect(sent?.authorization).toContain('oauth_signature="');
    expect(sent?.authorization).toContain('oauth_token="mock-access-token"');
    expect(sent?.params).toEqual({
      url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      title: TITLE,
      description: 'Argues the recursive self-improvement debate conflates three feedback loops.',
      content: EMAIL_HTML,
    });

    // The row was stamped only once Instapaper confirmed the save.
    // Polled: the row left the list optimistically, before the route wrote its stamp.
    await expect
      .poll(() => storedPost(request))
      .toMatchObject({
        instapaper_bookmark_id: 1001,
        instapaper_sent_at: expect.any(String),
        archived_at: expect.any(String),
      });

    await page
      .getByRole('navigation', { name: 'Reader' })
      .getByRole('link', { name: 'Archive' })
      .click();
    await expect(row(page)).toHaveCount(1);
    await expect(row(page).getByText('in Instapaper')).toBeVisible();
  });

  test('a refused send puts the row back and says why, and writes nothing', async ({
    page,
    seed,
    request,
  }) => {
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: [seededPost()],
      instapaperErrorCode: 1221,
    });
    await page.goto('/reader');

    await row(page).getByRole('button', { name: 'Send to Instapaper' }).click();

    await expect(page.getByText('This publication has opted out of Instapaper')).toBeVisible();
    await expect(row(page)).toHaveCount(1);
    await expect(row(page).getByText('in Instapaper')).toHaveCount(0);

    const state = await mockState(request);
    expect(state.instapaperRequests).toHaveLength(1);
    expect(state.readerPosts.find((post) => post.id === POST_ID)).toMatchObject({
      archived_at: null,
      instapaper_sent_at: null,
      instapaper_bookmark_id: null,
    });
  });

  test('i sends the selected row', async ({ page, seed, request }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');
    await expect(row(page)).toHaveCount(1);

    // The hotkeys are a client listener; press until the selection takes (see reader-archive).
    const selected = page.locator('[data-testid="reader-row"][data-selected="true"]');
    await expect(async () => {
      if ((await selected.count()) === 0) await page.keyboard.press('j');
      await expect(selected).toHaveCount(1, { timeout: 1000 });
    }).toPass();
    await expect(row(page).getByText('i', { exact: true })).toBeVisible();

    await page.keyboard.press('i');

    await expect(row(page)).toHaveCount(0);
    await expect.poll(() => sentCount(request)).toBe(1);
  });
});

test.describe('the verb row on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Send, Overview and Archive fit on one line with no horizontal scroll', async ({
    page,
    seed,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');

    const verbs = row(page).getByTestId('reader-row-verbs');
    const send = verbs.getByRole('button', { name: 'Send to Instapaper' });
    const overview = verbs.getByRole('button', { name: 'Overview' });
    const archive = verbs.getByRole('button', { name: 'Archive' });
    await expect(archive).toBeVisible();

    const tops = await Promise.all([send, overview, archive].map((verb) => topOf(verb)));
    expect(new Set(tops).size).toBe(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
