import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Sending a post to Instapaper, end to end — the reading list's primary verb.
 *
 * This needs a real browser AND a real server on both sides: the row plays an exit collapse
 * before the write commits, the route signs the request on the Next server, and the stand-in for
 * Instapaper is the same in-memory mock that stands in for Supabase (`page.route()` cannot reach
 * a call the server makes). So what is exercised here is the whole path: the optimistic row, the
 * signed outbound request with the post's own body in it, the stamp, and the rollback.
 */

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '88888888-8888-4888-8888-888888888888',
});

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const POST_TITLE = 'How near is the intelligence explosion, really?';
/** A marker in the stored markup, so the recorded request can be shown to carry the real body. */
const BODY_MARKER = 'THE-ARTICLE-BODY';

function seededPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: POST_TITLE,
    author: 'Second Thoughts',
    canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    word_count: 3220,
    html_extracted: true,
    text: BODY_MARKER,
    html: `<html><body><h1>${POST_TITLE}</h1><p>${BODY_MARKER}</p></body></html>`,
    summary_state: 'done',
    gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
    overview: makeReaderOverview(),
    model: 'claude-sonnet-5',
    prompt_version: 2,
    summarized_at: '2026-09-16T14:05:00.000Z',
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

interface MockRequest {
  authorization: string;
  params: Record<string, string>;
}

interface Requester {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}

/** Every `bookmarks/add` the mock has been asked for, in order. */
async function instapaperRequests(request: Requester): Promise<MockRequest[]> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as { instapaperRequests: MockRequest[] };
  return state.instapaperRequests;
}

/** What the mock holds for the post's send stamp and bookmark id right now. */
async function sentStamp(
  request: Requester,
  id: string,
): Promise<
  { instapaper_sent_at: string | null; instapaper_bookmark_id: number | null } | undefined
> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as {
    readerPosts: {
      id: string;
      instapaper_sent_at: string | null;
      instapaper_bookmark_id: number | null;
    }[];
  };
  const post = state.readerPosts.find((row) => row.id === id);
  return post === undefined
    ? undefined
    : {
        instapaper_sent_at: post.instapaper_sent_at,
        instapaper_bookmark_id: post.instapaper_bookmark_id,
      };
}

test.describe('send to Instapaper', () => {
  test('the row leaves the list, lands in the archive with its badge, and one signed request carried the post body', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');

    const row = page.getByTestId('reader-row').filter({ hasText: POST_TITLE });
    await expect(row).toHaveCount(1);

    await row.getByRole('button', { name: 'Send to Instapaper' }).click();

    // One press archives as well as sends, so the row plays the archive's exit and leaves.
    await expect(page.getByTestId('reader-row')).toHaveCount(0);
    await expect(page.getByText('Nothing new to read.')).toBeVisible();

    // The stamp and the bookmark id both landed — and only after Instapaper confirmed.
    await expect
      .poll(() => sentStamp(request, POST_ID))
      .toEqual({
        instapaper_sent_at: expect.any(String),
        instapaper_bookmark_id: expect.any(Number),
      });

    // Exactly one outbound call, signed, carrying the article rather than only its link.
    const requests = await instapaperRequests(request);
    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent?.authorization).toMatch(/^OAuth /);
    expect(sent?.authorization).toContain('oauth_signature=');
    expect(sent?.authorization).toContain('oauth_consumer_key="mock-consumer-key"');
    expect(sent?.params['content']).toContain(BODY_MARKER);
    expect(sent?.params['url']).toBe(
      'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
    );
    expect(sent?.params['title']).toBe(POST_TITLE);
    expect(sent?.params['description']).toContain('recursive self-improvement');

    await page
      .getByRole('navigation', { name: 'Reader' })
      .getByRole('link', { name: 'Archive' })
      .click();
    await expect(page).toHaveURL(/\/reader\/archive$/);

    const archivedRow = page.getByTestId('reader-row').filter({ hasText: POST_TITLE });
    await expect(archivedRow).toHaveCount(1);
    await expect(archivedRow.getByText('in Instapaper')).toBeVisible();
    await expect(archivedRow.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  });

  test('a refusal brings the row back and says why, writing nothing', async ({
    page,
    seed,
    request,
  }) => {
    // 1221 is Instapaper's "this publication has opted out" — a refusal retrying cannot fix, so
    // the owner reads the route's own sentence rather than a generic apology.
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: [seededPost()],
      instapaperErrorCode: 1221,
    });
    await page.goto('/reader');

    const row = page.getByTestId('reader-row').filter({ hasText: POST_TITLE });
    await row.getByRole('button', { name: 'Send to Instapaper' }).click();

    await expect(page.getByText('This publication has opted out of Instapaper')).toBeVisible();
    // The row came back where it was, and nothing was written to it.
    await expect(page.getByTestId('reader-row').filter({ hasText: POST_TITLE })).toHaveCount(1);
    await expect(page.getByText('1 to read')).toBeVisible();
    await expect
      .poll(() => sentStamp(request, POST_ID))
      .toEqual({
        instapaper_sent_at: null,
        instapaper_bookmark_id: null,
      });
    expect(await instapaperRequests(request)).toHaveLength(1);
  });

  test('i sends the selected row', async ({ page, seed, request }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [seededPost()] });
    await page.goto('/reader');

    const row = page.getByTestId('reader-row').filter({ hasText: POST_TITLE });
    // The hotkeys are a client listener, so press until the selection takes rather than once and
    // hope — the same rule `reader-archive.spec.ts` follows.
    const anySelected = page.locator('[data-testid="reader-row"][data-selected="true"]');
    await expect(async () => {
      if ((await anySelected.count()) === 0) await page.keyboard.press('j');
      await expect(anySelected).toHaveCount(1, { timeout: 1000 });
    }).toPass();
    await expect(row).toHaveAttribute('data-selected', 'true');
    // The hint rides on the selected row, beside the verb the key runs.
    await expect(row.getByText('i', { exact: true })).toBeVisible();

    await page.keyboard.press('i');

    await expect(page.getByTestId('reader-row')).toHaveCount(0);
    await expect
      .poll(async () => {
        const sent = await instapaperRequests(request);
        return sent.length;
      })
      .toBe(1);
  });
});
