import type { Locator } from '@playwright/test';

import { makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-219 — the desktop module switcher must fit inside the sidebar, and each module's
 * highlight must be its own colour. ALF-270 made the switcher icon-only and moved the open
 * module's name to the sidebar's wordmark row, so this file also proves that name reads
 * correctly and that the sidebar itself is back down to 224px.
 *
 * Proven in a real browser rather than jsdom because both halves are geometry and paint:
 * jsdom has no layout, so it can't tell a control that fits from one whose segment spills
 * across the sidebar's border into the main pane, and it resolves no Tailwind colours, so it
 * can't tell Tasks' highlight from Code's.
 */

const PROJECT = makeProject('Alfred', { id: '11111111-1111-4111-8111-111111111111', key: 'ALF' });
const SEED = {
  folders: [makeFolder('Work', { id: 'f1' })],
  items: [makeItem('A thought', { id: 't1' })],
  projects: [PROJECT],
};

/**
 * Where an element's right edge falls. A missing box reads as infinitely far right rather
 * than throwing, so an element that never laid out FAILS the fit assertion below instead of
 * slipping past it.
 */
const rightEdge = async (target: Locator) => {
  const box = await target.boundingBox();
  return (box?.x ?? 0) + (box?.width ?? Number.POSITIVE_INFINITY);
};

test.describe('the desktop module switcher', () => {
  test('is 224px wide and fits inside the sidebar instead of spilling over its border', async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/priority');

    const sidebar = page.locator('aside');
    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher).toBeVisible();

    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox?.width).toBe(224);

    // The sidebar's own border is the boundary; x=0 if it never laid out, which likewise
    // fails rather than passes.
    const boundary = (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0);

    // The switcher's right edge must stay inside the sidebar's — the overflow bug put it
    // past the border, over the main pane.
    expect(await rightEdge(switcher)).toBeLessThanOrEqual(boundary);

    // And every segment with it: a segment clipped at the border is unreadable even when
    // the group's own box happens to fit. The segments are icon-only now (ALF-270), so there
    // is no label to truncate — only the geometry to check.
    for (const label of ['Tasks', 'Code', 'Comms', 'Reader', 'Wiki']) {
      const segment = page.getByRole('link', { name: label, exact: true });
      expect(
        await rightEdge(segment),
        `the ${label} segment must not cross the sidebar border`,
      ).toBeLessThanOrEqual(boundary);
    }
  });

  test('highlights Tasks in amber and Code in teal, so the two never read alike', async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/priority');

    const tasks = page.getByRole('link', { name: 'Tasks', exact: true });
    const code = page.getByRole('link', { name: 'Code', exact: true });

    // Tasks is the active module here, so its icon wears the Tasks accent: amber.
    await expect(tasks).toHaveCSS('color', 'rgb(240, 180, 41)');
    const restingCode = await code.evaluate((element) => getComputedStyle(element).color);

    // Switch to Code and its icon takes the Code accent — teal, a different colour.
    await code.click();
    await expect(page).toHaveURL(/\/code$/);
    await expect(code).toHaveCSS('color', 'rgb(79, 209, 224)');
    await expect(tasks).toHaveCSS('color', restingCode);
  });

  test('highlights Wiki in violet (ALF-261)', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/priority');

    const wiki = page.getByRole('link', { name: 'Wiki', exact: true });
    await expect(wiki).not.toHaveCSS('color', 'rgb(167, 139, 250)');

    await wiki.click();
    await expect(page).toHaveURL(/\/wiki$/);
    // #a78bfa — the accent-violet token in globals.css.
    await expect(wiki).toHaveCSS('color', 'rgb(167, 139, 250)');
  });

  test('highlights Reader in green (ALF-233)', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/priority');

    const reader = page.getByRole('link', { name: 'Reader', exact: true });

    // Resting (inactive) segments don't carry the module's own colour.
    await expect(reader).not.toHaveCSS('color', 'rgb(52, 211, 153)');

    await reader.click();
    await expect(page).toHaveURL(/\/reader$/);
    // #34d399 — the accent-green token in globals.css.
    await expect(reader).toHaveCSS('color', 'rgb(52, 211, 153)');
  });

  test("names the active module at the wordmark row's right edge, in its accent colour (ALF-270)", async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/priority');

    const sidebar = page.locator('aside');
    const switcher = page.getByRole('group', { name: 'Switch module' });
    const name = sidebar.getByText('Tasks', { exact: true });
    await expect(name).toBeVisible();
    await expect(name).toHaveCSS('color', 'rgb(240, 180, 41)');

    const clipped = await name.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(clipped, 'the wordmark-row name must not be truncated').toBe(false);

    const nameBox = await name.boundingBox();
    const switcherBox = await switcher.boundingBox();
    expect(
      Math.abs(
        (nameBox?.x ?? 0) +
          (nameBox?.width ?? 0) -
          ((switcherBox?.x ?? 0) + (switcherBox?.width ?? 0)),
      ),
    ).toBeLessThanOrEqual(1);

    // Switch to Code and the name follows, in the Code teal.
    await page.getByRole('link', { name: 'Code', exact: true }).click();
    await expect(page).toHaveURL(/\/code$/);
    const codeName = sidebar.getByText('Code', { exact: true });
    await expect(codeName).toBeVisible();
    await expect(codeName).toHaveCSS('color', 'rgb(79, 209, 224)');
  });
});
