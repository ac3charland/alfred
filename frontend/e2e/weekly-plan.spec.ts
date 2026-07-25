import { makeWeeklyPlan } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Week Plan view: a self-contained HTML document, uploaded through the keyed ingress
 * endpoint and rendered in a sandboxed frame that lets the document's own script run.
 *
 * `frameLocator` asserts INSIDE the frame — the end-to-end proof that `srcDoc` + the sandbox
 * actually paint, which no jsdom test can give (jsdom never renders an iframe's document).
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

/** The marker we plant on the page's global to detect a document reload. */
interface MarkerWindow {
  __survivedNav?: boolean;
}

test('navigates from the sidebar to the plan and renders it inside the frame', async ({
  page,
  seed,
}) => {
  await seed({ weeklyPlans: [makeWeeklyPlan(planDocument('Week 12: Jul 18 – Jul 25, 2026'))] });
  await page.goto('/priority');

  // A value in client memory only survives if the document is never reloaded.
  await page.evaluate(() => {
    (globalThis as MarkerWindow).__survivedNav = true;
  });

  await page.getByRole('link', { name: 'Week Plan' }).click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(await page.evaluate(() => (globalThis as MarkerWindow).__survivedNav)).toBe(true);

  // The document paints itself inside the sandboxed frame…
  const frame = page.frameLocator('[data-testid="weekly-plan-html"]');
  await expect(
    frame.getByRole('heading', { name: 'Week 12: Jul 18 – Jul 25, 2026' }),
  ).toBeVisible();
  // …and its own script ran, which is why the frame grants allow-scripts.
  await expect(frame.getByText('Today is highlighted')).toBeVisible();

  // The isolation is real in both directions: the plan's `body { max-width: 780px }` styles
  // the frame's document, never the app shell around it.
  const appBodyMaxWidth = await page.evaluate(
    () => globalThis.getComputedStyle(document.body).maxWidth,
  );
  expect(appBodyMaxWidth).toBe('none');
  await expect(frame.locator('body')).toHaveCSS('max-width', '780px');
});

test('deep-links to /plan and switches between archived weeks', async ({ page, seed }) => {
  await seed({
    weeklyPlans: [
      makeWeeklyPlan(planDocument('Week 11'), { uploaded_at: '2026-07-17T12:00:00Z' }),
      makeWeeklyPlan(planDocument('Week 12'), { uploaded_at: '2026-07-24T12:00:00Z' }),
    ],
  });

  await page.goto('/plan');

  // Newest first: the latest plan is what a hard load server-renders.
  const frame = page.frameLocator('[data-testid="weekly-plan-html"]');
  await expect(frame.getByRole('heading', { name: 'Week 12' })).toBeVisible();

  // Picking an older week fetches its document on demand and swaps the frame.
  await page.getByRole('combobox', { name: 'Week' }).selectOption({ label: 'Jul 17' });
  await expect(frame.getByRole('heading', { name: 'Week 11' })).toBeVisible();
});

test('shows the upload instruction when no plan has been uploaded', async ({ page, seed }) => {
  await seed({});

  await page.goto('/plan');

  await expect(page.getByText(/no week plan uploaded yet/i)).toBeVisible();
  await expect(page.getByTestId('weekly-plan-html')).toHaveCount(0);
  await expect(page.getByTestId('weekly-plan-upload-hint')).toContainText('/api/weekly-plans');
});
