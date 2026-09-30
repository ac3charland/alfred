import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
  MOCK_URL,
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A post's Further reading, through the whole stack: tick links in the browser, the send route on
 * the Next server listing Instapaper's folders and saving each link, the stand-in Instapaper in
 * the mock process recording what it was sent, and the atomic append that marks them — then the
 * marks the row redraws, which survive a reload.
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

interface InstapaperCall {
  path: string;
  params: Record<string, string>;
}

/** Every Instapaper call the route made, in order, with its form body. */
async function instapaperCalls(request: APIRequestContext): Promise<InstapaperCall[]> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as { instapaperRequests: InstapaperCall[] };
  return state.instapaperRequests.map(({ path, params }) => ({ path, params }));
}

async function openRow(page: Page): Promise<Locator> {
  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await row.getByRole('button', { name: 'Overview' }).click();
  await expect(row.getByRole('heading', { name: 'Further reading' })).toBeVisible();
  return row;
}

test.describe('sending Further reading', () => {
  test('ticks two links and sends them into To Reader; they read “In Reader”, after a reload too', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [roundupPost()] });
    await page.goto('/reader');
    const row = await openRow(page);

    // The section is last in the overview, after "Who should read it".
    const headings = await row.getByRole('heading', { level: 3 }).allTextContents();
    expect(headings.at(-1)).toBe('Further reading');

    await row.getByRole('checkbox', { name: PAPER.title }).click();
    await row.getByRole('checkbox', { name: RELEASE.title }).click();
    await expect(row.getByText('2 selected')).toBeVisible();
    await row.getByRole('button', { name: 'Send to Reader' }).click();

    await expect(row.getByText('In Reader')).toHaveCount(2);
    await expect(row.getByRole('checkbox', { name: PAPER.title })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: RELEASE.title })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: ESSAY.title })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(row.getByRole('group', { name: 'Selected links' })).toBeHidden();

    // The folder listing, then one save per link into To Reader: by URL, the model's words.
    expect(await instapaperCalls(request)).toEqual([
      { path: '/api/1.1/folders/list', params: {} },
      {
        path: '/api/1/bookmarks/add',
        params: {
          url: PAPER.url,
          title: PAPER.title,
          description: PAPER.note,
          folder_id: '7700001',
        },
      },
      {
        path: '/api/1/bookmarks/add',
        params: {
          url: RELEASE.url,
          title: RELEASE.title,
          description: RELEASE.note,
          folder_id: '7700001',
        },
      },
    ]);

    // Each item's open link stays, and opens the link itself in a new tab.
    const open = row.getByRole('link', { name: `Open ${PAPER.title}` });
    await expect(open).toHaveAttribute('href', PAPER.url);
    await expect(open).toHaveAttribute('target', '_blank');

    await page.reload();
    const reloaded = await openRow(page);
    await expect(reloaded.getByText('In Reader')).toHaveCount(2);
  });

  test('sends a link to Instapaper’s Unread, with no folder and no folder listing', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [roundupPost()] });
    await page.goto('/reader');
    const row = await openRow(page);

    await row.getByRole('checkbox', { name: ESSAY.title }).click();
    await row
      .getByRole('group', { name: 'Selected links' })
      .getByRole('button', { name: 'Send to Instapaper' })
      .click();

    await expect(row.getByText('In Instapaper')).toHaveCount(1);
    expect(await instapaperCalls(request)).toEqual([
      {
        path: '/api/1/bookmarks/add',
        params: { url: ESSAY.url, title: ESSAY.title, description: ESSAY.note },
      },
    ]);
  });

  test('with no To Reader folder, says so, saves nothing and keeps the ticks', async ({
    page,
    seed,
    request,
  }) => {
    await seed({
      readerPublications: [PUBLICATION],
      readerPosts: [roundupPost()],
      instapaperFolders: [],
    });
    await page.goto('/reader');
    const row = await openRow(page);

    await row.getByRole('checkbox', { name: PAPER.title }).click();
    await row.getByRole('button', { name: 'Send to Reader' }).click();

    await expect(page.getByText('There is no “To Reader” folder in Instapaper')).toBeVisible();
    await expect(row.getByRole('checkbox', { name: PAPER.title })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(row.getByText('In Reader')).toHaveCount(0);
    const recorded = await instapaperCalls(request);
    expect(recorded.map((call) => call.path)).toEqual(['/api/1.1/folders/list']);
  });
});
