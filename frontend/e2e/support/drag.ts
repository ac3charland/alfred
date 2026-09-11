import { type Locator, type Page, expect } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A locator's bounding box, asserting it exists. Keeps the null-check inside a helper so it
 * doesn't trip the `playwright/no-conditional-in-test` rule when used from a test body.
 */
export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no bounding box');
  return box;
}

/**
 * Press a draggable row and clear dnd-kit's 8px activation distance, retrying until the drag
 * actually picks up. A drag that starts before the page has finished hydrating — which can
 * happen under load for a row dragged immediately after navigation — is treated by the
 * browser as a text selection, not a drag. Retrying the press until the row dims (the
 * `opacity-40` that's applied only while a row is being dragged) waits hydration out.
 *
 * Leaves the pointer DOWN, mid-drag; the caller glides to the target and releases.
 */
export async function pickUp(page: Page, source: Locator): Promise<void> {
  const box = await source.boundingBox();
  if (box === null) throw new Error('drag source has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await expect(async () => {
    await page.mouse.up(); // release any half-started press from a previous attempt
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 16, cy, { steps: 5 });
    await expect(page.locator('.opacity-40')).toBeVisible({ timeout: 750 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Click `target` after a drop and wait for `opened` to appear, retrying until the click lands.
 *
 * dnd-kit deliberately swallows the click that ends a drag: on activation its pointer sensor
 * adds a capture-phase `click` listener on `document` that calls `stopPropagation`, and
 * `detach()` only removes it 50ms AFTER `mouseup`. A couple of web-first assertions on the
 * dropped card can resolve well inside that window on a fast machine, so the next click is
 * silently eaten — the button takes focus and nothing opens. Retrying (clicking only while
 * `opened` is still absent, so an open dialog is never clicked shut) waits the window out
 * without a fixed sleep.
 */
export async function clickAfterDrop(target: Locator, opened: Locator): Promise<void> {
  await expect(async () => {
    const alreadyOpen = await opened.isVisible();
    if (!alreadyOpen) await target.click();
    await expect(opened).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
