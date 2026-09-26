import type { APIRequestContext, Locator, Page } from '@playwright/test';

import {
  MOCK_URL,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Sending a post's Novel ideas into the wiki, through the whole stack: the checklist in the
 * browser, the send route, the wiki writer's Git Data API calls against the harness's mock
 * GitHub, and the atomic append that records the sent marks. The mock records every commit it
 * was handed, so each test reads back exactly what landed on the wiki's `main`.
 */

const PUBLICATION = makeReaderPublication('Jane Doe', {
  id: '44444444-4444-4444-8444-444444444444',
});
const POST_ID = '55555555-5555-4555-8555-555555555561';
const TITLE = 'Why habits stick';
const BODY = 'Habits are the compound interest of self-improvement.';

const HABIT = 'Habit stacking works because the cue is an existing routine, not a time of day.';
const ENVIRONMENT = 'Environment design beats willpower for the first thirty days.';
const STREAKS = 'Streak-tracking helps only until the first miss.';
const IDENTITY = 'Identity-based framing outlasts outcome goals.';
const IDEAS = [HABIT, ENVIRONMENT, STREAKS, IDENTITY];

function habitsPost() {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    title: TITLE,
    author: 'Jane Doe',
    canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
    text: BODY,
    word_count: 1640,
    summary_state: 'done',
    gist: "Routines anchored to an existing cue survive; routines anchored to a clock time don't.",
    overview: makeReaderOverview({ novel_ideas: IDEAS }),
    received_at: '2026-09-16T12:00:00.000Z',
  });
}

interface GithubCommit {
  sha: string;
  message: string;
  parents: string[];
  files: Record<string, string>;
}

interface GithubState {
  head: string;
  commits: GithubCommit[];
  inbox: string[];
}

async function githubState(request: APIRequestContext): Promise<GithubState> {
  const response = await request.get(`${MOCK_URL}/__mock__/state`);
  const state = (await response.json()) as { github: GithubState };
  return state.github;
}

/** The commit `main` points at — the mock also keeps orphans from failed attempts. */
function headCommit(state: GithubState): GithubCommit {
  const head = state.commits.find((commit) => commit.sha === state.head);
  if (head === undefined) throw new Error(`no commit for head ${state.head}`);
  return head;
}

/** The bullets a picks file lists, one `- ` line each. */
function pickedBullets(content: string): string[] {
  const body = content.split('\n---\n', 2)[1] ?? '';
  return body
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
}

/** The one folder a commit introduced, and its files by name. */
function folderOf(commit: GithubCommit): { folder: string; files: Record<string, string> } {
  const paths = Object.keys(commit.files);
  const folders = new Set(paths.map((path) => path.split('/').slice(0, 2).join('/')));
  expect(folders.size).toBe(1);
  const [folder = ''] = folders;
  const files = Object.fromEntries(
    paths.map((path) => [path.slice(folder.length + 1), commit.files[path] ?? ''] as const),
  );
  return { folder, files };
}

function picksOf(files: Record<string, string>): string {
  const names = Object.keys(files).filter((name) => /^picks-\d{4}-\d{2}-\d{2}\.md$/.test(name));
  expect(names).toHaveLength(1);
  return files[names[0] ?? ''] ?? '';
}

async function openRow(page: Page): Promise<Locator> {
  const row = page.getByTestId('reader-row').filter({ hasText: TITLE });
  await row.getByRole('button', { name: 'Overview' }).click();
  await expect(row.getByRole('heading', { name: 'Novel ideas' })).toBeVisible();
  return row;
}

test.describe('sending Novel ideas to the wiki', () => {
  test('ticks two and sends them as one commit, and the sent state survives a reload', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [habitsPost()] });
    await page.goto('/reader');
    const before = await githubState(request);

    const row = await openRow(page);
    await row.getByRole('checkbox', { name: ENVIRONMENT }).click();
    await row.getByRole('checkbox', { name: STREAKS }).click();
    await expect(row.getByText('2 selected')).toBeVisible();
    await row.getByRole('button', { name: 'Send to wiki' }).click();

    await expect(row.getByText('Sent', { exact: true })).toHaveCount(2);
    await expect(row.getByRole('checkbox', { name: ENVIRONMENT })).toHaveCount(0);
    await expect(row.getByRole('checkbox', { name: STREAKS })).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toHaveCount(2);
    await expect(row.getByRole('group', { name: 'Selected ideas' })).toBeHidden();

    const after = await githubState(request);
    const commit = headCommit(after);
    expect(commit.parents).toEqual([before.head]);
    expect(commit.message).toBe(`add: ${TITLE}`);
    const { folder, files } = folderOf(commit);
    expect(folder).toMatch(/^inbox\/\d{4}-\d{2}-\d{2}-why-habits-stick$/);
    expect(Object.keys(files)).toHaveLength(2);
    expect(files['source.md']).toContain(BODY);
    expect(pickedBullets(picksOf(files))).toEqual([ENVIRONMENT, STREAKS]);

    await page.reload();
    const reloaded = await openRow(page);
    await expect(reloaded.getByText('Sent', { exact: true })).toHaveCount(2);
    await expect(reloaded.getByRole('checkbox')).toHaveCount(2);
    await expect(reloaded.getByRole('checkbox', { name: HABIT })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('Send all sends the rest in a second commit, into a new folder', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [habitsPost()] });
    await page.goto('/reader');

    const row = await openRow(page);
    await row.getByRole('checkbox', { name: ENVIRONMENT }).click();
    await row.getByRole('checkbox', { name: STREAKS }).click();
    await row.getByRole('button', { name: 'Send to wiki' }).click();
    await expect(row.getByText('Sent', { exact: true })).toHaveCount(2);
    const first = headCommit(await githubState(request));

    // A tick left on one bullet makes no difference: Send all sends every unsent bullet.
    await row.getByRole('checkbox', { name: HABIT }).click();
    await row.getByRole('button', { name: 'Send all to wiki' }).click();

    await expect(row.getByText('All sent to wiki')).toBeVisible();
    await expect(row.getByText('Sent', { exact: true })).toHaveCount(4);
    await expect(row.getByRole('checkbox')).toHaveCount(0);

    const second = headCommit(await githubState(request));
    expect(second.sha).not.toBe(first.sha);
    expect(second.parents).toEqual([first.sha]);
    const { folder, files } = folderOf(second);
    expect(folder).not.toBe(folderOf(first).folder);
    expect(pickedBullets(picksOf(files))).toEqual([HABIT, IDENTITY]);
  });

  test('a failed send toasts and keeps the ticks, committing nothing', async ({
    page,
    seed,
    request,
  }) => {
    await seed({ readerPublications: [PUBLICATION], readerPosts: [habitsPost()] });
    await page.goto('/reader');
    const before = await githubState(request);
    await request.post(`${MOCK_URL}/__mock__/github/fail-next`, {
      data: { step: 'any', status: 502 },
    });

    const row = await openRow(page);
    await row.getByRole('checkbox', { name: ENVIRONMENT }).click();
    await row.getByRole('checkbox', { name: IDENTITY }).click();
    await row.getByRole('button', { name: 'Send to wiki' }).click();

    await expect(page.getByText("Couldn't reach the wiki repo")).toBeVisible();
    await expect(row.getByRole('checkbox', { name: ENVIRONMENT })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(row.getByRole('checkbox', { name: IDENTITY })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(row.getByRole('checkbox', { name: HABIT })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(row.getByText('2 selected')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Send to wiki' })).toBeEnabled();
    const after = await githubState(request);
    expect(after.head).toBe(before.head);
  });
});
