import type { Page } from '@playwright/test';

import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Code module's Dashboard (`/code` and `/code/dashboard`): the lines-changed-per-week chart,
 * the merged-PR split relocated from the Backlog, and a digest pane per queue.
 *
 * Both measurements come from live GitHub queries, which no test may make — so every case stubs
 * `/api/code/loc-velocity` and `/api/code/pr-ratio` at the network boundary. That also lets the
 * unconfigured cases assert the guarantee that matters most: both cards are ornaments, never
 * gates, so a deployment that has configured neither (501) still gets a fully usable Dashboard.
 */

const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
/**
 * The ratio stubs name two repos, and the card joins each to its project by `owner/name` — so
 * the specs that read the legend seed this second project too, and both repos resolve.
 */
const realplay = makeProject('RealPlay', { id: 'p2', key: 'RPL', repo_name: 'realplay' });
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
  // In a human-review state, so it belongs to BOTH digest panes.
  makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    priority: 1,
    factory_state: 'ready_for_review',
  }),
  // Outstanding but waiting on no human, so it belongs to the Backlog pane only.
  makeCodeStory({
    item_id: 'i2',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 4,
    ref: 'ALF-4',
    priority: 2,
    factory_state: 'in_development',
  }),
];

const RATIO = {
  week: {
    // Rolling (ALF-144): the seven days ending at a Friday-afternoon request.
    start: '2026-07-17T16:00:00-04:00',
    end: '2026-07-24T16:00:00-04:00',
    timezone: 'America/New_York',
  },
  total: 9,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
  ],
};

/** The same window once the Other bucket (ALF-135) is measured and non-empty. */
const RATIO_WITH_OTHER = {
  ...RATIO,
  total: 12,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 25 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 50 },
  ],
  other: { count: 3, percentage: 25 },
};

/** Twelve weeks of churn ending Sunday 6 Sep 2026, read mid-week — the last bucket is partial. */
const VELOCITY = {
  weeks: [3120, 3380, 3300, 4620, 4400, 4560, 5480, 5160, 5740, 6140, 5900, 1980].map(
    (lines, index, all) => {
      const partial = index === all.length - 1;
      const window = all.slice(Math.max(0, index - 3), index + 1);
      return {
        week: new Date(Date.parse('2026-06-21T00:00:00Z') + index * 604_800_000)
          .toISOString()
          .slice(0, 10),
        lines,
        average: partial
          ? null
          : Math.round(window.reduce((sum, entry) => sum + entry, 0) / window.length),
        partial,
      };
    },
  ),
  repos: ['ac3charland/realplay', 'ac3charland/alfred'],
  averageWeeks: 4,
};

/** Stub both GitHub-backed endpoints, so no case can depend on a live query. */
async function stubGithub(
  page: Page,
  {
    ratio = { status: 200, json: RATIO },
    velocity = { status: 200, json: VELOCITY },
  }: {
    ratio?: { status: number; json: unknown };
    velocity?: { status: number; json: unknown };
  } = {},
) {
  await page.route('**/api/code/pr-ratio*', (route) => route.fulfill(ratio));
  await page.route('**/api/code/loc-velocity*', (route) => route.fulfill(velocity));
}

test('shows the chart, the ratio and both digest panes on the Dashboard', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page);

  await page.goto('/code/dashboard');

  await expect(page.getByRole('heading', { name: 'The Software Factory' })).toBeVisible();

  // The chart: twelve weekly bars under a trailing-average line, with its window and average.
  await expect(page.getByText('Lines changed per week')).toBeVisible();
  await expect(page.getByText('Jun 21 – Sep 12', { exact: false })).toBeVisible();
  // The trailing mean of the last COMPLETE week, never the mid-week one.
  await expect(page.getByText('4-week average 5,735', { exact: false })).toBeVisible();
  // The axis maximum is a rounded tick, not the raw 6,140 peak.
  await expect(page.getByText('7,000')).toBeVisible();
  await expect(page.getByText('PRs merged in the last 7 days')).toBeVisible();

  // Both panes, each counting its WHOLE queue: one human-review story, two outstanding ones.
  const humanAction = page.getByRole('link', { name: /needs human action/i }).last();
  await expect(humanAction).toContainText('1');
  await expect(page.getByRole('link', { name: /^Backlog 2$/ })).toBeVisible();

  // A story awaiting review is legitimately in both panes; the other is Backlog-only.
  await expect(page.getByRole('link', { name: /ALF-3/ })).toHaveCount(2);
  await expect(page.getByRole('link', { name: /ALF-4/ })).toHaveCount(1);
});

