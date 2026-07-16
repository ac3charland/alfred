import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The "Needs human action" view (ALF-103): a dedicated Code-module destination at
 * `/code/needs-human-action` that lists every story awaiting the owner's eyes — the human-review
 * states `in_refinement`, `ready_for_dev`, and `ready_for_review` — ranked by global priority.
 * Promoted from the Backlog's old "Human Review" filter macro into its own sidebar link.
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

test('lists only the human-review stories, ranked by priority, with no filter control', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/needs-human-action');

  await expect(page.getByRole('heading', { name: 'Needs human action' })).toBeVisible();
  // The view IS the filter, so there is no "Filter by status" dropdown here.
  await expect(page.getByRole('button', { name: /filter by status/i })).toHaveCount(0);

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('ALF-3');
  await expect(rows.nth(1)).toContainText('ALF-4');
  await expect(rows.nth(2)).toContainText('ALF-5');
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
