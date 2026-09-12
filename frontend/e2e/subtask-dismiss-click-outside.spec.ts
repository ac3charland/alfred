/**
 * Subtask entry click-outside dismiss — end-to-end coverage for ALF-127.
 *
 * The inline "Add subtask" field already tears down as soon as it loses focus
 * (jsdom can't replicate a real browser's default focus-shift on a plain outside
 * click, so this real-browser test is what proves it), discarding any unsaved text
 * — the same outcome as the Escape-key dismiss (ALF-66).
 */
import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

test('clicking outside the add-subtask field dismisses it without creating a subtask', async ({
  page,
  seed,
}) => {
  await seed({
    items: [
      makeItem('Plan the trip', { item_type: 'task' }),
      makeItem('Buy groceries', { item_type: 'task' }),
    ],
  });
  await page.goto('/?view=inbox');

  const planRow = page.getByRole('listitem').filter({ hasText: 'Plan the trip' });
  await planRow.getByRole('button', { name: 'Add subtask' }).click();
  const field = page.getByPlaceholder('Add subtask…');
  await field.fill('Half-typed subtask');

  // A single click on the OTHER task's title — title edit needs a double-click, so this
  // opens nothing else and is a genuine outside press.
  await page.getByText('Buy groceries').click();

  await expect(field).toHaveCount(0);
  await expect(page.getByText('Half-typed subtask')).toHaveCount(0);
});
