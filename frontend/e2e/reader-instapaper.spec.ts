import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Sending a post to Instapaper, end to end: the browser presses the verb, the Next route signs a
 * `bookmarks/add` to the mock standing in for Instapaper (`INSTAPAPER_API_URL`), and the row
 * stamp lands in the mock database. jsdom can't cover this: the call leaves from the Next server,
 * and the row's exit is a real CSS transition.
 */

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '99999999-9999-4999-8999-999999999998',
});

const POST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TITLE = 'How near is the intelligence explosion, really?';
const HTML = '<html><body><h1>How near</h1><p>The whole post, images and all.</p></body></html>';

function seededPosts() {
  return [
    makeReaderPost(PUBLICATION.id, {
      id: POST_ID,
      title: TITLE,
      author: 'Second Thoughts',
      canonical_url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      word_count: 3220,
      text: 'The whole post, images and all.',
      html: HTML,
      summary_state: 'done',
      gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
      overview: makeReaderOverview(),
      received_at: '2026-09-16T12:00:00.000Z',
    }),
  ];
}

interface MockState {
  readerPosts: {
    id: string;
    archived_at: string | null;
    instapaper_sent_at: string | null;
    instapaper_bookmark_id: number | null;
  }[];
  instapaperRequests: { authorization: string | null; params: Record<string, string> }[];
}

async function mockState(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}): Promise<MockState> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  return (await response.json()) as MockState;
}

/** What the mock holds for the post's `instapaper_sent_at` right now. */
async function sentAt(request: {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
}): Promise<string | null | undefined> {
  const state = await mockState(request);
  return state.readerPosts[0]?.instapaper_sent_at;
}

test.describe('sending to Instapaper', () => {
  test('a send from the list leaves the list, lands in the archive badged, and was signed', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: seededPosts() });
    await page.goto('/reader');

    await page.getByRole('button', { name: 'Send to Instapaper' }).click();

    await expect(page.getByText('Nothing to read')).toBeVisible();
    await expect.poll(() => sentAt(request)).toEqual(expect.any(String));

    const state = await mockState(request);
    expect(state.instapaperRequests).toHaveLength(1);
    const [sent] = state.instapaperRequests;
    expect(sent?.params).toMatchObject({
      url: 'https://secondthoughts.substack.com/p/how-near-is-the-intelligence-explosion',
      title: TITLE,
      content: HTML,
    });
    expect(sent?.authorization).toMatch(/^OAuth .*oauth_signature="[^"]+"/);
    expect(state.readerPosts[0]?.archived_at).toEqual(expect.any(String));
    expect(state.readerPosts[0]?.instapaper_bookmark_id).toEqual(expect.any(Number));

    await page.goto('/reader/archive');
    const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
    await expect(row.getByText('in Instapaper')).toBeVisible();
  });

  test('a refused send puts the row back and says why', async ({ page, seed, request }) => {
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: seededPosts(),
      instapaperErrorCode: 1221,
    });
    await page.goto('/reader');

    await page.getByRole('button', { name: 'Send to Instapaper' }).click();

    await expect(page.getByText('This publication has opted out of Instapaper')).toBeVisible();
    await expect(page.getByTestId('reader-row').filter({ hasText: TITLE })).toBeVisible();
    await expect(page.getByText('1 to read')).toBeVisible();

    const state = await mockState(request);
    expect(state.instapaperRequests).toHaveLength(1);
    expect(state.readerPosts[0]).toMatchObject({ archived_at: null, instapaper_sent_at: null });
  });
});
