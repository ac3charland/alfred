import { makeFolder, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-3 — the ⌘K navigation palette.
 *
 * ⌘K (here Ctrl/Cmd K) opens a centered command palette listing every navigation destination —
 * the modules, the cross-cutting views, every folder, every project. Typing filters across all
 * groups; picking one performs a client-side pushState to that place and closes the palette.
 * Distinct from ⌘P content search, which finds individual task/story rows.
 */

test('⌘K → filter a folder → Enter lands on that folder view', async ({ page, seed }) => {
  const folder = makeFolder('Software');
  await seed({ folders: [folder] });
  await page.goto('/');

  // The shortcut claims ⌘K from the browser and opens the palette with the input focused.
  await page.keyboard.press('ControlOrMeta+KeyK');
  const input = page.getByRole('combobox', { name: /go to a place/i });
  await expect(input).toBeFocused();

  // Empty query lists everything; typing filters to the matching folder row.
  const listbox = page.getByRole('listbox', { name: /destinations/i });
  await expect(listbox.getByText('Tasks')).toBeVisible();
  await page.keyboard.type('softw');
  await expect(listbox.getByRole('option', { name: /software/i })).toBeVisible();

  // Enter navigates to the folder view and closes the palette.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/folders/${folder.id}`));
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('⌘K → filter a project → Enter lands on the Code board', async ({ page, seed }) => {
  const project = makeProject('Alfred', { key: 'ALF' });
  await seed({ projects: [project] });
  await page.goto('/');

  await page.keyboard.press('ControlOrMeta+KeyK');
  // A project matches on its key as well as its name.
  await page.keyboard.type('alf');
  const listbox = page.getByRole('listbox', { name: /destinations/i });
  await listbox.getByRole('option', { name: /alfred/i }).click();

  await expect(page).toHaveURL(new RegExp(`/code/${project.id}`));
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('Esc closes the palette without navigating', async ({ page, seed }) => {
  await seed({ folders: [makeFolder('Software')] });
  await page.goto('/');

  await page.keyboard.press('ControlOrMeta+KeyK');
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});
