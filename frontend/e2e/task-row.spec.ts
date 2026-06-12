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

    // getByRole respects aria-hidden: when the wrapper is aria-hidden the list has 0 AT matches.
    const subtaskList = page.getByRole('list', { name: 'Subtasks' });
    await expect(subtaskList).toBeHidden();

    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(subtaskList).toBeVisible();

    await page.getByRole('button', { name: 'Collapse subtasks' }).click();
    await expect(subtaskList).toBeHidden();
  });

  test('reveals completed subtasks behind a toggle and reactivates one on uncheck', async ({
    page,
    seed,
  }) => {
    await seed({
      items: [
        makeItem('Plan the launch', { id: 'p1' }),
        makeItem('Draft the brief', {
          id: 'c1',
          parent_id: 'p1',
          status: 'completed',
          completed_at: '2025-01-02T00:00:00Z',
        }),
      ],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Expand subtasks' }).click();

    // The completed child is hidden behind the toggle until it is opened.
    const completedList = page.getByRole('list', { name: 'Completed subtasks' });
    await expect(completedList).toBeHidden();

    await page.getByRole('button', { name: 'Show completed (1)' }).click();
    await expect(completedList.getByText('Draft the brief')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide completed' })).toBeVisible();

    // Unchecking pops the child back to active; with no completed children left the
    // toggle disappears and the row offers "complete" again.
    await page.getByRole('button', { name: 'Mark "Draft the brief" active' }).click();
    await expect(page.getByRole('button', { name: /show completed/i })).toBeHidden();
    await expect(
      page.getByRole('list', { name: 'Subtasks' }).getByText('Draft the brief'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mark "Draft the brief" complete' }),
    ).toBeVisible();
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

    // Wait for the collapse exit to finish and the subtree to actually leave the list
    // (completion commits when the animation ends), not merely be clipped out of view.
    await expect(page.getByText('Ship feature')).toHaveCount(0);

    // Client-side nav reads the already-reconciled store, avoiding a full reload that
    // could race the server-side completion persisting.
    await page.getByRole('link', { name: 'Completed' }).click();
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

test.describe('completion', () => {
  test('completing a leaf task animates it out and lands it in Completed', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeItem('Buy milk', { id: 'l1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Mark "Buy milk" complete' }).click();

    // The row plays its collapse exit, then actually leaves the inbox list (completion
    // commits when the animation ends).
    await expect(page.getByText('Buy milk')).toHaveCount(0);

    // Client-side nav reads the reconciled store rather than racing the server.
    await page.getByRole('link', { name: 'Completed' }).click();
    await expect(page.getByText('Buy milk')).toBeVisible();
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
    // Wait for focus to actually land on "Work" before selecting — pressing Enter
    // back-to-back with ArrowDown can race the focus move and select "Inbox" instead.
    await expect(page.getByRole('menuitem', { name: 'Work' })).toBeFocused();
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
