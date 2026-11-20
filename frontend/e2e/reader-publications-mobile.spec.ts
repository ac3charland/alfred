import { makeCommAccount, makeReaderPublication } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A publication card's title row at a phone width (ALF-350). The row is one non-wrapping flex
 * line — name, provenance chip, kind chip, pause toggle — and only the name is meant to give way,
 * by truncating. The name sits in `EditableTextField`'s display button, a flex item whose
 * automatic minimum width is its content's, so without `min-w-0` it never shrank: `truncate` had
 * nothing to clip and a long name shoved the kind chip and the toggle out past the card's edge.
 * Layout only happens in a real browser, so this is the suite that can see it.
 */
test.use({ viewport: { width: 390, height: 844 } });

const LONG_NAME = 'Some Substack I stopped reading';

test('a long publication name truncates instead of pushing the title row off the card', async ({
  page,
  seed,
}) => {
  await seed({
    commAccounts: [makeCommAccount('Gmail personal', { key: 'gmail-personal' })],
    readerPublications: [
      makeReaderPublication(LONG_NAME, { handle: 'quietletter@substack.com', source: 'auto' }),
    ],
  });
  await page.goto('/reader/publications');

  const card = page.getByRole('listitem').filter({ hasText: LONG_NAME });
  const toggle = card.getByRole('button', { name: 'Enabled' });
  await expect(toggle).toBeVisible();

  const cardBox = await card.boundingBox();
  const toggleBox = await toggle.boundingBox();
  if (cardBox === null || toggleBox === null) throw new Error('card or toggle not laid out');

  // The toggle — the row's last control — stays inside the card.
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);

  // The name gives way by clipping: its text is wider than the box it's shown in.
  const name = card.getByText(LONG_NAME, { exact: true });
  const clipped = await name.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(clipped).toBe(true);
});