test('renders the Dashboard at the bare /code, which no longer opens a queue', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page);

  await page.goto('/code');

  await expect(page.getByRole('heading', { name: 'The Software Factory' })).toBeVisible();
  await expect(page.getByText('Lines changed per week')).toBeVisible();
  // The sidebar highlights the Dashboard, and the queue link no longer claims this route.
  const projectNav = page.getByRole('navigation', { name: 'Projects' });
  // Anchored on the whole class, so the resting link's `hover:bg-secondary/50` can't match.
  const active = /(^|\s)bg-secondary(\s|$)/;
  await expect(projectNav.getByRole('link', { name: 'Dashboard' })).toHaveClass(active);
  await expect(projectNav.getByRole('link', { name: 'Needs human action' })).not.toHaveClass(
    active,
  );
});

test('opens a pane’s full page from its header, client-side', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page);
  await page.goto('/code/dashboard');

  const pane = page.getByRole('link', { name: /^Needs human action 1$/ });
  await expect(pane).toBeVisible();
  await pane.click();

  await expect(page).toHaveURL('/code/needs-human-action');
  await expect(page.getByRole('heading', { name: 'Needs human action' })).toBeVisible();
});

test('opens a story’s detail modal from a pane row', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page);
  await page.goto('/code/dashboard');

  await page.getByRole('link', { name: /ALF-4/ }).first().click();

  await expect(page).toHaveURL('/code/p1?story=ALF-4');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('ALF-4');
});

test('says so, rather than showing zeros, while GitHub is still computing the statistics', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page, {
    velocity: { status: 202, json: { error: 'GitHub is still computing these statistics' } },
  });

  await page.goto('/code/dashboard');

  await expect(page.getByText(/GitHub is still computing these statistics/)).toBeVisible();
  // No manual reload is asked for — the card polls for itself.
  await expect(page.getByText(/refresh/i)).toBeHidden();
  // The ratio beside it is unaffected, and so is everything else on the page.
  await expect(page.getByText('PRs merged in the last 7 days')).toBeVisible();
});

test('swaps the chart in on its own, with no reload, once GitHub finishes computing (ALF-243)', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.route('**/api/code/pr-ratio*', (route) => route.fulfill({ status: 200, json: RATIO }));

  // The first request finds GitHub still computing; every request after that finds it ready —
  // exactly what a real cold cache warming up between polls looks like.
  let requestCount = 0;
  await page.route('**/api/code/loc-velocity*', (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      return route.fulfill({
        status: 202,
        json: { error: 'GitHub is still computing these statistics' },
      });
    }
    return route.fulfill({ status: 200, json: VELOCITY });
  });

  await page.goto('/code/dashboard');

  await expect(page.getByText(/GitHub is still computing these statistics/)).toBeVisible();

  // The card's own timer re-polls — nobody clicks anything or reloads the page.
  await expect(page.getByText('Jun 21 – Sep 12', { exact: false })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/GitHub is still computing these statistics/)).toBeHidden();
});

test('shows a muted note, not silence, when GitHub would not answer', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page, {
    velocity: { status: 502, json: { error: 'GitHub request failed' } },
  });

  await page.goto('/code/dashboard');

  // Silence here would read as "you wrote no code for three months".
  await expect(page.getByText("Couldn't load line counts.")).toBeVisible();
});

test('renders the Dashboard untouched — no cards, no gap — when neither is configured', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await stubGithub(page, {
    ratio: { status: 501, json: { error: 'PR ratio is not configured' } },
    velocity: { status: 501, json: { error: 'Lines-changed velocity is not configured' } },
  });

  await page.goto('/code/dashboard');

  await expect(page.getByRole('heading', { name: 'The Software Factory' })).toBeVisible();
  await expect(page.getByText('Lines changed per week')).toBeHidden();
  await expect(page.getByText('PRs merged in the last 7 days')).toBeHidden();
  await expect(page.getByText("Couldn't load line counts.")).toBeHidden();
  await expect(page.getByText("Couldn't load PR counts.")).toBeHidden();
  // The digest panes below carry on regardless.
  await expect(page.getByRole('link', { name: /^Backlog 2$/ })).toBeVisible();
});

test('shows the rolling seven-day PR split on the Dashboard', async ({ page, seed }) => {
  await seed({ projects: [project, realplay], epics: [epic], items, codeItems });
  await stubGithub(page);

  await page.goto('/code/dashboard');

  await expect(page.getByText('PRs merged in the last 7 days')).toBeVisible();
  // Both ends inclusive: the first and last day the window actually covers.
  await expect(page.getByText('Jul 17 – Jul 24', { exact: false })).toBeVisible();

  // One legend entry per project, in the endpoint's order, each with its percentage and count.
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

  // It sits below the lines-changed chart, per the ticket's own "velocity and PR ratio".
  const chartBox = await page.getByText('Lines changed per week').boundingBox();
  const ratioBox = await page.getByText('PRs merged in the last 7 days').boundingBox();
  expect(chartBox?.y ?? 0).toBeLessThan(ratioBox?.y ?? 0);
});

