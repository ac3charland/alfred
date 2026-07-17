/**
 * Subtask reordering — end-to-end coverage for ALF-117.
 *
 * A subtask group defaults to creation order and can be rearranged: the deterministic path is the
 * "Move up" / "Move down" menu actions (keyboard/screen-reader friendly); a pointer drag into the
 * gap between siblings is the spatial path. Both persist to `sort_order` and survive a reload.
 *
 * Per the dnd-kit skill, the menu actions are the reliable assertion target (jsdom can't drive a
 * real drag, and even in Chromium a spatial drop is flakier); the pointer spec waits on a gap's
 * `data-drop-over` marker before releasing.
 */
import { makeItem } from './support/constants';
import { boxOf, pickUp } from './support/drag';
import { expect, test } from './support/fixtures';

function makeTask(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

/** Seed a parent task with three active subtasks, in creation order. */
async function seedGroup(seed: (state: { items: ReturnType<typeof makeItem>[] }) => Promise<void>) {
  const parent = makeTask('Ship release');
  await seed({
    items: [
      parent,
      makeTask('Draft changelog', { parent_id: parent.id }),
      makeTask('Tag the commit', { parent_id: parent.id }),
      makeTask('Publish notes', { parent_id: parent.id }),
    ],
  });
}

test('reorders a subtask with the Move up / Move down menu actions, persisting across reload', async ({
  page,
  seed,
}) => {
  await seedGroup(seed);
  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Expand subtasks' }).click();

  const subtasks = page.getByRole('list', { name: 'Subtasks' });
  const rows = subtasks.getByRole('listitem');
  await expect(rows).toHaveText([/Draft changelog/, /Tag the commit/, /Publish notes/]);

  // Move the last subtask up one slot → it swaps past "Tag the commit".
  await rows
    .filter({ hasText: 'Publish notes' })
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(rows).toHaveText([/Draft changelog/, /Publish notes/, /Tag the commit/]);

  // Move the (now) first subtask down one slot → it swaps past "Publish notes".
  await rows
    .filter({ hasText: 'Draft changelog' })
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(rows).toHaveText([/Publish notes/, /Draft changelog/, /Tag the commit/]);

  // The manual order persists across a reload (it's stored in sort_order, not client state).
  await page.reload();
  await page.getByRole('button', { name: 'Expand subtasks' }).click();
  await expect(rows).toHaveText([/Publish notes/, /Draft changelog/, /Tag the commit/]);
});

test('hides Move up on the first subtask and Move down on the last', async ({ page, seed }) => {
  await seedGroup(seed);
  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Expand subtasks' }).click();

  const rows = page.getByRole('list', { name: 'Subtasks' }).getByRole('listitem');

  // First subtask: no "Move up".
  await rows
    .filter({ hasText: 'Draft changelog' })
    .getByRole('button', { name: 'More actions' })
    .click();
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Last subtask: no "Move down".
  await rows
    .filter({ hasText: 'Publish notes' })
    .getByRole('button', { name: 'More actions' })
    .click();
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeVisible();
});

test('drags a subtask into the gap above the first sibling to move it to the top', async ({
  page,
  seed,
}) => {
  await seedGroup(seed);
  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Expand subtasks' }).click();

  const subtasks = page.getByRole('list', { name: 'Subtasks' });
  const rows = subtasks.getByRole('listitem');
  await expect(rows).toHaveText([/Draft changelog/, /Tag the commit/, /Publish notes/]);

  // Capture the top boundary BEFORE dragging (the DragOverlay clones the dragged title mid-drag).
  const firstBox = await boxOf(rows.filter({ hasText: 'Draft changelog' }));
  await pickUp(page, rows.filter({ hasText: 'Publish notes' }));
  // Glide onto the top gap (straddling the first row's top edge) and wait for it to light up.
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + 2, { steps: 12 });
  await expect(page.locator('[data-reorder-gap][data-drop-over="true"]')).toBeVisible();
  await page.mouse.up();

  await expect(rows).toHaveText([/Publish notes/, /Draft changelog/, /Tag the commit/]);
});
