import type { Locator, Page } from '@playwright/test';

import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

// Instant expand/collapse so a freshly-revealed subtask is settled before we press it.
test.use({ reducedMotion: 'reduce' });

/**
 * THROWAWAY demo-capture spec (not part of the suite's intent — delete after capturing).
 * Drives the real app through the mock backend to shoot the re-parent drag-and-drop:
 * before → mid-drag (highlight + "+") → after.
 */

const SHOTS = '/tmp/reparent';

// The DragOverlay clone is the full width of the row (unchanged styling). Dropping
// straight down would park it exactly over the target. Nudging the cursor RIGHT shifts
// the overlay right too, so the target's left edge — its teal highlight + the "+" that
// replaces the checkbox — peeks out for the screenshot. (Collision is pointer-based, so
// the cursor staying inside the target row is all that matters.)
const REVEAL_OFFSET = 150;

async function dragOnto(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('no bounding box');
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 16, startY, { steps: 5 });
  await page.mouse.move(startX + REVEAL_OFFSET, to.y + to.height / 2, { steps: 10 });
  await page.locator('[data-drop-over="true"]').waitFor();
}

test('capture: re-parent by drag-and-drop', async ({ page, seed }) => {
  const plan = makeItem('Plan the launch');
  const email = makeItem('Email the agency');
  await seed({ items: [plan, email] });
  await page.goto('/?view=inbox');
  await page.getByText('Plan the launch').waitFor();

  // 1. Before: two independent top-level tasks.
  await page.screenshot({ path: `${SHOTS}-1-before.png` });

  // 2. Mid-drag: drag "Email the agency" onto "Plan the launch". The target row lights up
  //    and swaps its checkbox for a "+", and the dragged title floats under the cursor.
  await dragOnto(page, page.getByText('Email the agency'), page.getByText('Plan the launch'));
  await page.screenshot({ path: `${SHOTS}-2-mid-drag.png` });
  await page.mouse.up();

  // 3. After: the dropped task is now a child of the target (expand to reveal it). No
  //    enter/exit animation — it simply appears in its new place.
  await expect(page.getByRole('listitem').filter({ hasText: 'Plan the launch' })).toContainText(
    'Email the agency',
  );
  await page.getByRole('button', { name: 'Expand subtasks' }).click();
  await page.getByRole('list', { name: 'Subtasks' }).getByText('Email the agency').waitFor();
  await page.screenshot({ path: `${SHOTS}-3-after.png` });
});

test('capture: re-parent a subtask onto another task', async ({ page, seed }) => {
  const brief = makeItem('Write the brief');
  const gather = makeItem('Gather references', { parent_id: brief.id });
  const review = makeItem('Design review');
  await seed({ items: [brief, gather, review] });
  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Expand subtasks' }).click();
  await page.getByText('Gather references').waitFor();

  // DIAGNOSTIC: step through the drag manually and shoot each phase.
  const from = await page.getByText('Gather references').boundingBox();
  if (from === null) throw new Error('no box');
  const startX = from.x + from.width / 2;
  const startY = from.y + from.height / 2;
  const info = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const chain: string[] = [];
      let cur: Element | null = el;
      while (cur) {
        chain.push(`${cur.tagName}.${typeof cur.className === 'string' ? cur.className.slice(0, 25) : ''}`);
        cur = cur.parentElement;
      }
      return chain.slice(0, 6);
    },
    { x: startX, y: startY },
  );
  console.log('PRESS CHAIN:', JSON.stringify(info));
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 16, startY, { steps: 5 });
  await page.screenshot({ path: `${SHOTS}-DIAG-after-nudge.png` });
  const to = await page.getByText('Design review').boundingBox();
  if (to === null) throw new Error('no box');
  await page.mouse.move(startX + REVEAL_OFFSET, to.y + to.height / 2, { steps: 10 });
  await page.screenshot({ path: `${SHOTS}-DIAG-at-target.png` });
  await page.mouse.up();
});
