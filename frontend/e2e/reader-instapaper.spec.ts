import type { APIRequestContext } from '@playwright/test';

import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Reader's send to Instapaper, through the whole stack: the row's verb, the store's optimistic
 * archive, the Next route signing a request with the deployment's credentials, and Instapaper
 * answering — played by the mock backend, because the route calls Instapaper from the Next server,
 * where `page.route` cannot reach. The mock records every request it was sent, so the test can
 * prove what actually left the server: one signed request carrying the post's own email HTML.
 */

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '77777777-7777-4777-8777-777777777777',
});

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TITLE = 'How near is the intelligence explosion, really?';
const HTML =
  '<html><body><h1>How near is the intelligence explosion?</h1>' +
  '<p>A paragraph only paying subscribers ever see.</p></body></html>';

/** One done post with a web link and the email HTML intake kept for it. */
function seededPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Second Thoughts',
    canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    text: 'How near is the intelligence explosion?\nA paragraph only paying subscribers ever see.',
    html: HTML,
    html_extracted: true,
    word_count: 3220,
    summary_state: 'done',
    gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
    overview: makeReaderOverview(),
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

interface InstapaperRequest {
  authorization: string | null;
  contentType: string | null;
  form: Record<string, string>;
}

interface MockState {
  instapaperRequests: InstapaperRequest[];
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

test.describe('the reading list — sending to Instapaper', () => {
  test('a send collapses the row out, files it in the archive as in Instapaper, and sends one signed request carrying the HTML', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');

    const row = page.getByTestId('reader-row');
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Send to Instapaper' }).click();

    await expect(row).toHaveCount(0);

    await expect
      .poll(async () => {
        const { instapaperRequests } = await mockState(request);
        return instapaperRequests.length;
      })
      .toBe(1);
    const state = await mockState(request);
    const [sent] = state.instapaperRequests;
    expect(sent?.authorization).toMatch(/^OAuth .*oauth_signature="[^"]+"/);
    expect(sent?.authorization).toContain('oauth_consumer_key="mock_instapaper_consumer_key"');
    expect(sent?.contentType).toContain('application/x-www-form-urlencoded');
    expect(sent?.form).toMatchObject({
      url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      title: TITLE,
      content: HTML,
    });
    const stored = state.readerPosts.find((post) => post.id === POST_ID);
    expect(stored?.instapaper_sent_at).toEqual(expect.any(String));
    expect(stored?.archived_at).toEqual(expect.any(String));
    expect(stored?.instapaper_bookmark_id).toEqual(expect.any(Number));

    await page
      .getByRole('navigation', { name: 'Reader' })
      .getByRole('link', { name: 'Archive' })
      .click();
    const archived = page.getByTestId('reader-row');
    await expect(archived).toHaveCount(1);
    await expect(archived).toContainText(TITLE);
    await expect(archived.getByText('in Instapaper')).toBeVisible();
    await expect(archived.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  });

  test('a refused send puts the row back on the list and toasts the reason, writing nothing', async ({
    page,
    seed,
    request,
  }) => {
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: [seededPost()],
      instapaperError: 1221,
    });
    await page.goto('/reader');

    await page
      .getByTestId('reader-row')
      .getByRole('button', { name: 'Send to Instapaper' })
      .click();

    await expect(page.getByText('This publication has opted out of Instapaper')).toBeVisible();
    await expect(page.getByTestId('reader-row')).toHaveCount(1);
    await expect(page.getByTestId('reader-row')).toContainText(TITLE);

    const state = await mockState(request);
    expect(state.instapaperRequests).toHaveLength(1);
    expect(state.readerPosts.find((post) => post.id === POST_ID)).toMatchObject({
      archived_at: null,
      instapaper_sent_at: null,
      instapaper_bookmark_id: null,
    });
  });
});

test.describe('the reading list — sending to Instapaper, on a phone (375×812)', () => {
  // A phone, not a narrow desktop window: `isMobile` gives Chromium the overlay scrollbars a
  // phone has, where a desktop window would spend ~15px of the width on a classic one.
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('the three verbs sit on one line, with no sideways scroll', async ({ page, seed }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');

    const verbs = page.getByTestId('reader-row-verbs');
    const boxes = await Promise.all(
      ['Send to Instapaper', 'Overview', 'Archive'].map((name) =>
        verbs.getByRole('button', { name }).boundingBox(),
      ),
    );
    const tops = boxes.map((box) => (box === null ? undefined : Math.round(box.y)));
    expect(tops).toEqual([tops[0], tops[0], tops[0]]);
    expect(tops[0]).toEqual(expect.any(Number));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
