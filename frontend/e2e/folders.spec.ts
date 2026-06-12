import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Folder navigation + CRUD from the sidebar (visible at the desktop viewport),
 * plus the folder view and the "delete returns items to the Inbox" cascade.
 */

test('creates a folder from the sidebar', async ({ page, seed }) => {
  await seed({});
  await page.goto('/');

  await page.getByRole('button', { name: 'Create folder' }).click();
  await page.getByPlaceholder('Folder name…').fill('Projects');
  await page.getByRole('button', { name: 'Save folder' }).click();

  await expect(page.getByRole('link', { name: 'Projects' })).toBeVisible();
});

test('navigates to a folder and shows its scoped tasks', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Work', { id: 'f1' })],
    items: [
      makeItem('Folder task', { id: 't1', folder_id: 'f1' }),
      makeItem('Inbox task', { id: 't2' }),
    ],
  });
  await page.goto('/');

  await page.getByRole('link', { name: 'Work' }).click();

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Folder task')).toBeVisible();
  await expect(tasks.getByText('Inbox task')).toBeHidden();
});

test('renames a folder', async ({ page, seed }) => {
  await seed({ folders: [makeFolder('Old name', { id: 'f1' })] });
  await page.goto('/');

  await page.getByRole('button', { name: 'Rename Old name' }).click();
  // Scope to the sidebar nav — the inbox capture box is also a textbox.
  const input = page.getByRole('navigation', { name: 'Navigation' }).getByRole('textbox');
  await input.fill('New name');
  await page.getByRole('button', { name: 'Save rename' }).click();

  await expect(page.getByRole('link', { name: 'New name' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Old name' })).toBeHidden();
});

test('deleting a folder returns its tasks to the Inbox', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Temporary', { id: 'f1' })],
    items: [makeItem('Homeless task', { id: 't1', folder_id: 'f1' })],
  });
  await page.goto('/');

  // Deleting a folder doesn't re-parent its items in the client store (they keep a
  // dangling folder_id until a re-fetch), so this assertion needs a full reload — and
  // the reload must come AFTER the server DELETE lands, or it reads stale folder_ids.
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/folders/') && response.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Delete Temporary' }).click();
  await deleted;
  await expect(page.getByRole('link', { name: 'Temporary' })).toBeHidden();

  await page.goto('/?view=inbox');
  await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Homeless task')).toBeVisible();
});
