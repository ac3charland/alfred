import type { Locator, Page } from '@playwright/test';

import { makeFolder, makeItem } from './support/constants';
import { pickUp } from './support/drag';
import { expect, test } from './support/fixtures';

/**
 * Drag-to-folder: the whole task row is the drag surface (no handle); the sidebar folders
 * are drop targets. A drop routes through the optimistic moveTask action, so the task
 * leaves its current view instantly and is filed under the target folder.
 *
 * NOTE: the Inbox nav link was removed, so it is no longer a drop target — there is
 * no "drag a filed task back to the Inbox" affordance. That capability still exists via the
 * row's "Move to… → Inbox" menu (covered elsewhere); only the drag-onto-Inbox-link shortcut
 * is gone with the link.
 */

/**
 * Drag `source` onto `target` with real pointer events. dnd-kit's PointerSensor only
 * engages after an 8px move, so nudge past that threshold before gliding to the target in
 * steps (it needs intermediate pointermove events to resolve the collision).
 */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  await pickUp(page, source);
  const to = await target.boundingBox();
  if (to === null) throw new Error('target has no bounding box');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  // Wait for the drop target to register the hover (its data-drop-over marker) before
  // releasing, so the drop never races ahead of collision detection under load.
  await expect(page.locator('[data-drop-over="true"]')).toBeVisible();
  await page.mouse.up();
}

test.describe('drag a task to a folder', () => {
  test('files an inbox task into a folder by dragging it onto the sidebar', async ({
    page,
    seed,
  }) => {
    const work = makeFolder('Work');
    await seed({ folders: [work], items: [makeItem('Drag me')] });
    await page.goto('/?view=inbox');

    const source = page.getByText('Drag me');
    const workFolder = page.getByRole('link', { name: 'Work' });

    await dragOnto(page, source, workFolder);

    // Optimistic move: the task leaves the inbox immediately ...
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Drag me')).toBeHidden();

    // ... and is now filed under Work (the store already reconciled; navigate client-side).
    await workFolder.click();
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Drag me')).toBeVisible();
  });
});
