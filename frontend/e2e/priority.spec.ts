import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The task priority feature (ALF-37): setting a level from the row editor menu, the badge
 * appearing on the row, and the By-Priority view ranking every top-level task.
 *
 * Priority is task-only, so these fixtures classify as tasks (not `makeItem`'s default).
 */
function task(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

test('set a priority from the editor menu → the badge appears → it ranks on /priority', async ({
  page,
  seed,
}) => {
  await seed({ items: [task('Triage the production bug')] });
  await page.goto('/?view=inbox');

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Triage the production bug')).toBeVisible();

  // Open the row's More actions menu → Set priority (opens the inline meta panel).
  await tasks.getByText('Triage the production bug').hover();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Set priority' }).click();

  // In the meta panel, open the Priority select (its FieldLabel names the trigger
  // "Priority") and choose High.
  await page.getByRole('button', { name: 'Priority' }).click();
  await page.getByRole('menuitem', { name: 'High', exact: true }).click();

  // The colour-coded badge now shows on the row.
  await expect(page.getByRole('button', { name: 'Priority: High' })).toBeVisible();

  // And the task is reachable + ranked on the By-Priority view.
  await page.getByRole('link', { name: 'Priority' }).click();
  const ranked = page.getByRole('list', { name: 'Tasks by priority' });
  await expect(ranked.getByText('Triage the production bug')).toBeVisible();
  await expect(ranked.getByRole('button', { name: 'Priority: High' })).toBeVisible();
});

test('ranks tasks High → Medium → Low → unprioritised', async ({ page, seed }) => {
  await seed({
    items: [
      task('Low thing', { priority: 'low' }),
      task('Unprioritised thing'),
      task('High thing', { priority: 'high' }),
      task('Medium thing', { priority: 'medium' }),
    ],
  });

  await page.goto('/priority');

  const rows = page.getByRole('list', { name: 'Tasks by priority' }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('High thing');
  await expect(rows.nth(1)).toContainText('Medium thing');
  await expect(rows.nth(2)).toContainText('Low thing');
  await expect(rows.nth(3)).toContainText('Unprioritised thing');
});

test('orders tasks within a folder by priority', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Work', { id: 'work' })],
    items: [
      task('Low chore', { folder_id: 'work', priority: 'low' }),
      task('Unprioritised chore', { folder_id: 'work' }),
      task('High chore', { folder_id: 'work', priority: 'high' }),
      task('Medium chore', { folder_id: 'work', priority: 'medium' }),
    ],
  });

  await page.goto('/folders/work');

  const rows = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('High chore');
  await expect(rows.nth(1)).toContainText('Medium chore');
  await expect(rows.nth(2)).toContainText('Low chore');
  await expect(rows.nth(3)).toContainText('Unprioritised chore');
});
