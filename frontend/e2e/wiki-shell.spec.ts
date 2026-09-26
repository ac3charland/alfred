import { makeCommAccount, makeFolder, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Wiki module's shell (ALF-261): its routes, its sidebar, and its place in the module
 * switcher and the command palette.
 *
 * Proven end-to-end rather than in jsdom for the same reason `reader-shell.spec.ts` is: the point
 * is that a FIFTH module resolves correctly through the whole stack — the shared shell layout
 * seeds it, `ModuleRouter` derives it from the URL, and a switcher tap moves between modules with
 * no reload. It seeds no wiki rows; the reading room's own journeys live in
 * `wiki-reading-room.spec.ts`.
 */

const FOLDER = makeFolder('Errands', { id: '66666666-6666-4666-8666-666666666666' });
const PROJECT = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const ACCOUNT = makeCommAccount('personal', { id: '33333333-3333-4333-8333-333333333333' });

test.describe('the Wiki module shell', () => {
  test('opens on the index, with its resting empty state', async ({ page, seed }) => {
    await seed({});
    await page.goto('/wiki');

    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(page.getByText('0 pages · not synced yet')).toBeVisible();
    await expect(page.getByText('Nothing synced yet')).toBeVisible();
    await expect(
      page.getByText("Pages appear here after the wiki's next push reaches Alfred."),
    ).toBeVisible();
  });

  test('lists the nav with its five links', async ({ page, seed }) => {
    await seed({});
    await page.goto('/wiki');

    const nav = page.getByRole('navigation', { name: 'Wiki' });
    await expect(nav).toBeVisible();
    for (const label of ['All pages', 'Concepts', 'Entities', 'Sources', 'Questions']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('marks Wiki current in the switcher', async ({ page, seed }) => {
    await seed({});
    await page.goto('/wiki');

    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link', { name: 'Wiki' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('reaches Concepts from the command palette', async ({ page, seed }) => {
    await seed({});
    await page.goto('/priority');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Go to a place' }).fill('Concepts');
    await page.getByRole('option', { name: 'Concepts' }).click();

    await expect(page).toHaveURL(/\/wiki\/concepts$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Wiki' }).getByRole('link', { name: 'Concepts' }),
    ).toHaveClass(/bg-secondary/);
  });

  test('server-renders a section and a page path on a hard load', async ({ page, seed }) => {
    await seed({});

    await page.goto('/wiki/concepts');
    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();

    await page.goto('/wiki/concepts/x');
    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();
    await expect(
      page.getByRole('group', { name: 'Switch module' }).getByRole('link', { name: 'Wiki' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('switches in and out of the Wiki from the switcher without a reload', async ({
    page,
    seed,
  }) => {
    await seed({ folders: [FOLDER], projects: [PROJECT], commAccounts: [ACCOUNT] });
    await page.goto('/priority');

    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link')).toHaveCount(5);

    await switcher.getByRole('link', { name: 'Wiki' }).click();
    await expect(page).toHaveURL(/\/wiki$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();
    await expect(switcher.getByRole('link', { name: 'Wiki' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await switcher.getByRole('link', { name: 'Reader' }).click();
    await expect(page).toHaveURL(/\/reader$/);
    await expect(page.getByRole('navigation', { name: 'Reader' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Comms' }).click();
    await expect(page).toHaveURL(/\/comms$/);
    await expect(page.getByRole('navigation', { name: 'Comms' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Wiki' }).click();
    await expect(page).toHaveURL(/\/wiki$/);
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/priority$/);
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
  });
});

test.describe('the Wiki module shell — phone (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('reaches the module through the drawer', async ({ page, seed }) => {
    await seed({});
    await page.goto('/priority');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Wiki' }).click();

    await expect(page).toHaveURL(/\/wiki$/);
    await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'All pages' })).toBeVisible();
  });

  test('renders the index heading and empty state on the phone', async ({ page, seed }) => {
    await seed({});
    await page.goto('/wiki');

    await expect(page.getByRole('heading', { level: 2, name: 'Wiki' })).toBeVisible();
    await expect(page.getByText('Nothing synced yet')).toBeVisible();
  });
});
