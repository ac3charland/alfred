import type { Locator, Page } from '@playwright/test';

import { makeItem } from './support/constants';
import { boxOf, pickUp } from './support/drag';
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
  await pickUp(page, source);
  const to = await target.boundingBox();
  if (to === null) throw new Error('target has no bounding box');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(page.locator('[data-drop-over="true"]')).toBeVisible();
  await page.mouse.up();
}

/**
 * Expand collapsed rows until `childText` is revealed. Re-parenting is optimistic and then
 * reconciles with the server; under load that re-render can swallow a single expand click, so
 * retry it — clicking only rows that are still collapsed (whose toggle reads "Expand
 * subtasks"), so an already-open row is never toggled back shut.
 */
async function expandToReveal(page: Page, childText: string): Promise<void> {
  await expect(async () => {
    const collapsed = page.getByRole('button', { name: 'Expand subtasks' });
    if ((await collapsed.count()) > 0) await collapsed.first().click();
    await expect(page.getByText(childText)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
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
    await expandToReveal(page, 'Dragged task');
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
    // Expand New home, then Move me, to reveal the moved grandchild.
    await expandToReveal(page, 'My child');
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
    await expandToReveal(page, 'Loose subtask');
  });

  // Regression: dropping a task back on itself must be a no-op. Re-parenting a task onto
  // itself (or a descendant) would make a cycle that buildTree drops, so the task and its
  // whole subtree silently vanish. The drop must especially survive having *hovered another
  // task first* (which used to leave a stale drop target behind). Cycles are also rejected
  // at the store layer (see tasks-store.test.tsx); this guards the integrated drag.
  test('dropping a task back on itself (after hovering another) leaves it untouched', async ({
    page,
    seed,
  }) => {
    const keep = makeItem('Keep me');
    const sub = makeItem('My subtask', { parent_id: keep.id });
    const other = makeItem('Other task');
    await seed({ items: [keep, sub, other] });
    await page.goto('/?view=inbox');

    // Capture both rows' positions up front — once the drag starts, the DragOverlay renders
    // a second "Keep me", so getByText would match two nodes. "Keep me" is a root, so the
    // promote zones never reveal and nothing reflows.
    const self = await boxOf(page.getByText('Keep me'));
    const target = await boxOf(page.getByText('Other task'));

    // Pick up "Keep me", hover "Other task" so it highlights, then glide back and drop on
    // "Keep me" itself.
    await pickUp(page, page.getByText('Keep me'));
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
    await expect(page.locator('[data-drop-over="true"]')).toBeVisible();
    await page.mouse.move(self.x + self.width / 2, self.y + self.height / 2, { steps: 10 });
    await page.mouse.up();

    // "Keep me" is still a top-level row (a direct child of the Tasks list) and still owns
    // its subtask — it neither vanished into a cycle nor nested under the hovered task. The
    // collapsed row's "1" badge proves the subtree came through intact.
    const tasks = page.getByRole('list', { name: 'Tasks', exact: true });
    const keepRow = tasks.locator(':scope > li').filter({ hasText: 'Keep me' });
    await expect(keepRow).toBeVisible();
    await expect(keepRow.getByText('1', { exact: true })).toBeVisible();
  });
});
