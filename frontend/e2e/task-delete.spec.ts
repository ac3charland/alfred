import type { Page } from '@playwright/test';

import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Regression guard for the task/inbox deletion animation (ALF-17).
 *
 * Deleting a row used to remove it instantly. It now plays the same animate-then-commit
 * exit as completion: the row fades out while its height collapses to zero (ease-out),
 * pulling the rows below up, and `deleteTask` only commits when that collapse ends. We
 * drive the real browser and sample the deleting row frame by frame — the transient
 * collapse/fade frames that jsdom and final-state assertions can't see.
 *
 * The probe captures the deleting <li> by IDENTITY up front (a position selector like
 * `li:first-child` can't follow a node across its unmount) and reads it every animation
 * frame. The "pull up" is checked separately with fresh locator measurements before/after,
 * since the rows below are reconciled to new nodes on commit. See the debug-animations skill.
 *
 * Every fixture is a `task` so the actions menu (and its Delete item) is exposed.
 */
function makeTask(title: string) {
  return makeItem(title, { item_type: 'task' });
}

interface DeleteFrame {
  /** ms since sampling began. */
  t: number;
  /** Whether the deleting <li> is still in the document. */
  inDoc: boolean;
  /** The deleting row's collapse-wrapper height (px). */
  height: number;
  /** The deleting row's content opacity (computed). */
  opacity: number;
}

interface DeleteProbe {
  frames: DeleteFrame[];
  done: boolean;
}

const PROBE_KEY = '__deleteProbe';

/**
 * Capture the deleting row (`title`) by identity and start sampling its collapse wrapper
 * every animation frame for `durationMs`. Returns once the loop is installed
 * (fire-and-forget) so the caller can trigger the delete while it samples.
 */
async function startDeletionProbe(page: Page, title: string, durationMs: number): Promise<void> {
  await page.evaluate(
    ({ title, durationMs, key }) => {
      const rows = [...document.querySelectorAll('ul[aria-label="Tasks"] > li')];
      const deleted = rows.find((row) => row.textContent.includes(title));
      const wrapper = deleted?.querySelector('[data-testid="task-collapse"]') ?? null;
      const content = wrapper?.firstElementChild ?? null;

      const probe: DeleteProbe = { frames: [], done: false };
      (globalThis as unknown as Record<string, DeleteProbe>)[key] = probe;
      const start = performance.now();
      const tick = () => {
        const present = !!wrapper && document.contains(wrapper);
        probe.frames.push({
          t: Math.round(performance.now() - start),
          inDoc: present,
          height: present ? wrapper.getBoundingClientRect().height : 0,
          opacity: present && content ? Number(getComputedStyle(content).opacity) : 0,
        });
        if (performance.now() - start < durationMs) requestAnimationFrame(tick);
        else probe.done = true;
      };
      requestAnimationFrame(tick);
    },
    { title, durationMs, key: PROBE_KEY },
  );
}

/** Wait for the sampling window to elapse and return the recorded frames. */
async function collectDeletionFrames(page: Page): Promise<DeleteFrame[]> {
  await page.waitForFunction(
    (key) => (globalThis as unknown as Record<string, DeleteProbe | undefined>)[key]?.done,
    PROBE_KEY,
  );
  return page.evaluate(
    (key) => (globalThis as unknown as Record<string, DeleteProbe | undefined>)[key]?.frames ?? [],
    PROBE_KEY,
  );
}

/** Open a row's actions menu and choose Delete. */
async function deleteRow(page: Page, title: string): Promise<void> {
  const row = page.getByRole('listitem').filter({ hasText: title });
  await row.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
}

test('deleting a row fades it out, collapses its height, and pulls the rows below up', async ({
  page,
  seed,
}) => {
  // The inbox lists newest-first, so "Top task" renders above "Bottom task".
  await seed({ items: [makeTask('Bottom task'), makeTask('Top task')] });
  await page.goto('/?view=inbox');
  await expect(page.getByText('Top task')).toBeVisible();

  // Where the row below the deleting one sits before the delete — it should rise once the gap closes.
  const bottomBefore = await page.getByText('Bottom task').boundingBox();

  // Open the top row's menu, install the probe, then commit the delete while it samples.
  const row = page.getByRole('listitem').filter({ hasText: 'Top task' });
  await row.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await startDeletionProbe(page, 'Top task', 1200);
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const frames = await collectDeletionFrames(page);

  const visible = frames.filter((frame) => frame.inDoc);
  expect(visible.length).toBeGreaterThan(0);

  // The collapse ANIMATED rather than snapping: the wrapper height passed through
  // intermediate values between its full row height and zero (an instant removal would
  // jump straight to gone with no in-between frames).
  const fullHeight = Math.max(...visible.map((frame) => frame.height));
  expect(fullHeight).toBeGreaterThan(20);
  expect(Math.min(...visible.map((frame) => frame.height))).toBeLessThan(5);
  expect(visible.some((frame) => frame.height > 5 && frame.height < fullHeight - 5)).toBe(true);

  // The content faded out as it collapsed.
  expect(Math.min(...visible.map((frame) => frame.opacity))).toBeLessThan(0.2);

  // The deleting row ultimately left the DOM (commit fired after the collapse).
  expect(frames.at(-1)?.inDoc).toBe(false);
  await expect(page.getByText('Top task')).toHaveCount(0);

  // The row below rose to close the gap.
  const bottomAfter = await page.getByText('Bottom task').boundingBox();
  expect(bottomBefore).not.toBeNull();
  expect(bottomAfter).not.toBeNull();
  expect(bottomAfter?.y ?? 0).toBeLessThan(bottomBefore?.y ?? 0);
});

test('deleting a row commits immediately under reduced motion', async ({ page, seed }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed({ items: [makeTask('Solo task')] });
  await page.goto('/?view=inbox');
  await expect(page.getByText('Solo task')).toBeVisible();

  await deleteRow(page, 'Solo task');

  // No animation to wait on — the row leaves at once.
  await expect(page.getByText('Solo task')).toHaveCount(0);
});
