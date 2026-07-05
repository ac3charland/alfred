import { makeEpic, makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The whole tasks module is seeded once (folders + all items) into client stores at
 * the layout, and every view is derived from that store. Switching views must
 * therefore be a pure client-side URL change — no document reload and no RSC payload
 * fetch — so navigating between a folder / completed feels instant.
 *
 * These guard that: a server round-trip on a view switch (the regression we fixed)
 * would either reload the document or fetch an `?_rsc=` payload, and would wipe the
 * in-memory marker we plant. (The Inbox nav link was removed — the wordmark and a
 * `?view=inbox` deep link still reach the inbox; the cross-view switch is covered here via
 * Folders + Completed, which are the remaining sidebar links.)
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
  // Open the inbox via the deep link (the wordmark reaches the landing/capture screen).
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

  // Completed → folder.
  await page.getByRole('link', { name: 'Work' }).click();
  await expect(page).toHaveURL('/folders/f1');
  await expect(tasks.getByText('Work thing')).toBeVisible();

  // No round-trip fired on any switch (a real one would have been recorded before its
  // view rendered), and the in-memory marker survived (the document never reloaded).
  expect(roundTrips).toEqual([]);
  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);
});

/**
 * Cross-MODULE switching (ALF-27). Both modules are now seeded once under a shared shell
 * layout, so the Tasks ⇄ Code switcher is a History-API change, not an RSC navigation —
 * switching modules must be as instant and server-free as switching views, with the URL,
 * main content, sidebar nav, and switcher highlight all following the new module.
 */
const crossModuleSeed = {
  folders: [makeFolder('Work', { id: 'f1' })],
  items: [makeItem('Inbox thought', { id: 't1' })],
  projects: [makeProject('Alfred', { id: 'p1', key: 'ALF' })],
  epics: [makeEpic('Core', { id: 'e1', project_id: 'p1' })],
};

test('switches Tasks ⇄ Code client-side, with no document reload or RSC round-trip', async ({
  page,
  seed,
}) => {
  await seed(crossModuleSeed);
  await page.goto('/?view=inbox');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Inbox thought')).toBeVisible();
  // The Tasks sidebar nav is mounted.
  await expect(page.getByRole('link', { name: 'Completed' })).toBeVisible();

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

  // Tasks → Code: URL, main content, sidebar, and switcher highlight all flip to Code.
  await page.getByRole('link', { name: 'Code' }).click();
  await expect(page).toHaveURL('/code');
  await expect(page.getByText('The Software Factory')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Projects' }).getByRole('link', { name: /alfred/i }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Code' })).toHaveAttribute('aria-current', 'page');
  // The Tasks-only sidebar link is gone.
  await expect(page.getByRole('link', { name: 'Completed' })).toBeHidden();

  // Code → Tasks: back to the module's default By-Priority view, tasks nav, Tasks highlighted.
  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL('/priority');
  await expect(page.getByRole('link', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');

  // No round-trip fired on either module switch, and the in-memory marker survived.
  expect(roundTrips).toEqual([]);
  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);
});

test('keeps browser back/forward working across a module switch', async ({ page, seed }) => {
  await seed(crossModuleSeed);
  await page.goto('/?view=inbox');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Inbox thought')).toBeVisible();

  // Tasks → Code (client-side), then walk history back to Tasks and forward again.
  await page.getByRole('link', { name: 'Code' }).click();
  await expect(page).toHaveURL('/code');
  await expect(page.getByText('The Software Factory')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/?view=inbox');
  await expect(tasks.getByText('Inbox thought')).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL('/code');
  await expect(page.getByText('The Software Factory')).toBeVisible();
});

test('keeps deep links and browser back/forward working across views', async ({ page, seed }) => {
  await seed(seedWorkspace);

  // A folder path is a real, shareable URL: loading it directly shows the folder.
  await page.goto('/folders/f1');
  const tasks = page.getByRole('list', { name: 'Tasks' });
  // The folder eyebrow (scoped to main so it doesn't also match the sidebar link).
  await expect(page.getByRole('main').getByText('Work', { exact: true })).toBeVisible();
  await expect(tasks.getByText('Work thing')).toBeVisible();

  // Switch to Completed client-side, then walk history back to the folder and forward again.
  await page.getByRole('link', { name: 'Completed' }).click();
  await expect(page).toHaveURL('/completed');
  await expect(tasks.getByText('Done thing')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL('/folders/f1');
  await expect(tasks.getByText('Work thing')).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL('/completed');
  await expect(tasks.getByText('Done thing')).toBeVisible();
});