test('adds an Other entry for the PRs merged outside the project repos', async ({ page, seed }) => {
  await seed({ projects: [project, realplay], epics: [epic], items, codeItems });
  await stubGithub(page, { ratio: { status: 200, json: RATIO_WITH_OTHER } });

  await page.goto('/code/dashboard');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(3);
  // Other comes last, after the projects, and carries its own count.
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

test('drops the Other entry when nothing merged outside the project repos', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project, realplay], epics: [epic], items, codeItems });
  await stubGithub(page, {
    ratio: { status: 200, json: { ...RATIO, other: { count: 0, percentage: 0 } } },
  });

  await page.goto('/code/dashboard');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(2);
  await expect(page.getByText('Other')).toBeHidden();
});

test('hides a project’s legend row when it merged no PRs this window (ALF-284)', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project, realplay], epics: [epic], items, codeItems });
  await stubGithub(page, {
    ratio: {
      status: 200,
      json: {
        ...RATIO,
        repos: [
          { repo: 'ac3charland/realplay', label: 'RealPlay', count: 0, percentage: 0 },
          { repo: 'ac3charland/alfred', label: 'Alfred', count: 9, percentage: 100 },
        ],
      },
    },
  });

  await page.goto('/code/dashboard');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(1);
  await expect(legend.first()).toContainText('Alfred');
  // RealPlay still names the sidebar's project link — only its PR-ratio legend row is gone.
  await expect(legend.filter({ hasText: 'RealPlay' })).toHaveCount(0);
  // The bar's accessible label is built from the same filtered set, so it can't still name
  // the hidden project either.
  await expect(
    page.getByRole('img', { name: 'Alfred 100 percent, 9 pull requests' }),
  ).toBeVisible();
});

test('opens a project’s board from its PR-ratio legend entry, while Other stays plain text', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project, realplay], epics: [epic], items, codeItems });
  await stubGithub(page, { ratio: { status: 200, json: RATIO_WITH_OTHER } });
  await page.goto('/code/dashboard');

  const legend = page.getByRole('listitem').filter({ hasText: '%' });
  await expect(legend).toHaveCount(3);
  // Each project's row is one link to its board; Other isn't one place, so it links nowhere.
  await expect(legend.nth(0).getByRole('link')).toHaveAttribute('href', '/code/p2');
  await expect(legend.nth(1).getByRole('link')).toHaveAttribute('href', '/code/p1');
  await expect(legend.nth(2).getByRole('link')).toHaveCount(0);

  await legend.nth(0).getByRole('link').click();

  await expect(page).toHaveURL('/code/p2');
  await expect(page.getByRole('heading', { name: 'RealPlay' })).toBeVisible();
});

test('leaves the Backlog with no ratio card at all — it lives on the Dashboard now', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  // A ratio that WOULD render, so a surviving copy on the Backlog shows up rather than
  // silently rendering nothing the way an unconfigured deployment does.
  await stubGithub(page);

  await page.goto('/code/backlog');

  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /software factory/i })).toHaveCount(0);
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('ALF-3');

  await expect(page.getByText('PRs merged in the last 7 days')).toBeHidden();
  await expect(page.getByText('Lines changed per week')).toBeHidden();
});

test('excludes a project from the PR ratio through the card’s ⋯ menu, and the tick survives a reload', async ({
  page,
  seed,
}) => {
  // Real UUIDs: the exclusion is a PATCH /api/projects/[id], which validates the id.
  const alfred = makeProject('Alfred', { id: '00000000-0000-4000-8000-0000000000a1', key: 'ALF' });
  const knowledge = makeProject('Knowledge', {
    id: '00000000-0000-4000-8000-0000000000a2',
    key: 'KNO',
    repo_name: 'knowledge',
  });
  await seed({ projects: [alfred, knowledge] });
  await stubGithub(page);
  await page.goto('/code/dashboard');

  await page.getByRole('button', { name: 'PR ratio options' }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByText('Exclude from PR ratio')).toBeVisible();
  const knowledgeItem = menu.getByRole('menuitemcheckbox', { name: 'Knowledge' });
  await expect(knowledgeItem).toHaveAttribute('aria-checked', 'false');

  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${knowledge.id}`) &&
      response.request().method() === 'PATCH',
  );
  // The card asks for the ratio again once the save lands, so the bar reflects it.
  const refetched = page.waitForRequest('**/api/code/pr-ratio*');
  await knowledgeItem.click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  await refetched;

  // Ticked, and the menu stayed open for another pick.
  await expect(knowledgeItem).toHaveAttribute('aria-checked', 'true');
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Alfred' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'PR ratio options' }).click();
  await expect(
    page.getByRole('menu').getByRole('menuitemcheckbox', { name: 'Knowledge' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('menu').getByRole('menuitemcheckbox', { name: 'Alfred' }),
  ).toHaveAttribute('aria-checked', 'false');
});
