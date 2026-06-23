import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Backlog (ALF-35): the default Code view at `/code` lists every outstanding story across
 * projects, ranked by global priority. The owner re-ranks with up/down chevrons (an atomic
 * `swap_code_priority`), and a row's body deep-links into the story's detail modal on its board.
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

const items = [
  makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' }),
  makeItem('Refine the routing rules', { id: 'i2', item_type: 'code' }),
  makeItem('Implement the allow-list parser', { id: 'i3', item_type: 'code' }),
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
  makeCodeStory({
    item_id: 'i3',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 5,
    ref: 'ALF-5',
    priority: 3,
  }),
];

test('renders the Backlog as the default Code view, ranked by priority', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code');

  await expect(page.getByRole('heading', { name: /software factory/i })).toBeVisible();

  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('ALF-3');
  await expect(rows.nth(1)).toContainText('ALF-4');
  await expect(rows.nth(2)).toContainText('ALF-5');
});

test('reorders a story up with the chevron and persists the new order', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/backlog');

  const rows = page.getByRole('listitem');
  await expect(rows.nth(0)).toContainText('ALF-3');

  // Move ALF-4 up: it swaps priority with ALF-3 and leads the list.
  await page.getByRole('button', { name: 'Move ALF-4 up' }).click();
  await expect(rows.nth(0)).toContainText('ALF-4');
  await expect(rows.nth(1)).toContainText('ALF-3');

  // The swap persisted: a reload (re-seeded read) keeps the new order.
  await page.reload();
  await expect(page.getByRole('listitem').nth(0)).toContainText('ALF-4');
});

test('opens a story modal on its project board from a Backlog row', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code');

  await page.getByRole('link', { name: /Open ALF-5/ }).click();
  await expect(page).toHaveURL(/\/code\/p1\?story=ALF-5/);

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('ALF-5')).toBeVisible();
  await expect(dialog.getByText('Implement the allow-list parser')).toBeVisible();

  // Closing the modal clears the ?story= param and stays on the board.
  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(page).toHaveURL('/code/p1');
});
