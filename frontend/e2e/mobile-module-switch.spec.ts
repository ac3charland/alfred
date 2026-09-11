import { makeCommAccount, makeFolder, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Switching module from inside the mobile hamburger keeps the drawer open (ALF-157). The
 * drawer used to close on a switcher tap, which dumped the user back on the board and made
 * them re-open the menu just to reach the other module's nav — two extra taps for what reads
 * as one continuous "browse the menu" gesture.
 *
 * Proven in a real browser: the hamburger only exists below `md:`, a breakpoint jsdom never
 * resolves, so this is where "the drawer the user actually sees stayed open" can be asserted.
 */

const FOLDER = makeFolder('Errands', { id: '55555555-5555-4555-8555-555555555555' });
const PROJECT = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const ACCOUNT = makeCommAccount('personal', { id: '22222222-2222-4222-8222-222222222222' });

test.describe('at a phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps the hamburger open across a module switch, swapping in the other nav', async ({
    page,
    seed,
  }) => {
    await seed({ folders: [FOLDER], projects: [PROJECT], commAccounts: [ACCOUNT] });
    await page.goto('/priority');

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('navigation', { name: 'Navigation' })).toBeVisible();

    // All three modules are reachable from inside the drawer.
    const switcher = drawer.getByRole('group', { name: 'Switch module' });
    await expect(switcher.getByRole('link')).toHaveCount(3);

    // Comms swaps in without closing the drawer, exactly as Code does.
    await switcher.getByRole('link', { name: 'Comms' }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Comms' })).toBeVisible();

    await drawer.getByRole('link', { name: 'Code' }).click();

    // Still open, now showing the Code module's project list — the user carries straight on
    // into a project without re-opening the menu.
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('navigation', { name: 'Projects' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Alfred' })).toBeVisible();

    // And picking a destination inside that nav still closes it, landing on the board.
    await drawer.getByRole('link', { name: 'Alfred' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/code\/11111111-1111-4111-8111-111111111111$/);
  });
});
