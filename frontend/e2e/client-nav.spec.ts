import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The whole tasks module is seeded once (folders + all items) into client stores at
 * the layout, and every view is derived from that store. Switching views must
 * therefore be a pure client-side URL change — no document reload and no RSC payload
 * fetch — so navigating between inbox / a folder / completed feels instant.
 *
 * These guard that: a server round-trip on a view switch (the regression we fixed)
 * would either reload the document or fetch an `?_rsc=` payload, and would wipe the
 * in-memory marker we plant.
 */

/** The marker we plant on the page's global to detect a document reload. */
interface MarkerWindow {
  __survivedNav?: boolean;
}

const seedWorkspace = {
  folders: [makeFolder('Work', { id: 'f1' })],
  items: [
    makeItem('Inbox thought', { id: 't1' }),
    makeItem('Work thing', { id: 't2', folder_id: 'f1' }),
    makeItem('Done thing', { id: 't3', status: 'completed' }),
  ],
};

test('switches views client-side, with no document reload or RSC round-trip', async ({
  page,
  seed,
}) => {
  await seed(seedWorkspace);
  await page.goto('/?view=inbox');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Inbox thought')).toBeVisible();

  // A value in client memory only survives if the document is never reloaded.
  await page.evaluate(() => {
    (globalThis as MarkerWindow).__survivedNav = true;
  });

  // Record any server round-trips from here on: a full document load or an RSC fetch.
  const roundTrips: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document' || request.url().includes('_rsc')) {
      roundTrips.push(request.url());
    }
  });

  // Inbox → folder.
  await page.getByRole('link', { name: 'Work' }).click();
  await expect(page).toHaveURL('/folders/f1');
  await expect(tasks.getByText('Work thing')).toBeVisible();
  await expect(tasks.getByText('Inbox thought')).toBeHidden();

  // Folder → completed.
  await page.getByRole('link', { name: 'Completed' }).click();
  await expect(page).toHaveURL('/completed');
  await expect(tasks.getByText('Done thing')).toBeVisible();

  // Completed → inbox.
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL('/?view=inbox');
  await expect(tasks.getByText('Inbox thought')).toBeVisible();

  // No round-trip fired on any switch (a real one would have been recorded before its
  // view rendered), and the in-memory marker survived (the document never reloaded).
  expect(roundTrips).toEqual([]);
  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);
});

test('keeps deep links and browser back/forward working across views', async ({ page, seed }) => {
  await seed(seedWorkspace);

  // A folder path is a real, shareable URL: loading it directly shows the folder.
  await page.goto('/folders/f1');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  // The folder eyebrow (scoped to main so it doesn't also match the sidebar link).
  await expect(page.getByRole('main').getByText('Work', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Work thing')).toBeVisible();

  // Switch to the inbox client-side, then walk history back to the folder and forward again.
  await page.getByRole('link', { name: 'Inbox' }).click();
  await expect(page).toHaveURL('/?view=inbox');
  await expect(tasks.getByText('Inbox thought')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/folders/f1');
  await expect(tasks.getByText('Work thing')).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL('/?view=inbox');
  await expect(tasks.getByText('Inbox thought')).toBeVisible();
});
