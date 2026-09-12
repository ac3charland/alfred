import type { Locator } from '@playwright/test';

import { makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-219 — the desktop module switcher must fit inside the sidebar, and each module's
 * highlight must be its own colour.
 *
 * Proven in a real browser rather than jsdom because both halves are geometry and paint:
 * jsdom has no layout, so it can't tell a control that fits from one whose third segment
 * spills across the sidebar's border into the main pane, and it resolves no Tailwind
 * colours, so it can't tell Tasks' highlight from Code's.
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
  test('fits inside the sidebar instead of spilling over its border', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/priority');

    const sidebar = page.locator('aside');
    const switcher = page.getByRole('group', { name: 'Switch module' });
    await expect(switcher).toBeVisible();

    // The sidebar's own border is the boundary; x=0 if it never laid out, which likewise
    // fails rather than passes.
    const sidebarBox = await sidebar.boundingBox();
    const boundary = (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0);

    // The switcher's right edge must stay inside the sidebar's — the overflow bug put it
    // past the border, over the main pane.
    expect(await rightEdge(switcher)).toBeLessThanOrEqual(boundary);

    // And every segment with it: a segment clipped at the border is unreadable even when
    // the group's own box happens to fit.
    for (const label of ['Tasks', 'Code', 'Comms']) {
      const segment = page.getByRole('link', { name: label, exact: true });
      expect(
        await rightEdge(segment),
        `the ${label} segment must not cross the sidebar border`,
      ).toBeLessThanOrEqual(boundary);

      // Fitting by truncating the labels would be its own bug, so hold the control to the
      // stronger bar: at the sidebar's width every label is still shown in full.
      const clipped = await segment.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      );
      expect(clipped, `the ${label} label must not be truncated to fit`).toBe(false);
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

    // Tasks is the active module here, so its label wears the Tasks accent: amber.
    await expect(tasks).toHaveCSS('color', 'rgb(240, 180, 41)');
    const restingCode = await code.evaluate((element) => getComputedStyle(element).color);

    // Switch to Code and its label takes the Code accent — teal, a different colour.
    await code.click();
    await expect(page).toHaveURL(/\/code$/);
    await expect(code).toHaveCSS('color', 'rgb(79, 209, 224)');
    await expect(tasks).toHaveCSS('color', restingCode);
  });
});
