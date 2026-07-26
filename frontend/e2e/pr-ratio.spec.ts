import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The PR-ratio card at the top of the Backlog (ALF-131): this week's merged pull requests
 * split across the configured repos.
 *
 * The counts come from a live GitHub query, which no test may make — so both cases stub
 * `/api/code/pr-ratio` at the network boundary. That also lets the second case assert the
 * guarantee that matters most: the card is an ornament, never a gate, so a deployment that
 * hasn't configured it (501) shows a Backlog identical to today's.
 */

const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
const epic = makeEpic('Communication Firewall', {
  id: 'e1',
  project_id: 'p1',
  ref_number: 1,
  ref: 'ALF-1',
});

const items = [
  makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' }),
  makeItem('Implement the allow-list parser', { id: 'i2', item_type: 'code' }),
];

const codeItems = [
  makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    priority: 1,
  }),
  makeCodeStory({
    item_id: 'i2',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 4,
    ref: 'ALF-4',
    priority: 2,
  }),
];

const RATIO = {
  week: {
    start: '2026-07-20T00:00:00-04:00',
    end: '2026-07-27T00:00:00-04:00',
    timezone: 'America/New_York',
  },
  total: 9,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
  ],
};

/** The same week once the Other bucket (ALF-135) is measured and non-empty. */
const RATIO_WITH_OTHER = {
  ...RATIO,
  total: 12,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 25 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 50 },
  ],
  other: { count: 3, percentage: 25 },
};

test('shows the weekly PR split above the story list', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.route('**/api/code/pr-ratio*', (route) => route.fulfill({ status: 200, json: RATIO }));

  await page.goto('/code/backlog');

  await expect(page.getByText('PRs merged this week')).toBeVisible();
  await expect(page.getByText('Jul 20 – Jul 26', { exact: false })).toBeVisible();

  // One legend entry per repo, in configured order, each with its percentage and raw count.
  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(2);
  await expect(legend.nth(0)).toContainText('RealPlay');
  await expect(legend.nth(0)).toContainText('33%');
  await expect(legend.nth(0)).toContainText('(3)');
  await expect(legend.nth(1)).toContainText('Alfred');
  await expect(legend.nth(1)).toContainText('67%');
  await expect(legend.nth(1)).toContainText('(6)');

  // The bar itself carries the split for assistive technology.
  await expect(
    page.getByRole('img', {
      name: 'RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests',
    }),
  ).toBeVisible();

  // It sits above the story list, not below it.
  const cardBox = await page.getByText('PRs merged this week').boundingBox();
  const firstRowBox = await page.getByRole('listitem').filter({ hasText: 'ALF-3' }).boundingBox();
  expect(cardBox?.y ?? 0).toBeLessThan(firstRowBox?.y ?? 0);
});

test('adds an Other entry for the PRs merged outside the configured repos', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.route('**/api/code/pr-ratio*', (route) =>
    route.fulfill({ status: 200, json: RATIO_WITH_OTHER }),
  );

  await page.goto('/code/backlog');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(3);
  // Other comes last, after the configured repos, and carries its own count.
  await expect(legend.nth(2)).toContainText('Other');
  await expect(legend.nth(2)).toContainText('25%');
  await expect(legend.nth(2)).toContainText('(3)');

  await expect(page.getByText('12 total', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('img', {
      name: 'RealPlay 25 percent, 3 pull requests; Alfred 50 percent, 6 pull requests; Other 25 percent, 3 pull requests',
    }),
  ).toBeVisible();
});

test('drops the Other entry when nothing merged outside the configured repos', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.route('**/api/code/pr-ratio*', (route) =>
    route.fulfill({ status: 200, json: { ...RATIO, other: { count: 0, percentage: 0 } } }),
  );

  await page.goto('/code/backlog');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(2);
  await expect(page.getByText('Other')).toBeHidden();
});

test('renders the Backlog untouched — no card, no error — when the feature is unconfigured', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.route('**/api/code/pr-ratio*', (route) =>
    route.fulfill({ status: 501, json: { error: 'PR ratio is not configured' } }),
  );

  await page.goto('/code/backlog');

  await expect(page.getByRole('heading', { name: /software factory/i })).toBeVisible();
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('ALF-3');

  await expect(page.getByText('PRs merged this week')).toBeHidden();
  await expect(page.getByText("Couldn't load PR counts.")).toBeHidden();
});
