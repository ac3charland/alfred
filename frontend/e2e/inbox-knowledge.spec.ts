import type { APIRequestContext } from '@playwright/test';

import { MOCK_URL, makeFolder, makeItem } from './support/constants';
import { boxOf } from './support/drag';
import { expect, test } from './support/fixtures';

/**
 * Knowledge rows in the Inbox: an idea classified as Knowledge wears the lightbulb, and Dispatch
 * sends it into the wiki repo's `inbox/` — one commit, one folder per idea — and takes it out of
 * Alfred. Proven end-to-end because the claim spans the whole stack: the row's menu, the store's
 * one request, the route's commit through the Git Data API (the mock GitHub), and the RPC that
 * stamps then deletes the row.
 */

interface CommitState {
  sha: string;
  message: string;
  files: Record<string, string>;
}

interface MockState {
  items: { id: string }[];
  github: { head: string; commits: CommitState[] };
}

async function mockState(request: APIRequestContext): Promise<MockState> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  return (await response.json()) as MockState;
}

/** The commit `main` points at now. */
async function headSha(request: APIRequestContext): Promise<string> {
  const { github } = await mockState(request);
  return github.head;
}

/** A path the send commits: `inbox/<date>-<slug>/notes-<date>.md`, the same UTC day twice. */
const NOTES_PATH = /^inbox\/(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\/notes-\1\.md$/;

test('classify a capture as Knowledge from the row menu, then Dispatch it to the wiki', async ({
  page,
  request,
  seed,
}) => {
  const idea = makeItem('Forgetting is the signal, not the failure', {
    id: '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
    notes: 'Spaced repetition works because each retrieval nearly fails.',
  });
  await seed({ items: [idea] });
  const { github: before } = await mockState(request);

  await page.goto('/?view=inbox');
  const row = page.getByRole('listitem').filter({ hasText: idea.title });
  await expect(row).toBeVisible();

  // Classify as… → Knowledge.
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
  await page.getByRole('menuitem', { name: 'Knowledge' }).click();

  // The lightbulb names the row, and the wiki being connected makes it dispatch-ready.
  await expect(row.getByRole('img', { name: 'Knowledge' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Ready to dispatch' })).toBeVisible();

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();

  await expect(page.getByText('Sent to the wiki')).toBeVisible();
  await expect(page.getByText(idea.title)).toBeHidden();

  // One new commit on main, holding exactly one notes file in a brand-new inbox folder…
  await expect.poll(() => headSha(request)).not.toBe(before.head);
  const { github, items } = await mockState(request);
  const [head] = github.commits;
  expect(head?.sha).toBe(github.head);
  expect(github.commits).toHaveLength(before.commits.length + 1);
  const paths = Object.keys(head?.files ?? {});
  expect(paths).toHaveLength(1);
  expect(paths[0]).toMatch(NOTES_PATH);
  expect(Object.values(head?.files ?? {})[0]).toContain(
    'Spaced repetition works because each retrieval nearly fails.',
  );
  // …and the item has left Alfred.
  expect(items.find((item) => item.id === idea.id)).toBeUndefined();
});

test('a bulk Dispatch of two ideas is one commit with two folders', async ({
  page,
  request,
  seed,
}) => {
  const first = makeItem('Tests are back-pressure on generation', {
    id: '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b',
    item_type: 'knowledge',
  });
  const second = makeItem('Capture first, triage later', {
    id: '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c',
    item_type: 'knowledge',
  });
  await seed({ items: [first, second] });
  const { github: before } = await mockState(request);

  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: `Select "${first.title}"` }).click();
  await page.getByRole('button', { name: `Select "${second.title}"` }).click();
  await page.getByRole('button', { name: 'Dispatch' }).click();

  await expect(page.getByText('Sent 2 ideas to the wiki')).toBeVisible();
  await expect(page.getByText(first.title)).toBeHidden();
  await expect(page.getByText(second.title)).toBeHidden();

  await expect.poll(() => headSha(request)).not.toBe(before.head);
  const { github, items } = await mockState(request);
  // Exactly one commit for the whole selection…
  expect(github.commits).toHaveLength(before.commits.length + 1);
  const paths = Object.keys(github.commits[0]?.files ?? {});
  // …holding one notes file in each of two distinct folders.
  expect(paths).toHaveLength(2);
  for (const path of paths) expect(path).toMatch(NOTES_PATH);
  expect(new Set(paths.map((path) => path.split('/', 2)[1])).size).toBe(2);
  expect(items.filter((item) => item.id === first.id || item.id === second.id)).toHaveLength(0);
});

test('a failed commit keeps the idea in the Inbox', async ({ page, request, seed }) => {
  const idea = makeItem('Environment beats willpower', {
    id: '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d',
    item_type: 'knowledge',
  });
  await seed({ items: [idea] });
  await request.post(`${MOCK_URL}/__mock__/github/fail-next`, {
    data: { step: 'any', status: 502 },
  });

  await page.goto('/?view=inbox');
  const row = page.getByRole('listitem').filter({ hasText: idea.title });
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch' }).click();

  await expect(page.getByText("1 of 1 couldn't be dispatched")).toBeVisible();
  await expect(row).toBeVisible();
  const { items } = await mockState(request);
  expect(items.find((item) => item.id === idea.id)).toBeDefined();
});

test('a knowledge row is not draggable onto a folder', async ({ page, seed }) => {
  // A folder holds tasks: a drop there would run moveTask and file the idea like a task instead
  // of sending it to the wiki. The same press-and-glide that files a task, held down so the
  // assertions run while a drag would be active.
  const work = makeFolder('Work');
  const idea = makeItem('Identity outlasts outcome goals', { item_type: 'knowledge' });
  await seed({ folders: [work], items: [idea] });
  await page.goto('/?view=inbox');

  const source = page.getByRole('list', { name: 'Tasks' }).getByText(idea.title);
  await expect(source).toBeVisible();
  const folderLink = page.getByRole('link', { name: 'Work' });
  const from = await boxOf(source);
  const to = await boxOf(folderLink);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 16, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });

  await expect(page.locator('.opacity-40')).toHaveCount(0);
  await expect(page.locator('[data-drop-over="true"]')).toHaveCount(0);
  await page.mouse.up();

  await expect(source).toBeVisible();
});
