import { makeCommAccount, makeCommMessage, makeFolder, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Comms module's shell: its four routes, its sidebar, and its place in the module switcher.
 *
 * Proven end-to-end rather than in jsdom because the point is that a THIRD module resolves
 * correctly through the whole stack — the shared shell layout seeds it, `ModuleRouter` derives
 * it from the URL, and a switcher tap moves between modules with no reload.
 */

const FOLDER = makeFolder('Errands', { id: '55555555-5555-4555-8555-555555555555' });
const PROJECT = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const ACCOUNT = makeCommAccount('personal', { id: '22222222-2222-4222-8222-222222222222' });

test.describe('the Comms module shell', () => {
  test('opens on the queue, with its empty state naming the FYI shelf', async ({ page, seed }) => {
    await seed({ commAccounts: [ACCOUNT] });
    await page.goto('/comms');

    await expect(page.getByRole('heading', { level: 2, name: 'Comms' })).toBeVisible();
    await expect(page.getByText('Nothing to answer.')).toBeVisible();
    await expect(
      page.getByText(
        'Messages that ask something of you will queue here. Everything else lands on the FYI shelf.',
      ),
    ).toBeVisible();
  });

  test('badges the Queue link with the count of messages waiting for a reply', async ({
    page,
    seed,
  }) => {
    await seed({
      commAccounts: [ACCOUNT],
      commMessages: [
        makeCommMessage(ACCOUNT.id, { tier: 'asap', judged_by: 'model' }),
        makeCommMessage(ACCOUNT.id, { tier: 'today', judged_by: 'model' }),
        // On the shelf, so uncounted — the badge answers "what do I owe a reply to?".
        makeCommMessage(ACCOUNT.id, { tier: 'fyi', judged_by: 'model' }),
      ],
    });
    await page.goto('/comms');

    const nav = page.getByRole('navigation', { name: 'Comms' });
    await expect(nav.getByLabel('2 waiting for a reply')).toHaveText('2');
  });

  test('hides the Queue badge when nothing is owed — the resting state', async ({ page, seed }) => {
    await seed({ commAccounts: [ACCOUNT] });
    await page.goto('/comms');

    const nav = page.getByRole('navigation', { name: 'Comms' });
    await expect(nav.getByRole('link', { name: 'Queue' })).toBeVisible();
    await expect(nav.getByLabel(/waiting for a reply/)).toHaveCount(0);
  });

  test('reaches People, Rubric and Examples from the sidebar without a reload', async ({
    page,
    seed,
  }) => {
    await seed({ commAccounts: [ACCOUNT] });
    await page.goto('/comms');

    const nav = page.getByRole('navigation', { name: 'Comms' });

    await nav.getByRole('link', { name: 'People' }).click();
    await expect(page).toHaveURL(/\/comms\/people$/);
    await expect(page.getByRole('heading', { level: 2, name: 'People' })).toBeVisible();

    await nav.getByRole('link', { name: 'Rubric' }).click();
    await expect(page).toHaveURL(/\/comms\/rubric$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Rubric' })).toBeVisible();

    await nav.getByRole('link', { name: 'Examples' }).click();
    await expect(page).toHaveURL(/\/comms\/examples$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Examples' })).toBeVisible();
  });

  test('server-renders each settings route on a hard load', async ({ page, seed }) => {
    await seed({ commAccounts: [ACCOUNT] });

    await page.goto('/comms/rubric');
    await expect(page.getByRole('heading', { level: 2, name: 'Rubric' })).toBeVisible();

    await page.goto('/comms/examples');
    await expect(page.getByRole('heading', { level: 2, name: 'Examples' })).toBeVisible();
  });

  test('switches between all three modules from the switcher', async ({ page, seed }) => {
    await seed({ folders: [FOLDER], projects: [PROJECT], commAccounts: [ACCOUNT] });
    await page.goto('/priority');

    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link', { name: 'Tasks' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await switcher.getByRole('link', { name: 'Comms' }).click();
    await expect(page).toHaveURL(/\/comms$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Comms' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Comms' })).toBeVisible();
    await expect(switcher.getByRole('link', { name: 'Comms' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await switcher.getByRole('link', { name: 'Code' }).click();
    await expect(page).toHaveURL(/\/code$/);
    await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();

    await switcher.getByRole('link', { name: 'Tasks' }).click();
    await expect(page).toHaveURL(/\/priority$/);
    await expect(page.getByRole('navigation', { name: 'Navigation' })).toBeVisible();
  });

  test('reaches the Comms surfaces from the command palette', async ({ page, seed }) => {
    await seed({ commAccounts: [ACCOUNT] });
    await page.goto('/priority');

    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Go to a place' }).fill('rubric');
    await page.getByRole('option', { name: 'Rubric' }).click();

    await expect(page).toHaveURL(/\/comms\/rubric$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Rubric' })).toBeVisible();
  });
});
