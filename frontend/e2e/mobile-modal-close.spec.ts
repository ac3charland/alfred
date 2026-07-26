import type { Page } from '@playwright/test';

import {
  type SeedState,
  makeCodeStory,
  makeEpic,
  makeItem,
  makeProject,
} from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The story detail modal's "×" dismiss must be a real ≥44px tap target on a phone (ALF-138).
 * It used to be `p-1` around a text glyph — roughly 24px square, well under the size a thumb
 * reliably hits, and the one control every reader of the modal reaches for. The fix enlarges
 * the button's own box on mobile and reverts at `md:`, so the dense desktop header is unchanged.
 *
 * Measured in a real browser because that's the only place the assertion means anything: a
 * jsdom test can confirm the classes are present, but only a layout engine reports the box the
 * thumb actually hits — and only a real viewport resolves the `md:` breakpoint.
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const STORY_ITEM_ID = '44444444-4444-4444-8444-444444444444';

/** The minimum touch target the rest of the app's mobile controls use (ALF-86, ALF-98). */
const MIN_TAP_TARGET_PX = 44;

/** Seed one board story and open its detail modal, returning the dialog locator. */
async function openDetailModal(page: Page, seed: (state: SeedState) => Promise<void>) {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Implement the allow-list parser', {
    id: STORY_ITEM_ID,
    item_type: 'code',
  });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 5,
    ref: 'ALF-5',
    factory_state: 'ready_for_dev',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto(`/code/${PROJECT_ID}`);
  await page.getByRole('button', { name: /open ALF-5/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('phone viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the story modal close is a ≥44px tap target and still dismisses', async ({
    page,
    seed,
  }) => {
    const dialog = await openDetailModal(page, seed);
    const box = await dialog.getByRole('button', { name: 'Close' }).boundingBox();

    expect(box).not.toBeNull();
    expect(box?.width).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);
    expect(box?.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET_PX);

    // The size assertion is the real pin (a synthetic near-miss can't demonstrate a tap-target
    // change — Chromium's own touch slop absorbs it). This click just holds the line that the
    // enlarged box still dismisses: the button IS the target, not an overlay stacked over it.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the enlarged close stays inside the dialog and the phone viewport', async ({
    page,
    seed,
  }) => {
    const dialog = await openDetailModal(page, seed);
    const box = await dialog.getByRole('button', { name: 'Close' }).boundingBox();
    const dialogBox = await dialog.boundingBox();

    // The button grew inside the dialog's padding rather than past its right edge.
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (dialogBox?.x ?? 0) + (dialogBox?.width ?? 0),
    );

    const overflowsHorizontally = await page.evaluate(() => {
      const doc = document.scrollingElement ?? document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 1;
    });
    expect(overflowsHorizontally).toBe(false);
  });
});

test.describe('desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the close stays dense at md+ (the enlargement is mobile-only)', async ({ page, seed }) => {
    const dialog = await openDetailModal(page, seed);
    const box = await dialog.getByRole('button', { name: 'Close' }).boundingBox();

    // Back to the compact header close a pointer device doesn't need enlarged — this is what
    // stops the `md:` revert from silently rotting into "44px everywhere".
    expect(box?.height).toBeLessThan(MIN_TAP_TARGET_PX);
  });
});
