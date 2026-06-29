import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Task row interactions: subtasks, cascade completion, inline editing (title, due
 * date, notes), moving between folders, and deletion. All run in the inbox view
 * against the seeded mock backend.
 *
 * Every fixture here is a `task`: completion, due dates and subtasks are task-only
 * affordances now, so these rows must be classified as tasks to expose them.
 * `makeItem`'s default `unclassified` would render a bare row with none of them.
 */
type MakeItemOverrides = Parameters<typeof makeItem>[1];
function makeTask(title: string, overrides: MakeItemOverrides = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

test.describe('subtasks', () => {
  test('adds a subtask inline and shows it nested under the parent', async ({ page, seed }) => {
    // Real UUID id: the new subtask is created via POST with parent_id = this id,
    // and the route validates parent_id as a UUID (a readable id would 400 → roll back).
    await seed({ items: [makeTask('Plan the trip')] });
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
        makeTask('Parent task', { id: 'p1' }),
        makeTask('Hidden child', { id: 'c1', parent_id: 'p1' }),
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
    // Real UUID ids: unchecking the child PATCHes it by id, which the route validates
    // as a UUID (a readable id would 400 → roll back).
    const parent = makeTask('Plan the launch');
    await seed({
      items: [
        parent,
        makeTask('Draft the brief', {
          parent_id: parent.id,
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
    // Real UUID ids: the cascade PATCHes both rows by id, which the route validates as
    // UUIDs (a readable id would 400 → roll back).
    const parent = makeTask('Ship feature');
    await seed({
      items: [parent, makeTask('Write code', { parent_id: parent.id })],
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
        makeTask('Keep me', { id: 'p1' }),
        makeTask('My child', { id: 'c1', parent_id: 'p1' }),
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
    // Real UUID id: completing the leaf PATCHes it by id, which the route validates as a
    // UUID (a readable id would 400 → roll back).
    await seed({ items: [makeTask('Buy milk')] });
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

// These tests omit the seed `id`, so `makeTask` mints a real UUID: each inline edit
// PATCHes the row by id, which the route validates as a UUID (a readable id would 400 →
// roll back, reverting the optimistic update).
test.describe('inline editing', () => {
  test('edits a task title via double-click', async ({ page, seed }) => {
    await seed({ items: [makeTask('Original title')] });
    await page.goto('/?view=inbox');

    await page.getByText('Original title').dblclick();
    const input = page.getByRole('textbox', { name: 'Edit title' });
    await input.fill('Updated title');
    await input.press('Enter');

    const tasks = page.getByRole('list', { name: 'Tasks' });
    await expect(tasks.getByText('Updated title')).toBeVisible();
    await expect(tasks.getByText('Original title')).toBeHidden();
  });

  test('typing a space while editing a title keeps the editor open (no phantom keyboard drag)', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeTask('Original title')] });
    await page.goto('/?view=inbox');

    await page.getByText('Original title').dblclick();
    const input = page.getByRole('textbox', { name: 'Edit title' });

    // Type key-by-key so the Space fires a real keydown — the one that used to bubble to
    // the row's drag listeners and start a phantom keyboard drag, swallowing the space and
    // collapsing the editor. pressSequentially (not fill) is what exercises the bug.
    await input.fill('');
    await input.pressSequentially('two words');

    // The space survived — it was typed, not consumed by a drag activation — and the
    // editor is still open.
    await expect(input).toHaveValue('two words');
    await expect(input).toBeVisible();

    // Saving persists the spaced title, and double-click still re-opens the editor on that
    // same item (the drag never hijacked it).
    await input.press('Enter');
    const tasks = page.getByRole('list', { name: 'Tasks' });
    await expect(tasks.getByText('two words')).toBeVisible();

    await tasks.getByText('two words').dblclick();
    await expect(page.getByRole('textbox', { name: 'Edit title' })).toBeVisible();
  });

  test('sets a due date from the detail panel calendar (auto-save)', async ({ page, seed }) => {
    await seed({ items: [makeTask('Schedule review')] });
    await page.goto('/?view=inbox');

    // Open details → the Due chip → pick "Today" from the calendar. The pick auto-saves and
    // closes the popover, so the row's due badge appears with no Save step.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Open details' }).click();
    await page.getByRole('button', { name: 'Due date', exact: true }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Due date:', exact: false })).toBeVisible();
  });

  test('adds notes from the detail panel (auto-saves on blur)', async ({ page, seed }) => {
    await seed({ items: [makeTask('Research options')] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Open details' }).click();

    const notes = page.getByRole('textbox', { name: 'Notes' });
    await notes.fill('Compare three vendors first');
    await notes.blur();

    // The saved notes surface as the row's one-line preview span (distinct from the textarea).
    await expect(
      page.locator('span').filter({ hasText: 'Compare three vendors first' }),
    ).toBeVisible();
  });
});

test.describe('move and delete', () => {
  test('moves a task into a folder', async ({ page, seed }) => {
    // Real UUID folder id: moving PATCHes folder_id, which the route validates as a UUID.
    const work = makeFolder('Work');
    await seed({
      folders: [work],
      items: [makeTask('Inbox task')],
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
    await seed({ items: [makeTask('Delete me')] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Delete me')).toBeHidden();
  });
});

test.describe('single active inline input across rows', () => {
  // Only one inline input may be open at a time across every row: the title-edit text
  // box and the add-subtask entry box are mutually exclusive. (The Inbox hero capture
  // box is exempt and always available.)

  test('opening a subtask entry box on one row closes another row’s', async ({ page, seed }) => {
    await seed({
      items: [makeTask('Alpha task', { id: 'a1' }), makeTask('Beta task', { id: 'b1' })],
    });
    await page.goto('/?view=inbox');

    const alpha = page.getByRole('listitem').filter({ hasText: 'Alpha task' });
    const beta = page.getByRole('listitem').filter({ hasText: 'Beta task' });

    await alpha.getByRole('button', { name: 'Add subtask' }).click();
    await expect(alpha.getByPlaceholder(/add subtask/i)).toBeVisible();

    await beta.getByRole('button', { name: 'Add subtask' }).click();
    await expect(beta.getByPlaceholder(/add subtask/i)).toBeVisible();
    // The first row's entry box closed when the second opened.
    await expect(alpha.getByPlaceholder(/add subtask/i)).toBeHidden();
  });

  test('editing one title is abandoned without saving when another is double-clicked', async ({
    page,
    seed,
  }) => {
    await seed({
      items: [makeTask('Alpha task', { id: 'a1' }), makeTask('Beta task', { id: 'b1' })],
    });
    await page.goto('/?view=inbox');

    await page.getByText('Alpha task').dblclick();
    await page.getByRole('textbox', { name: 'Edit title' }).fill('Alpha edited');

    // Double-click the other item — the first edit is abandoned, the second activates.
    await page.getByText('Beta task').dblclick();

    const editInputs = page.getByRole('textbox', { name: 'Edit title' });
    await expect(editInputs).toHaveCount(1);
    await expect(editInputs).toHaveValue('Beta task');

    // The first row reverted to its saved title; the unsaved change never persisted.
    const tasks = page.getByRole('list', { name: 'Tasks' });
    await expect(tasks.getByText('Alpha task')).toBeVisible();
    await expect(tasks.getByText('Alpha edited')).toBeHidden();
  });
});
