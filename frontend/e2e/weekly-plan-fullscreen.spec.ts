import { makeWeeklyPlan } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Tapping the week plan on a phone reopens it full screen.
 *
 * This is the suite that actually proves the behaviour, for two reasons jsdom can't cover:
 * the affordance is gated with Tailwind's `md:` prefix, which keys on the **real browser
 * viewport**, and the plan is an `<iframe srcDoc>` — jsdom never renders a frame's document, so
 * only here can we assert the plan really paints (and runs its own script) at full screen.
 */

/** A stand-in for the generated plan: its own styling, plus a script that fills a slot. */
const planDocument = (heading: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${heading}</title><style>
  body { max-width: 780px; margin: 0 auto; padding: 2rem; font-family: sans-serif; }
  h1 { color: #0d7d7d; }
</style></head><body>
  <h1>${heading}</h1>
  <p id="today">…</p>
  <script>document.getElementById('today').textContent = 'Today is highlighted';</script>
</body></html>`;

const HEADING = 'Week 12: Jul 18 – Jul 25, 2026';
const SEED = { weeklyPlans: [makeWeeklyPlan(planDocument(HEADING))] };
const TAP_LABEL = 'View the week plan full screen';
const PHONE = { width: 390, height: 844 };

test.describe('at a phone width', () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test('tapping the plan fills the screen with the document', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/plan');

    // The affordance is visible before the tap — an invisible layer would leave the plan
    // looking inert.
    const tap = page.getByRole('button', { name: TAP_LABEL });
    await expect(tap).toBeVisible();
    await expect(tap.getByText('Full screen')).toBeVisible();

    await tap.tap();

    // The plan paints inside the full-screen frame, and its own script ran there too — the
    // full-screen frame grants the same `allow-scripts` sandbox as the inline one.
    const frame = page.frameLocator('[data-testid="weekly-plan-html-fullscreen"]');
    await expect(frame.getByRole('heading', { name: HEADING })).toBeVisible();
    await expect(frame.getByText('Today is highlighted')).toBeVisible();

    // "Full screen" is literal: the dialog covers the whole phone viewport. `100dvh` is what
    // makes the height claim hold with the browser's chrome collapsed.
    const box = await page.getByRole('dialog').boundingBox();
    expect(box?.width).toBe(PHONE.width);
    expect(box?.height).toBe(PHONE.height);
  });

  test('the frame itself gets the screen, minus only the title row', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/plan');
    await page.getByRole('button', { name: TAP_LABEL }).tap();

    // The point of the feature is reading room, so the frame must actually take the leftover
    // height rather than collapsing or overflowing past the bottom of the screen.
    const frameBox = await page.getByTestId('weekly-plan-html-fullscreen').boundingBox();
    const titleBox = await page.getByRole('heading', { name: /^Week Plan · / }).boundingBox();
    expect(frameBox?.width).toBe(PHONE.width);
    expect(frameBox?.height).toBeGreaterThan(PHONE.height - 100);
    expect((frameBox?.y ?? 0) + (frameBox?.height ?? 0)).toBeLessThanOrEqual(PHONE.height);
    // Below the title row, not overlapping it.
    expect(frameBox?.y).toBeGreaterThanOrEqual((titleBox?.y ?? 0) + (titleBox?.height ?? 0));
  });

  test('the × dismiss returns to the inline plan', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/plan');
    await page.getByRole('button', { name: TAP_LABEL }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('button', { name: 'Close full screen' }).tap();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('weekly-plan-html-fullscreen')).toHaveCount(0);
    // The inline plan is still there, still painted, so dismissing is a return and not a dead end.
    await expect(
      page.frameLocator('[data-testid="weekly-plan-html"]').getByRole('heading', { name: HEADING }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: TAP_LABEL })).toBeVisible();
  });

  test('Escape closes it too', async ({ page, seed }) => {
    await seed(SEED);
    await page.goto('/plan');
    await page.getByRole('button', { name: TAP_LABEL }).tap();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('shows no plan and no tap target when nothing is uploaded', async ({ page, seed }) => {
    await seed({});
    await page.goto('/plan');

    await expect(page.getByText(/no week plan uploaded yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: TAP_LABEL })).toHaveCount(0);
  });
});

test.describe('at a desktop width', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('leaves the roomy inline frame directly interactive — no tap layer', async ({
    page,
    seed,
  }) => {
    await seed(SEED);
    await page.goto('/plan');

    // The inline plan renders as it always has…
    await expect(
      page.frameLocator('[data-testid="weekly-plan-html"]').getByRole('heading', { name: HEADING }),
    ).toBeVisible();
    // …and nothing covers it: the `md:hidden` layer is display:none, so a click at desktop
    // width reaches the frame rather than opening a dialog.
    await expect(page.getByRole('button', { name: TAP_LABEL })).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
