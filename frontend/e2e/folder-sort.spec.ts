import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Sorting a folder's tasks by priority or by due date (ALF-166): the header control, the
 * re-ranked list, and the choice surviving a trip to another folder and back.
 */

function task(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

/** A folder holding one task of each shape, so priority and due date disagree about the order. */
function seedState() {
  return {
    folders: [makeFolder('Work', { id: 'work' }), makeFolder('Home', { id: 'home' })],
    items: [
      task('Draft the board deck', { folder_id: 'work', priority: 'high', due_date: '2099-12-31' }),
      task('Renew the domain', { folder_id: 'work', priority: 'low', due_date: '2026-01-01' }),
      task('Read the postmortem', { folder_id: 'work', priority: 'medium' }),
    ],
  };
}

test('a folder opens ranked by priority', async ({ page, seed }) => {
  await seed(seedState());
  await page.goto('/folders/work');

  await expect(page.getByRole('button', { name: 'Sort by: Priority' })).toBeVisible();

  const rows = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Draft the board deck');
  await expect(rows.nth(1)).toContainText('Read the postmortem');
  await expect(rows.nth(2)).toContainText('Renew the domain');
});

test('sorting by due date puts the soonest deadline first and the undated task last', async ({
  page,
  seed,
}) => {
  await seed(seedState());
  await page.goto('/folders/work');

  await page.getByRole('button', { name: 'Sort by: Priority' }).click();
  await page.getByRole('menuitem', { name: 'Due date' }).click();

  await expect(page.getByRole('button', { name: 'Sort by: Due date' })).toBeVisible();

  const rows = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  // The Low-priority task due in 2026 now outranks the High-priority one due in 2099, and the
  // task with no due date sinks to the bottom.
  await expect(rows.nth(0)).toContainText('Renew the domain');
  await expect(rows.nth(1)).toContainText('Draft the board deck');
  await expect(rows.nth(2)).toContainText('Read the postmortem');
});

test('each folder keeps its own ordering across a view switch', async ({ page, seed }) => {
  await seed(seedState());
  await page.goto('/folders/work');

  await page.getByRole('button', { name: 'Sort by: Priority' }).click();
  await page.getByRole('menuitem', { name: 'Due date' }).click();
  await expect(page.getByRole('button', { name: 'Sort by: Due date' })).toBeVisible();

  // A different folder is at its own default…
  await page.getByRole('link', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Sort by: Priority' })).toBeVisible();

  // …and Work still remembers the due-date ordering when you come back.
  await page.getByRole('link', { name: 'Work' }).click();
  await expect(page.getByRole('button', { name: 'Sort by: Due date' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByRole('listitem').nth(0),
  ).toContainText('Renew the domain');
});
