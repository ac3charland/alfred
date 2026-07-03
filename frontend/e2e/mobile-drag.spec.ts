import { makeFolder, makeItem } from './support/constants';
import { boxOf } from './support/drag';
import { expect, test } from './support/fixtures';
import { createTouch, touchPickUp } from './support/touch';

/**
 * Touch drag activation. The whole task row is a drag surface with no handle, so on a touch
 * device a plain swipe used to be mis-read as a drag (the pointer sensor lifted after an 8px
 * move) and the list couldn't be scrolled. Touch now activates on a press-and-hold instead:
 * a quick swipe scrolls, and only holding a row still for ~250ms lifts it. Mouse and keyboard
 * paths are unchanged (covered by drag-to-folder / promote-to-root / reparent specs).
 *
 * `hasTouch` enables real touch events (a `TouchSensor` never fires from mouse events); the
 * desktop-width viewport keeps the folder sidebar visible — a touchscreen laptop, the hybrid
 * case the split sensors handle: mouse and touch each get their own activation rule.
 */
test.use({
  hasTouch: true,
  viewport: { width: 1024, height: 720 },
  contextOptions: { reducedMotion: 'reduce' },
});

test.describe('touch drag activation (hold-first)', () => {
  test('a quick swipe does not start a drag (so the browser keeps the scroll)', async ({
    page,
    seed,
  }) => {
    // A real list of rows, so the swipe is a genuine scroll gesture over the tasks.
    const items = Array.from({ length: 25 }, (_, i) => makeItem(`Task ${String(i + 1)}`));
    await seed({ items });
    await page.goto('/?view=inbox');

    const list = page.getByRole('list', { name: 'Tasks', exact: true });
    const row = list.getByText('Task 3', { exact: true });
    await expect(row).toBeVisible();

    const scrollTop = () => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);
    expect(await scrollTop()).toBe(0);

    const touch = await createTouch(page);
    const box = await boxOf(row);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Press and swipe up, then wait past the 250ms hold window with the finger still down. The
    // move blew past the 5px tolerance before the timer, so the touch sensor cancels and no
    // drag ever activates — the old distance sensor would have lifted the row on this very
    // move, hijacking the gesture with preventDefault and blocking the scroll.
    await touch.down(cx, cy);
    await touch.move(cx, cy - 220, 10);
    await page.waitForTimeout(400);

    // Nothing lifted (no dimmed row), no drop target lit, no floating overlay clone: the
    // gesture stayed a plain scroll, exactly what the browser needs to move the list.
    await expect(page.locator('.opacity-40')).toHaveCount(0);
    await expect(page.locator('[data-drop-over="true"]')).toHaveCount(0);
    await expect(page.getByText('Task 3', { exact: true })).toHaveCount(1);

    await touch.up();

    // And the list actually scrolled — proof the drag never hijacked the gesture with
    // preventDefault (the very bug this fixes: a swipe left the list un-scrollable).
    await expect(async () => {
      expect(await scrollTop()).toBeGreaterThan(0);
    }).toPass();
  });

  test('holding a row still, then gliding to a folder, files the task', async ({ page, seed }) => {
    const work = makeFolder('Work');
    await seed({ folders: [work], items: [makeItem('Hold me')] });
    await page.goto('/?view=inbox');

    const list = page.getByRole('list', { name: 'Tasks', exact: true });
    const source = list.getByText('Hold me');
    await expect(source).toBeVisible();
    const workFolder = page.getByRole('link', { name: 'Work' });

    const touch = await createTouch(page);
    // Hold past the 250ms delay to lift the row (retries out the hydration race) ...
    await touchPickUp(page, touch, source);

    // ... then glide onto the folder and drop.
    const to = await boxOf(workFolder);
    await touch.move(to.x + to.width / 2, to.y + to.height / 2, 10);
    await expect(page.locator('[data-drop-over="true"]')).toBeVisible();
    await touch.up();

    // Optimistic move: the task leaves the inbox immediately ...
    await expect(list.getByText('Hold me')).toBeHidden();

    // ... and is now filed under Work.
    await workFolder.click();
    await expect(list.getByText('Hold me')).toBeVisible();
  });
});
