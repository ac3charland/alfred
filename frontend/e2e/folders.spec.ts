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
  // Real UUID id: renaming PATCHes the folder by id, which the route validates as a UUID
  // (a readable id would 400 → roll back).
  await seed({ folders: [makeFolder('Old name')] });
  await page.goto('/');

  await page.getByRole('link', { name: 'Old name' }).hover();
  await page.getByRole('button', { name: 'Options for Old name' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  // Scope to the sidebar nav — the inbox capture box is also a textbox.
  const input = page.getByRole('navigation', { name: 'Navigation' }).getByRole('textbox');
  await input.fill('New name');
  await page.getByRole('button', { name: 'Save rename' }).click();

  await expect(page.getByRole('link', { name: 'New name' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Old name' })).toBeHidden();
});

test('deleting a folder returns its tasks to the Inbox', async ({ page, seed }) => {
  // Real UUID id: deleting DELETEs the folder by id, which the route validates as a UUID
  // (a readable id would 400 → roll back). The item references it via folder_id.
  const folder = makeFolder('Temporary');
  await seed({
    folders: [folder],
    items: [makeItem('Homeless task', { folder_id: folder.id })],
  });
  await page.goto('/');

  // Deleting a folder doesn't re-parent its items in the client store (they keep a
  // dangling folder_id until a re-fetch), so this assertion needs a full reload — and
  // the reload must come AFTER the server DELETE lands, or it reads stale folder_ids.
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes('/api/folders/') && response.request().method() === 'DELETE',
  );
  await page.getByRole('link', { name: 'Temporary' }).hover();
  await page.getByRole('button', { name: 'Options for Temporary' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await deleted;
  await expect(page.getByRole('link', { name: 'Temporary' })).toBeHidden();

  await page.goto('/?view=inbox');
  await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Homeless task')).toBeVisible();
});

test('describes a folder from its view header, and clears the description again', async ({
  page,
  seed,
}) => {
  // Real UUID id: the description PATCHes the folder by id, which the route validates as a
  // UUID (a readable id would 400 → roll back).
  const folder = makeFolder('Health');
  await seed({ folders: [folder] });
  await page.goto(`/folders/${folder.id}`);

  // The placeholder is the entire discovery path — there is no menu entry and no button.
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/folders/') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Add folder description…' }).click();
  await page
    .getByRole('textbox', { name: 'Edit folder description' })
    .fill('Doctors, dentist, prescriptions, the gym.');
  await page.getByRole('button', { name: 'Save' }).click();
  await saved;
  await expect(
    page.getByRole('button', { name: 'Doctors, dentist, prescriptions, the gym.' }),
  ).toBeVisible();

  // It is a column, not client state: a full reload reads it back from the server.
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Doctors, dentist, prescriptions, the gym.' }),
  ).toBeVisible();

  // Emptying it returns the folder to the placeholder (the column is null, not '').
  const cleared = page.waitForResponse(
    (response) =>
      response.url().includes('/api/folders/') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Doctors, dentist, prescriptions, the gym.' }).click();
  await page.getByRole('textbox', { name: 'Edit folder description' }).fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await cleared;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add folder description…' })).toBeVisible();
});
