import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The per-view "Collapse all" header control: one click closes every open subtask tree
 * (at any depth) and every open "Show completed" panel in that view, and it is disabled
 * when the view has nothing open to collapse.
 *
 * Fixtures here carry subtasks, completed children and editable due dates — all task-only
 * — so they classify as `task`s rather than `makeItem`'s default `unclassified`.
 */
type MakeItemOverrides = Parameters<typeof makeItem>[1];
function makeTask(title: string, overrides: MakeItemOverrides = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

test.describe('collapse all', () => {
  test('collapses every open subtree and completed panel in one click', async ({ page, seed }) => {
    await seed({
      items: [
        makeTask('Plan the launch party', { id: 'p1' }),
        makeTask('Draft the invite', { id: 'c1', parent_id: 'p1' }),
        makeTask('Pick a template', { id: 'gc1', parent_id: 'c1' }),
        makeTask('Book the venue', {
          id: 'c2',
          parent_id: 'p1',
          status: 'completed',
          completed_at: '2025-01-02T00:00:00Z',
        }),
      ],
    });
    await page.goto('/?view=inbox');

    const collapseAll = page.getByRole('button', { name: 'Collapse all' });
    // Nothing is open yet, so there is nothing to collapse.
    await expect(collapseAll).toBeDisabled();

    // Open two levels of subtree plus the completed panel.
    await page.getByRole('button', { name: 'Expand subtasks' }).click(); // p1 → reveals c1
    await page.getByRole('button', { name: 'Expand subtasks' }).click(); // c1 → reveals gc1
    await page.getByRole('button', { name: 'Show completed (1)' }).click();

    await expect(page.getByRole('list', { name: 'Completed subtasks' })).toBeVisible();
    // `exact` so the name does not substring-match the "Completed subtasks" list too.
    await expect(page.getByRole('list', { name: 'Subtasks', exact: true })).toHaveCount(2);
    await expect(collapseAll).toBeEnabled();

    await collapseAll.click();

    // Both subtree levels and the completed panel leave the accessibility tree, and the
    // control disables itself again now that the view is fully collapsed.
    await expect(page.getByRole('list', { name: 'Subtasks', exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Completed subtasks' })).toHaveCount(0);
    await expect(collapseAll).toBeDisabled();
  });

  test('the control is present in the folder and completed views too', async ({ page, seed }) => {
    await seed({
      folders: [makeFolder('Work', { id: 'f1' })],
      items: [
        makeTask('Folder task', { id: 'ft', folder_id: 'f1' }),
        makeTask('Done thing', {
          id: 'd1',
          status: 'completed',
          completed_at: '2025-01-02T00:00:00Z',
        }),
      ],
    });

    await page.goto('/folders/f1');
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();

    await page.getByRole('link', { name: 'Completed' }).click();
    await expect(page.getByRole('button', { name: 'Collapse all' })).toBeVisible();
  });

  test('editing a parent’s due date does not expand its subtree', async ({ page, seed }) => {
    await seed({
      items: [
        makeTask('Write the proposal', { id: 'p1' }),
        makeTask('Gather requirements', { id: 'c1', parent_id: 'p1' }),
      ],
    });
    await page.goto('/?view=inbox');

    const subtasks = page.getByRole('list', { name: 'Subtasks', exact: true });
    await expect(subtasks).toBeHidden();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set due date' }).click();

    // The meta panel opens for editing… (`exact` so "Due date" doesn't also match the
    // "Set due date" menuitem mid-close).
    await expect(page.getByText('Due date', { exact: true })).toBeVisible();
    // …but the subtree stays collapsed (the meta panel is a sibling of the subtree).
    await expect(subtasks).toBeHidden();
  });
});
