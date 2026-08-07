/**
 * Capturing a task straight into the folder you're looking at.
 *
 * The folder header's "+" reveals a compact capture box scoped to that folder. What the
 * unit tests can't prove is the persisted shape: a capture made in a folder must be stored
 * as `item_type: 'task'` (not 'unclassified'), carrying the folder and no parent — otherwise
 * the row renders with no completion checkbox and can never be ticked off.
 *
 * The folders are seeded with REAL UUID ids (the builder's default): the create route
 * validates `folder_id` as a UUID, so a readable id would 400 and roll the capture back.
 */
import { MOCK_URL, makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

interface StoredItem {
  title: string;
  item_type: string;
  folder_id: string | null;
  parent_id: string | null;
}

test('captures a task into the folder being viewed, as a completable task', async ({
  page,
  seed,
  request,
}) => {
  const work = makeFolder('Work');
  await seed({
    folders: [work],
    items: [makeItem('Ship the Q3 deck', { item_type: 'task', folder_id: work.id })],
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Work' }).click();

  await page.getByRole('button', { name: 'Add task to Work' }).click();
  const captureBox = page.getByPlaceholder('Add task…');
  await captureBox.fill('Call the vendor back');
  await captureBox.press('Enter');

  // The row joins the folder's list immediately, and it carries a completion checkbox —
  // the user-visible proof that it was created as a task, not an unclassified row.
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Call the vendor back')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Mark "Call the vendor back" complete' }),
  ).toBeVisible();

  // The box clears and stays open, so the next thought can be typed straight away.
  await expect(captureBox).toHaveValue('');
  await expect(captureBox).toBeFocused();

  const stateResponse = await request.get(`${MOCK_URL}/__mock__/state`);
  const { items: storedItems } = (await stateResponse.json()) as { items: StoredItem[] };
  const stored = storedItems.find((item) => item.title === 'Call the vendor back');
  expect(stored?.item_type).toBe('task');
  expect(stored?.folder_id).toBe(work.id);
  expect(stored?.parent_id).toBeNull();

  // It was filed, not captured to the Inbox.
  await page.goto('/?view=inbox');
  await expect(page.getByText('Call the vendor back')).toBeHidden();
});

test('an empty folder offers its own "Add task" way in', async ({ page, seed }) => {
  await seed({ folders: [makeFolder('Someday')] });
  await page.goto('/');
  await page.getByRole('link', { name: 'Someday' }).click();

  // The empty state names the folder and points at the action, never "Capture something above."
  await expect(page.getByText('No tasks in Someday')).toBeVisible();
  await expect(page.getByText('Add your first task to this folder.')).toBeVisible();
  await expect(page.getByText('Capture something above.')).toBeHidden();

  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const captureBox = page.getByPlaceholder('Add task…');
  await captureBox.fill('Water the plants');
  await captureBox.press('Enter');

  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Water the plants'),
  ).toBeVisible();
  await expect(page.getByText('No tasks in Someday')).toBeHidden();
});
