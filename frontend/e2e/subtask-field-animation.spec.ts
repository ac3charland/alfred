/**
 * Subtask entry-field enter/exit animation — end-to-end coverage for ALF-66.
 *
 * The inline "Add subtask" field grows in (height + fade) when opened and shrinks
 * back out when dismissed. The exit is driven by the collapse keyframe's
 * `animationend`, which jsdom can't run — so this real-browser test is what proves
 * the field actually finishes its exit and unmounts (not just that it's requested).
 */
import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

test('the add-subtask field animates in on open and out on dismiss', async ({ page, seed }) => {
  await seed({ items: [makeItem('Plan the trip', { item_type: 'task' })] });
  await page.goto('/?view=inbox');

  // Open it — the field grows in via the expand keyframe and becomes usable.
  await page.getByRole('button', { name: 'Add subtask' }).click();
  const reveal = page.getByTestId('animated-height-reveal');
  await expect(reveal).toHaveClass(/animate-expand-y/);
  const field = page.getByPlaceholder('Add subtask…');
  await expect(field).toBeVisible();

  // Dismiss it — the field plays the collapse keyframe, then unmounts when the
  // animation ends (the real-browser path jsdom can't exercise).
  await field.press('Escape');
  await expect(field).toHaveCount(0);
});
