import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Completed view: the summary count, where-it-lives context labels, and
 * reactivating a completed task.
 *
 * Completed items are `task`s — completion is task-only (§7.3), and only a task may carry
 * a non-active status, so these fixtures classify as tasks (not `makeItem`'s default).
 */

test('shows completed tasks with their context labels', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Work', { id: 'f1' })],
    items: [
      makeItem('Finished inbox task', { id: 'd1', status: 'completed', item_type: 'task' }),
      makeItem('Finished work task', {
        id: 'd2',
        status: 'completed',
        folder_id: 'f1',
        item_type: 'task',
      }),
    ],
  });

  await page.goto('/completed');

  await expect(page.getByText('2 completed tasks')).toBeVisible();

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Finished inbox task')).toBeVisible();
  await expect(tasks.getByText('Finished work task')).toBeVisible();
  // Context labels show where each task lives. Exact match so "Inbox" / "Work"
  // don't also hit the "Finished inbox task" / "Finished work task" titles.
  await expect(tasks.getByText('Inbox', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Work', { exact: true })).toBeVisible();
});

test('reactivating a completed task returns it to the inbox', async ({ page, seed }) => {
  await seed({
    items: [makeItem('Reopen me', { id: 'd1', status: 'completed', item_type: 'task' })],
  });

  await page.goto('/completed');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Reopen me')).toBeVisible();

  await page.getByRole('button', { name: 'Mark "Reopen me" active' }).click();
  await expect(tasks.getByText('Reopen me')).toBeHidden();

  // The Inbox nav link was removed (§6.2); reach the inbox via its `?view=inbox` deep link.
  // The reactivation already persisted (status → active), so the inbox shows the task.
  await page.goto('/?view=inbox');
  await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Reopen me')).toBeVisible();
});
