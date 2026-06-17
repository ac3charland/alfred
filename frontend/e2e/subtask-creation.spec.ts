/**
 * Subtask creation — end-to-end coverage for ALF-29.
 *
 * Verifies that adding a subtask under a classified task:
 *   1. Succeeds (no constraint violation or 500).
 *   2. Persists the child as item_type='task' (the DB requires it).
 *   3. Renders the new row nested under its parent.
 *
 * The DB constraint `items_task_only_fields` rejects any row where
 * parent_id is non-null and item_type is not 'task'. This test catches a
 * regression to that path by inspecting the mock backend's stored state.
 */
import { MOCK_URL, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

function makeTask(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

test('adding a subtask creates it as item_type=task and shows it nested under the parent', async ({
  page,
  seed,
  request,
}) => {
  await seed({ items: [makeTask('Plan the trip')] });
  await page.goto('/?view=inbox');

  await page.getByRole('button', { name: 'Add subtask' }).click();
  const subtaskBox = page.getByPlaceholder('Add subtask…');
  await subtaskBox.fill('Book flights');
  await subtaskBox.press('Enter');

  // The subtask must appear nested under the parent task.
  await expect(
    page.getByRole('list', { name: 'Subtasks' }).getByText('Book flights'),
  ).toBeVisible();

  // The persisted row must have item_type='task', not 'unclassified'.
  // (An 'unclassified' row with a parent_id violates `items_task_only_fields`
  // in the real Supabase — this assertion catches any regression to that.)
  const stateResponse = await request.get(`${MOCK_URL}/__mock__/state`);
  const { items: storedItems } = (await stateResponse.json()) as {
    items: { title: string; item_type: string; parent_id: string | null }[];
  };
  const subtask = storedItems.find((i) => i.title === 'Book flights');
  expect(subtask?.item_type).toBe('task');
  expect(subtask?.parent_id).not.toBeNull();
});
