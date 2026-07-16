import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Mobile Safari auto-zooms into any focused form control whose font-size is under 16px, then
 * strands the viewport zoomed in — the user has to pinch back out by hand (ALF-115). Our dense
 * UI renders most fields at text-sm (14px), and the item Notes editor at 13.5px, so tapping
 * them on a phone tripped that zoom. The fix is a global, coarse-pointer-only rule that lifts
 * every input/textarea/select to a 16px minimum; these tests pin that the fields the ticket
 * flagged now render at ≥16px on a touch phone.
 *
 * `hasTouch: true` flips the `@media (pointer: coarse)` match that gates the rule; the
 * phone-width viewport keeps the row's ⋯ menu permanently visible (the actions are hover-revealed
 * only at md+), so the Notes and subtask fields are reachable through it without a hover the touch
 * device can't do. On mobile the inline "+" collapses into that ⋯ menu's "Add subtask" item
 * (ALF-118), so the subtask field is opened from the menu here too.
 */
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

function task(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

function fontSizePx(locator: import('@playwright/test').Locator) {
  return locator.evaluate((element) =>
    Math.round(Number.parseFloat(getComputedStyle(element).fontSize)),
  );
}

test('the item Notes editor renders at ≥16px on a touch phone (no focus zoom)', async ({
  page,
  seed,
}) => {
  await seed({ items: [task('Triage the production bug')] });
  await page.goto('/?view=inbox');

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Triage the production bug')).toBeVisible();

  // Open the row's actions → Open details, which reveals the auto-saving Notes editor.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open details' }).click();

  const notes = page.getByRole('textbox', { name: 'Notes' });
  await expect(notes).toBeVisible();
  expect(await fontSizePx(notes)).toBeGreaterThanOrEqual(16);
});

test('the subtask creation field renders at ≥16px on a touch phone (no focus zoom)', async ({
  page,
  seed,
}) => {
  await seed({ items: [task('Plan the trip')] });
  await page.goto('/?view=inbox');

  // The inline "+" is desktop-only now (ALF-118); on this touch phone the add-subtask affordance
  // lives in the row's ⋯ menu, directly beneath "Open details".
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Add subtask' }).click();

  const subtaskBox = page.getByPlaceholder('Add subtask…');
  await expect(subtaskBox).toBeVisible();
  expect(await fontSizePx(subtaskBox)).toBeGreaterThanOrEqual(16);
});
