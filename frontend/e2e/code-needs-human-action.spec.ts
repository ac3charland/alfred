import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The "Needs human action" view (ALF-103): a dedicated Code-module destination at
 * `/code/needs-human-action` that lists every story awaiting the owner's eyes — the human-review
 * states `in_refinement`, `ready_for_dev`, and `ready_for_review` — ranked by global priority.
 * Promoted from the Backlog's old "Human Review" filter macro into its own sidebar link, and made
 * the module's DEFAULT view (ALF-174): the bare `/code` opens it, and it leads the sidebar above
 * the Backlog.
 *
 * A code story only surfaces in `v_code_stories` when a backing `items` row with the same id is
 * ALSO seeded (the view's inner join), so each story is an item + a code_items sidecar.
 */

const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
const epic = makeEpic('Communication Firewall', {
  id: 'e1',
  project_id: 'p1',
  ref_number: 1,
  ref: 'ALF-1',
});

// One story per factory state that matters here: three human-review states plus three that must be
// filtered out (needs_refinement, in_development, done).
const items = [
  makeItem('Review the inbound-filter spec', { id: 'i1', item_type: 'code' }),
  makeItem('Clear the allow-list parser for dev', { id: 'i2', item_type: 'code' }),
  makeItem('Review the webhook HMAC PR', { id: 'i3', item_type: 'code' }),
  makeItem('Draft the triage UI spec', { id: 'i4', item_type: 'code' }),
  makeItem('Wire the alert dispatcher', { id: 'i5', item_type: 'code' }),
  makeItem('Ship the release notes', { id: 'i6', item_type: 'code' }),
];

const codeItems = [
  makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    priority: 1,
    factory_state: 'in_refinement',
  }),
  makeCodeStory({
    item_id: 'i2',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 4,
    ref: 'ALF-4',
    priority: 2,
    factory_state: 'ready_for_dev',
  }),
  makeCodeStory({
    item_id: 'i3',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 5,
    ref: 'ALF-5',
    priority: 3,
    factory_state: 'ready_for_review',
  }),
  makeCodeStory({
    item_id: 'i4',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 6,
    ref: 'ALF-6',
    priority: 4,
    factory_state: 'needs_refinement',
  }),
  makeCodeStory({
    item_id: 'i5',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 7,
    ref: 'ALF-7',
    priority: 5,
    factory_state: 'in_development',
  }),
  makeCodeStory({
    item_id: 'i6',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 8,
    ref: 'ALF-8',
    priority: 6,
    factory_state: 'done',
  }),
];

