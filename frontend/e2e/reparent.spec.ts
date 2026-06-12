import type { Locator, Page } from '@playwright/test';

import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

// Expand/collapse is animated (a grid-rows transition). Reduced motion makes it instant so
// a freshly-revealed subtask is in its final position before we press it to start a drag.
// `reducedMotion` isn't a top-level use option in this Playwright version — it's set through
// the browser context (see PlaywrightTestOptions.contextOptions).
test.use({ contextOptions: { reducedMotion: 'reduce' } });

/**
 * Re-parent by drag-and-drop: dropping a task (parent or subtask) onto ANOTHER task makes
 * the dropped task — and its whole subtree — a child of that target. The target row lights
 * up and swaps its checkbox for a "+" while hovered. Routes through the optimistic
 * reparentTask action, so the new nesting shows instantly.
 */

/**
 * Drag `source` onto the `target` task row with real pointer events. dnd-kit's PointerSensor
 * engages only after an 8px move, so nudge past that first, then glide onto the target in
 * steps and wait for its drop highlight (`data-drop-over`) before releasing.
 */
async function reparentOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('source or target has no bounding box');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 16, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(page.locator('[data-drop-over="true"]')).toBeVisible();
  await page.mouse.up();
}

test.describe('re-parent a task by dragging it onto another task', () => {
  // Re-parenting PATCHes parent_id, which the API validates as a UUID — so these seeds use
  // makeItem's generated UUID ids (a readable id like 'p1' would 400 and roll back).
  test('nests a top-level task under another task', async ({ page, seed }) => {
    const parent = makeItem('Parent task');
    const dragged = makeItem('Dragged task');
    await seed({ items: [parent, dragged] });
    await page.goto('/?view=inbox');

    await reparentOnto(page, page.getByText('Dragged task'), page.getByText('Parent task'));

    // The parent now owns the dragged task — expand it to reveal the new child.
    const parentRow = page.getByRole('listitem').filter({ hasText: 'Parent task' });
    await expect(parentRow).toContainText('Dragged task');
    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(
      page.getByRole('list', { name: 'Subtasks' }).getByText('Dragged task'),
    ).toBeVisible();
  });

  test('brings the dragged task’s whole subtree along', async ({ page, seed }) => {
    const home = makeItem('New home');
    const dragged = makeItem('Move me');
    const child = makeItem('My child', { parent_id: dragged.id });
    await seed({ items: [home, dragged, child] });
    await page.goto('/?view=inbox');

    await reparentOnto(page, page.getByText('Move me'), page.getByText('New home'));

    // New home → Move me → My child: the subtree moved intact.
    await expect(page.getByRole('listitem').filter({ hasText: 'New home' })).toContainText(
      'Move me',
    );
    await page.getByRole('button', { name: 'Expand subtasks' }).click(); // expand New home
    await page.getByRole('button', { name: 'Expand subtasks' }).click(); // expand Move me
    await expect(page.getByText('My child')).toBeVisible();
  });

  test('re-parents a subtask onto a different task', async ({ page, seed }) => {
    const first = makeItem('First parent');
    const loose = makeItem('Loose subtask', { parent_id: first.id });
    const second = makeItem('Second parent');
    await seed({ items: [first, loose, second] });
    await page.goto('/?view=inbox');

    // Reveal the subtask, then drag it onto the other top-level task.
    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await reparentOnto(page, page.getByText('Loose subtask'), page.getByText('Second parent'));

    // It now lives under Second parent: only that row is still expandable.
    await expect(page.getByRole('listitem').filter({ hasText: 'Second parent' })).toContainText(
      'Loose subtask',
    );
    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(
      page.getByRole('list', { name: 'Subtasks' }).getByText('Loose subtask'),
    ).toBeVisible();
  });
});
