import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Inbox + capture: the landing screen, revealing the list, capturing items, and
 * completing a leaf task (which moves it to the Completed view).
 */

test('inbox reveals seeded active items', async ({ page, seed }) => {
  await seed({ items: [makeItem('Buy milk'), makeItem('Call the dentist')] });

  await page.goto('/?view=inbox');

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Buy milk')).toBeVisible();
  await expect(tasks.getByText('Call the dentist')).toBeVisible();
});

test('the inbox header counts the items waiting, and keeps up with a capture', async ({
  page,
  seed,
}) => {
  await seed({ items: [makeItem('Buy milk'), makeItem('Call the dentist')] });

  await page.goto('/?view=inbox');

  const header = page.getByText(/^Inbox( \(\d+\))?$/);
  await expect(header).toHaveText('Inbox (2)');

  // The tally is live: a captured thought lands in the list and the header follows it up.
  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill('Water the plants');
  await box.press('Enter');

  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Water the plants'),
  ).toBeVisible();
  await expect(header).toHaveText('Inbox (3)');
});

test('the inbox header drops the tally when there is nothing waiting', async ({ page, seed }) => {
  await seed({});

  await page.goto('/?view=inbox');

  // No "(0)": an empty inbox says so in its own empty state.
  await expect(page.getByText(/^Inbox( \(\d+\))?$/)).toHaveText('Inbox');
  await expect(page.getByText('Your inbox is empty')).toBeVisible();
});

test('the landing screen reveals and closes the inbox list', async ({ page, seed }) => {
  await seed({ items: [makeItem('Existing thought')] });

  await page.goto('/');

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks).toBeHidden();

  await page.getByRole('link', { name: 'View inbox' }).click();
  await expect(tasks.getByText('Existing thought')).toBeVisible();

  await page.getByRole('link', { name: 'Close inbox' }).click();
  await expect(tasks).toBeHidden();
});

test('capturing a thought adds it to the inbox', async ({ page, seed }) => {
  await seed({});

  await page.goto('/?view=inbox');

  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill('Write the quarterly report');
  await box.press('Enter');

  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Write the quarterly report'),
  ).toBeVisible();
  // The box clears, ready for the next thought.
  await expect(box).toHaveValue('');
});

test('completing a leaf task moves it to the Completed view', async ({ page, seed }) => {
  // Completion is task-only, so this fixture must be classified as a task to show
  // the checkbox; `makeItem`'s default `unclassified` would render no checkbox.
  // Real UUID id: completing PATCHes the row by id, which the route validates as a UUID
  // (a readable id would 400 → roll back).
  await seed({ items: [makeItem('Take out the trash', { item_type: 'task' })] });

  await page.goto('/?view=inbox');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Take out the trash')).toBeVisible();

  await page.getByRole('button', { name: 'Mark "Take out the trash" complete' }).click();
  await expect(tasks.getByText('Take out the trash')).toBeHidden();

  // Client-side nav reads the reconciled store (the task is now status=completed),
  // so no full reload that could race the server write.
  await page.getByRole('link', { name: 'Completed' }).click();
  await expect(page.getByText('Take out the trash')).toBeVisible();
});
