import type { Locator, Page } from '@playwright/test';

import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Drag-to-folder: a top-level task row carries a drag handle; the sidebar Inbox and
 * folders are drop targets. A drop routes through the optimistic moveTask action, so the
 * task leaves its current view instantly and is filed under the target folder.
 */

/**
 * Drag `source` onto `target` with real pointer events. dnd-kit's PointerSensor only
 * engages after an 8px move, so nudge past that threshold before gliding to the target in
 * steps (it needs intermediate pointermove events to resolve the collision).
 */
async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('source or target has no bounding box');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 16, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
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

    const handle = page.getByRole('button', { name: 'Drag "Drag me" to a folder' });
    const workFolder = page.getByRole('link', { name: 'Work' });

    await dragOnto(page, handle, workFolder);

    // Optimistic move: the task leaves the inbox immediately ...
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Drag me')).toBeHidden();

    // ... and is now filed under Work (the store already reconciled; navigate client-side).
    await workFolder.click();
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('Drag me')).toBeVisible();
  });

  test('returns a filed task to the Inbox by dragging it onto the Inbox target', async ({
    page,
    seed,
  }) => {
    const work = makeFolder('Work');
    await seed({ folders: [work], items: [makeItem('File me', { folder_id: work.id })] });
    await page.goto(`/folders/${work.id}`);

    const handle = page.getByRole('button', { name: 'Drag "File me" to a folder' });
    const inbox = page.getByRole('link', { name: 'Inbox' });

    await dragOnto(page, handle, inbox);

    // It leaves the Work folder view immediately ...
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('File me')).toBeHidden();

    // ... and is back in the Inbox.
    await inbox.click();
    await expect(page.getByRole('list', { name: 'Tasks' }).getByText('File me')).toBeVisible();
  });
});
