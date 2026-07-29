/**
 * Folder reordering — end-to-end coverage for ALF-153.
 *
 * The sidebar folder list defaults to creation order and can be rearranged: the deterministic
 * path is the "Move up" / "Move down" entries in a folder's row menu (the only path on touch,
 * where the drag grip is hidden); dragging the grip into the gap between two folders is the
 * spatial path. Both persist to `sort_order` and survive a reload.
 *
 * Per the dnd-kit skill, the menu actions are the reliable assertion target; the pointer spec
 * waits on a gap's `data-drop-over` marker before releasing.
 */
import type { Locator, Page } from '@playwright/test';

import { type SeedState, makeFolder } from './support/constants';
import { boxOf, pickUp } from './support/drag';
import { expect, test } from './support/fixtures';

/** Seed three folders, in creation order. */
async function seedFolders(seed: (state: SeedState) => Promise<void>): Promise<void> {
  await seed({ folders: [makeFolder('Work'), makeFolder('Home'), makeFolder('Someday')] });
}

/** The sidebar's folder links, in render order. */
function folderLinks(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Navigation' }).locator('a[href^="/folders/"]');
}

test('reorders folders with the Move up / Move down menu actions, persisting across reload', async ({
  page,
  seed,
}) => {
  await seedFolders(seed);
  await page.goto('/?view=inbox');

  const folders = folderLinks(page);
  await expect(folders).toHaveText([/Work/, /Home/, /Someday/]);

  // Move the last folder up one slot → it swaps past "Home".
  await page.getByRole('button', { name: 'Options for Someday' }).click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(folders).toHaveText([/Work/, /Someday/, /Home/]);

  // Move the first folder down one slot → it swaps past "Someday".
  await page.getByRole('button', { name: 'Options for Work' }).click();
  await page.getByRole('menuitem', { name: 'Move down' }).click();
  await expect(folders).toHaveText([/Someday/, /Work/, /Home/]);

  // The manual order persists across a reload (it lives in sort_order, not client state).
  await page.reload();
  await expect(folders).toHaveText([/Someday/, /Work/, /Home/]);
});

test('hides Move up on the first folder and Move down on the last', async ({ page, seed }) => {
  await seedFolders(seed);
  await page.goto('/?view=inbox');

  await page.getByRole('button', { name: 'Options for Work' }).click();
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Options for Someday' }).click();
  await expect(page.getByRole('menuitem', { name: 'Move down' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Move up' })).toBeVisible();
});

test('drags a folder by its grip into the gap above the first folder', async ({ page, seed }) => {
  await seedFolders(seed);
  await page.goto('/?view=inbox');

  const folders = folderLinks(page);
  await expect(folders).toHaveText([/Work/, /Home/, /Someday/]);

  // Capture the boundaries BEFORE dragging (the DragOverlay clones the dragged name mid-drag).
  const firstBox = await boxOf(folders.filter({ hasText: 'Work' }));
  const middleBox = await boxOf(folders.filter({ hasText: 'Home' }));
  // The third row's grip — the handle sits outside the link, so pressing it drags rather than
  // following the href.
  await pickUp(page, page.locator('[data-folder-drag-handle]').nth(2));

  // Over the middle of a folder row — between its gaps — nothing lights up: a folder drag
  // reorders, so "file it into this folder" is not on offer.
  await page.mouse.move(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2, {
    steps: 8,
  });
  await expect(page.locator('[data-drop-over="true"]')).toHaveCount(0);

  // Glide onto the top gap (straddling the first row's top edge) and wait for it to light up.
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + 1, { steps: 12 });
  await expect(page.locator('[data-folder-gap][data-drop-over="true"]')).toBeVisible();
  await page.mouse.up();

  await expect(folders).toHaveText([/Someday/, /Work/, /Home/]);
});
