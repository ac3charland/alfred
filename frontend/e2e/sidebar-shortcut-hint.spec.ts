import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-207 — the sidebar's "Press ⌘K to go anywhere" hint must stay pinned to the bottom of the
 * *viewport*, never the bottom of the *page*.
 *
 * The document is what grows and scrolls (see app-shell.styles.ts), so the sidebar stretches to
 * match however tall the main content column gets. On a task list long enough to run well past
 * one screen, a plain in-flow hint at the end of the sidebar would render below the fold of the
 * whole page — invisible without scrolling all the way past every task.
 */

// The suite's default project (Desktop Chrome) — pinned here rather than read from
// `page.viewportSize()` so the assertions below don't need to guard against a null viewport.
const VIEWPORT = { width: 1280, height: 720 };

test('the ⌘K hint stays on screen even when the task list runs far past the viewport', async ({
  page,
  seed,
}) => {
  const folder = makeFolder('Long list', { id: 'f1' });
  await seed({
    folders: [folder],
    // Comfortably taller than the viewport so the page must scroll.
    items: Array.from({ length: 60 }, (_, index) =>
      makeItem(`Task ${String(index)}`, { folder_id: 'f1' }),
    ),
  });
  await page.goto(`/folders/${folder.id}`);

  const hint = page.getByTestId('sidebar-shortcut-hint');
  await expect(hint).toBeVisible();

  // Sanity check that the page is actually tall enough to exercise the bug: the last task
  // extends past the bottom of the viewport.
  const lastTaskBox = await page.getByText('Task 59').boundingBox();
  expect(lastTaskBox?.y ?? 0).toBeGreaterThan(VIEWPORT.height);

  // The hint itself must stay fully inside the viewport, both before any scrolling and after
  // scrolling partway down the page.
  for (const scrollTop of [0, 400]) {
    await page.evaluate((top) => {
      window.scrollTo(0, top);
    }, scrollTop);
    const hintBox = await hint.boundingBox();
    expect(hintBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((hintBox?.y ?? 0) + (hintBox?.height ?? 0)).toBeLessThanOrEqual(VIEWPORT.height);
  }
});
