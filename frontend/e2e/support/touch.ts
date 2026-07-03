import { type Locator, type Page, expect } from '@playwright/test';

/**
 * A minimal single-finger touch driver backed by CDP `Input.dispatchTouchEvent`.
 *
 * Playwright's `page.touchscreen` only exposes a one-shot `tap`, which can't express the
 * press-hold-then-glide sequence the tasks list needs (its TouchSensor lifts a row only after
 * a ~250ms hold). Mouse events don't drive a `TouchSensor` at all, so we dispatch real touch
 * events at the browser level instead. Down/move/up mirror the mouse driver in `drag.ts`.
 */
export interface TouchDriver {
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number, steps?: number): Promise<void>;
  up(): Promise<void>;
}

export async function createTouch(page: Page): Promise<TouchDriver> {
  const client = await page.context().newCDPSession(page);
  let current = { x: 0, y: 0 };
  let down = false;

  return {
    async down(x, y) {
      current = { x, y };
      down = true;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
    },
    async move(x, y, steps = 1) {
      // Interpolate like Playwright's `mouse.move({ steps })` so dnd-kit gets the intermediate
      // touchmove events its collision detection needs to resolve a drop target.
      const from = current;
      for (let i = 1; i <= steps; i += 1) {
        const px = from.x + ((x - from.x) * i) / steps;
        const py = from.y + ((y - from.y) * i) / steps;
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: px, y: py }],
        });
      }
      current = { x, y };
    },
    async up() {
      // No-op when nothing is pressed so the retry loop's pre-emptive release (mirroring the
      // mouse `pickUp`) doesn't dispatch an invalid lone touchEnd.
      if (!down) return;
      down = false;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    },
  };
}

/**
 * Press a row with a finger and hold it still past the touch sensor's ~250ms activation delay,
 * retrying until the drag actually lifts. Like the mouse `pickUp`, a press fired before the
 * page has hydrated is swallowed (no React touch handler yet), so we retry the press until the
 * row dims (the `opacity-40` applied only while dragging) to wait hydration out.
 *
 * Leaves the finger DOWN, mid-drag; the caller glides to the target and releases.
 */
export async function touchPickUp(
  page: Page,
  touch: TouchDriver,
  source: Locator,
): Promise<{ cx: number; cy: number }> {
  const box = await source.boundingBox();
  if (box === null) throw new Error('drag source has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await expect(async () => {
    await touch.up(); // release any half-started press from a previous attempt
    await touch.down(cx, cy);
    // Hold still, staying within the 5px tolerance, until the 250ms delay timer lifts the row.
    await page.waitForTimeout(350);
    await expect(page.locator('.opacity-40')).toBeVisible({ timeout: 750 });
  }).toPass({ timeout: 10_000 });

  return { cx, cy };
}
