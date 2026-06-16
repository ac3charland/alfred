import type { Page } from '@playwright/test';

import { makeItem } from './support/constants';
import { boxOf, pickUp } from './support/drag';
import { expect, test } from './support/fixtures';

// Expand/collapse is animated; reduced motion makes it instant so a freshly-revealed
// subtask is settled before we press it to start a drag.
test.use({ contextOptions: { reducedMotion: 'reduce' } });

// Subtask trees are task-only (a `parent_id` implies a task), so these fixtures
// classify as tasks rather than `makeItem`'s default `unclassified`.
type MakeItemOverrides = Parameters<typeof makeItem>[1];
function makeTask(title: string, overrides: MakeItemOverrides = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

/**
 * Pull a subtask out to the top level by dragging it past the list's top or bottom edge.
 * A dedicated promote-to-root drop zone appears at that edge while a CHILD is being dragged
 * (a top-level task has nothing to pull out, so it never shows). Dropping there clears the
 * task's parent_id via the optimistic reparentTask action.
 */

const tasksList = (page: Page) => page.getByRole('list', { name: 'Tasks', exact: true });

/** Drag the subtask `childText` past the list's top or bottom edge and drop it on the zone. */
async function dragPastEdge(page: Page, childText: string, edge: 'top' | 'bottom'): Promise<void> {
  // Pick the child up; the edge zones become available once the (child) drag activates.
  await pickUp(page, page.getByText(childText));

  // Glide onto the edge zone (located directly so we always aim at its real position).
  const box = await page.locator(`[data-promote-zone="${edge}"]`).boundingBox();
  if (box === null) throw new Error('promote zone has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
  await expect(page.locator('[data-promote-over="true"]')).toBeVisible();
  await page.mouse.up();
}

test.describe('pull a subtask out to the top level by dragging it past the list edge', () => {
  test('dropping a subtask below the list makes it a top-level task', async ({ page, seed }) => {
    const parent = makeTask('Parent');
    const child = makeTask('Promote me', { parent_id: parent.id });
    await seed({ items: [parent, child] });
    await page.goto('/?view=inbox');
    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(page.getByText('Promote me')).toBeVisible();

    await dragPastEdge(page, 'Promote me', 'bottom');

    // It's now a sibling of Parent (a direct row of the Tasks list), and Parent — having
    // lost its only child — is no longer expandable.
    await expect(
      tasksList(page).locator(':scope > li').filter({ hasText: 'Promote me' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand subtasks' })).toHaveCount(0);
  });

  test('dropping a subtask above the list also promotes it', async ({ page, seed }) => {
    const parent = makeTask('Parent');
    const child = makeTask('Promote me', { parent_id: parent.id });
    await seed({ items: [parent, child] });
    await page.goto('/?view=inbox');
    await page.getByRole('button', { name: 'Expand subtasks' }).click();
    await expect(page.getByText('Promote me')).toBeVisible();

    await dragPastEdge(page, 'Promote me', 'top');

    await expect(
      tasksList(page).locator(':scope > li').filter({ hasText: 'Promote me' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand subtasks' })).toHaveCount(0);
  });

  test('no promote zone appears while dragging a task that is already top-level', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeTask('Root A'), makeTask('Root B')] });
    await page.goto('/?view=inbox');

    await pickUp(page, page.getByText('Root A'));
    const list = await boxOf(tasksList(page));
    await page.mouse.move(list.x + list.width / 2, list.y + list.height + 16, { steps: 10 });

    // A root task has nothing to pull out — the zone stays collapsed and never lights up.
    await expect(page.locator('[data-promote-over="true"]')).toHaveCount(0);
    await page.mouse.up();
  });
});
