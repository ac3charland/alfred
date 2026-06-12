import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Task row interactions: subtasks, cascade completion, inline editing (title, due
 * date, notes), moving between folders, and deletion. All run in the inbox view
 * against the seeded mock backend.
 */

test.describe('subtasks', () => {
  test('adds a subtask inline and shows it nested under the parent', async ({ page, seed }) => {
    // Real UUID id: the new subtask is created via POST with parent_id = this id,
    // and the route validates parent_id as a UUID (a readable id would 400 → roll back).
    await seed({ items: [makeItem('Plan the trip')] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Add subtask' }).click();
    const subtaskBox = page.getByPlaceholder('Add subtask…');
    await subtaskBox.fill('Book flights');
    await subtaskBox.press('Enter');

    await expect(
      page.getByRole('list', { name: 'Subtasks' }).getByText('Book flights'),
    ).toBeVisible();
  });

  test('expands and collapses an existing subtree', async ({ page, seed }) => {
    await seed({
      items: [
        makeItem('Parent task', { id: 'p1' }),
        makeItem('Hidden child', { id: 'c1', parent_id: 'p1' }),
      ],
    });
    await page.goto('/?view=inbox');

    const child = page.getByText('Hidden child');
    await expect(child).toBeHidden();

    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(child).toBeVisible();

    await page.getByRole('button', { name: 'Collapse subtasks' }).click();
    await expect(child).toBeHidden();
  });
});

test.describe('cascade completion', () => {
  test('completing a parent confirms the cascade and completes the subtree', async ({
    page,
    seed,
  }) => {
    await seed({
      items: [
        makeItem('Ship feature', { id: 'p1' }),
        makeItem('Write code', { id: 'c1', parent_id: 'p1' }),
      ],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Mark "Ship feature" complete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Complete all' }).click();

    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Ship feature')).toBeHidden();

    await page.goto('/completed');
    await expect(page.getByText('2 completed tasks')).toBeVisible();
  });

  test('cancelling the cascade leaves the task active', async ({ page, seed }) => {
    await seed({
      items: [
        makeItem('Keep me', { id: 'p1' }),
        makeItem('My child', { id: 'c1', parent_id: 'p1' }),
      ],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Mark "Keep me" complete' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Keep me')).toBeVisible();
  });
});

test.describe('inline editing', () => {
  test('edits a task title via double-click', async ({ page, seed }) => {
    await seed({ items: [makeItem('Original title', { id: 't1' })] });
    await page.goto('/?view=inbox');

    await page.getByText('Original title').dblclick();
    const input = page.getByRole('textbox', { name: 'Edit title' });
    await input.fill('Updated title');
    await input.press('Enter');

    const tasks = page.getByRole('list', { name: 'Tasks' });
    await expect(tasks.getByText('Updated title')).toBeVisible();
    await expect(tasks.getByText('Original title')).toBeHidden();
  });

  test('sets a due date from the actions menu', async ({ page, seed }) => {
    await seed({ items: [makeItem('Schedule review', { id: 't1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Set due date' }).click();

    // The date input auto-saves on blur, so committing the value is enough — no
    // need to click the (then-unmounted) Save button.
    const dateInput = page.getByLabel('Due date');
    await dateInput.fill('2099-12-31');
    await dateInput.blur();

    await expect(page.getByRole('button', { name: 'Due date: 2099-12-31' })).toBeVisible();
  });

  test('adds notes from the actions menu', async ({ page, seed }) => {
    await seed({ items: [makeItem('Research options', { id: 't1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Add notes' }).click();

    await page.getByLabel('Notes').fill('Compare three vendors first');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Compare three vendors first')).toBeVisible();
  });
});

test.describe('move and delete', () => {
  test('moves a task into a folder', async ({ page, seed }) => {
    // Real UUID folder id: moving PATCHes folder_id, which the route validates as a UUID.
    const work = makeFolder('Work');
    await seed({
      folders: [work],
      items: [makeItem('Inbox task')],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    // Drive the Radix submenu by keyboard: synthetic pointer clicks on a nested
    // submenu item race the "safe triangle" and often don't fire onSelect. Hover
    // focuses the subtrigger; ArrowRight opens the submenu (focusing "Inbox");
    // ArrowDown moves to "Work"; Enter selects it.
    await page.getByRole('menuitem', { name: 'Move to…' }).hover();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Work' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Inbox task')).toBeHidden();

    // Navigate client-side via the sidebar link: it reads the already-reconciled
    // store, avoiding a full reload that could race the server-side PATCH persisting.
    await page.getByRole('link', { name: 'Work' }).click();
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Inbox task')).toBeVisible();
  });

  test('deletes a task', async ({ page, seed }) => {
    await seed({ items: [makeItem('Delete me', { id: 't1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Delete me')).toBeHidden();
  });
});
