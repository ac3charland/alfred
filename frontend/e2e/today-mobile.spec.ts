import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Today on a phone (ALF-349): a triage row used to put its due chip, priority chip and folder
 * label on the same line as the title, so on a 390px screen they squeezed the truncating title
 * down to a few characters. Below `md` the meta now drops to its own line under the title, so the
 * title keeps the row's full width and never shares a line with the chips.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** A local `YYYY-MM-DD` due date for today. */
function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

const TITLE = 'Renew the car registration before the grace period ends';

test('a Today row keeps its title clear of the chips on a phone', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Household admin', { id: 'home' })],
    items: [
      makeItem(TITLE, {
        item_type: 'task',
        folder_id: 'home',
        due_date: today(),
        priority: 'high',
      }),
    ],
  });
  await page.goto('/today');

  const row = page.getByRole('list', { name: 'Tasks due today' }).getByRole('listitem').first();
  const title = row.getByRole('link', { name: TITLE });
  await expect(title).toBeVisible();

  const titleBox = await title.boundingBox();
  const rowBox = await row.boundingBox();
  const metaBoxes = await Promise.all(
    [row.getByRole('button', { name: 'Priority: High' }), row.getByText('Household admin')].map(
      async (locator) => locator.boundingBox(),
    ),
  );
  if (!titleBox || !rowBox || metaBoxes.some((box) => !box)) throw new Error('row not laid out');

  // The title gets most of the row, not the sliver left beside three pieces of meta.
  expect(titleBox.width).toBeGreaterThan(rowBox.width * 0.7);
  // Every chip sits wholly below the title, never beside or over it.
  for (const box of metaBoxes) {
    expect(box?.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
  }
});