test('lists only the human-review stories, ranked by priority, filters at rest', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/needs-human-action');

  await expect(page.getByRole('heading', { name: 'Needs human action' })).toBeVisible();
  // Both filters rest at their defaults (ALF-316), so neither trigger carries a count.
  await expect(page.getByRole('button', { name: 'Filter by status' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter by project' })).toBeVisible();

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('ALF-3');
  await expect(rows.nth(1)).toContainText('ALF-4');
  await expect(rows.nth(2)).toContainText('ALF-5');
});

test('sits between the Dashboard and the Backlog in the sidebar, on its own route', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/needs-human-action');

  // The queue no longer claims the bare `/code` — the Dashboard does, and digests this queue.
  await expect(page.getByRole('heading', { name: 'Needs human action' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(3);

  const projectNav = page.getByRole('navigation', { name: 'Projects' });
  const navLinks = projectNav.getByRole('link');
  await expect(navLinks.nth(0)).toHaveText('Dashboard');
  await expect(navLinks.nth(1)).toHaveText('Needs human action');
  await expect(navLinks.nth(2)).toHaveText('Backlog');

  // The Backlog is one click away, on its own explicit route, named plainly now.
  await projectNav.getByRole('link', { name: 'Backlog' }).click();
  await expect(page).toHaveURL('/code/backlog');
  await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /software factory/i })).toHaveCount(0);
});

test('navigates to the view from the sidebar link', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/backlog');

  await page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: 'Needs human action' })
    .click();

  await expect(page).toHaveURL('/code/needs-human-action');
  await expect(page.getByRole('heading', { name: 'Needs human action' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(3);
});

/**
 * A second project whose human-review story ranks BETWEEN two Alfred ones (ALF-316), so the
 * project filter has something to hide in the middle of the queue.
 */
function seedTwoProjects() {
  const project2 = makeProject('Relay', { id: 'p2', key: 'RLP' });
  const epic2 = makeEpic('Routing', { id: 'e2', project_id: 'p2', ref_number: 1, ref: 'RLP-1' });
  return {
    projects: [project, project2],
    epics: [epic, epic2],
    items: [...items, makeItem('Approve the digest spec', { id: 'i7', item_type: 'code' })],
    codeItems: [
      ...codeItems,
      makeCodeStory({
        item_id: 'i7',
        project_id: 'p2',
        epic_id: 'e2',
        ref_number: 2,
        ref: 'RLP-2',
        priority: 1.5,
        factory_state: 'in_refinement',
      }),
    ],
  };
}

test('narrows the queue by status and by project (ALF-316)', async ({ page, seed }) => {
  await seed(seedTwoProjects());
  await page.goto('/code/needs-human-action');

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText('RLP-2');

  // The status menu offers only the three human-review states, all checked at rest.
  await page.getByRole('button', { name: /filter by status/i }).click();
  await expect(page.getByRole('menuitemcheckbox')).toHaveText([
    'In Refinement',
    'Ready for Dev',
    'Ready for Review',
  ]);
  for (const option of await page.getByRole('menuitemcheckbox').all()) {
    await expect(option).toHaveAttribute('aria-checked', 'true');
  }
  // Uncheck In Refinement; close the menu (Escape) before reading the rows it aria-hides.
  await page.getByRole('menuitemcheckbox', { name: 'In Refinement' }).click();
  await page.keyboard.press('Escape');

  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('ALF-4');
  await expect(rows.nth(1)).toContainText('ALF-5');
  await expect(page.getByRole('button', { name: /filter by status/i })).toContainText('(2)');

  // Restore it, then pick out Relay: only its spec-in-review story is left.
  await page.getByRole('button', { name: /filter by status/i }).click();
  await page.getByRole('menuitemcheckbox', { name: 'In Refinement' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /filter by project/i }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Relay' }).click();
  await page.keyboard.press('Escape');

  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('RLP-2');
  await expect(page.getByRole('button', { name: /filter by project/i })).toContainText('(1)');

  // Filtering out the last story says so, rather than claiming nothing needs attention.
  await page.getByRole('button', { name: /filter by status/i }).click();
  await page.getByRole('menuitemcheckbox', { name: 'In Refinement' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(0);
  await expect(page.getByText(/No stories match these filters/)).toBeVisible();
});

test('keeps its own filters across SPA navigation, apart from the Backlog (ALF-316)', async ({
  page,
  seed,
}) => {
  await seed(seedTwoProjects());
  await page.goto('/code/needs-human-action');

  const rows = page.getByRole('listitem');
  // Narrow both filters: Relay only, and Ready for Review unchecked.
  await page.getByRole('button', { name: /filter by project/i }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Relay' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /filter by status/i }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Ready for Review' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(1);

  // The Backlog keeps its own selections — neither pick here narrows it: no counts on its
  // triggers, and all six outstanding stories (Ready for Review included) still listed.
  const projectNav = page.getByRole('navigation', { name: 'Projects' });
  await projectNav.getByRole('link', { name: 'Backlog' }).click();
  await expect(page).toHaveURL('/code/backlog');
  await expect(page.getByRole('button', { name: /filter by project/i })).not.toContainText('(');
  await expect(page.getByRole('button', { name: /filter by status/i })).not.toContainText('(');
  await expect(rows).toHaveCount(6);
  await expect(page.getByRole('listitem').filter({ hasText: 'ALF-5' })).toHaveCount(1);

  // Back on this view, both picks survived the round-trip.
  await projectNav.getByRole('link', { name: 'Needs human action' }).click();
  await expect(page).toHaveURL('/code/needs-human-action');
  await expect(rows).toHaveCount(1);
  await expect(rows.nth(0)).toContainText('RLP-2');
  await expect(page.getByRole('button', { name: /filter by project/i })).toContainText('(1)');
  await expect(page.getByRole('button', { name: /filter by status/i })).toContainText('(2)');
});
