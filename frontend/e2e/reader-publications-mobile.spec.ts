import type { Locator } from '@playwright/test';

import { makeCommAccount, makeReaderPublication } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * A publication card's title row at a phone width (ALF-350). The row is name, provenance chip,
 * kind chip and pause toggle. When a name is too long for all of them to share one line, the three
 * controls move down to a second row together and the name stays whole, never clipped. Before the
 * fix the row could neither wrap nor shrink: the name sat in `EditableTextField`'s display button,
 * a flex item whose automatic minimum width is its content's, so a long name shoved the kind chip
 * and the toggle out past the card's edge. Layout only happens in a real browser, so this is the
 * suite that can see it.
 */
test.use({ viewport: { width: 390, height: 844 } });

const LONG_NAME = 'Some Substack I stopped reading';
const SHORT_NAME = 'Stratechery';

async function box(locator: Locator) {
  const measured = await locator.boundingBox();
  if (measured === null) throw new Error('element not laid out');
  return measured;
}

test('a long publication name moves the controls to a second row instead of overflowing', async ({
  page,
  seed,
}) => {
  await seed({
    commAccounts: [makeCommAccount('Gmail personal', { key: 'gmail-personal' })],
    readerPublications: [
      makeReaderPublication(LONG_NAME, { handle: 'quietletter@substack.com', source: 'auto' }),
      makeReaderPublication(SHORT_NAME, { handle: 'email@stratechery.com', source: 'owner' }),
    ],
  });
  await page.goto('/reader/publications');

  const longCard = page.getByRole('listitem').filter({ hasText: LONG_NAME });
  const longToggle = longCard.getByRole('button', { name: 'Enabled' });
  await expect(longToggle).toBeVisible();

  const longName = longCard.getByText(LONG_NAME, { exact: true });
  const cardBox = await box(longCard);
  const nameBox = await box(longName);
  const toggleBox = await box(longToggle);
  const kindBox = await box(longCard.getByRole('button', { name: /^Summary type for/ }));
  const sourceBox = await box(longCard.getByText('auto', { exact: true }));

  // Every control stays inside the card.
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  // The name is shown whole, not clipped to an ellipsis.
  const clipped = await longName.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(clipped).toBe(false);
  // All three controls moved below the name, together.
  for (const control of [sourceBox, kindBox, toggleBox]) {
    expect(control.y).toBeGreaterThanOrEqual(nameBox.y + nameBox.height);
  }

  // A name short enough to share the line keeps everything on one row.
  const shortCard = page.getByRole('listitem').filter({ hasText: SHORT_NAME });
  const shortNameBox = await box(shortCard.getByText(SHORT_NAME, { exact: true }));
  const shortToggleBox = await box(shortCard.getByRole('button', { name: 'Enabled' }));
  expect(shortToggleBox.y).toBeLessThan(shortNameBox.y + shortNameBox.height);
});
