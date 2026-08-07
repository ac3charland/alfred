/**
 * The colon-triggered project suggestions on the Inbox capture box — the real-keyboard arc.
 *
 * Only a real browser proves that Enter reaches the textarea's key handler and is claimed by the
 * open list instead of submitting the form: a synthetic event can't distinguish the two. The rest
 * of the journey (type the title, capture, read the row back) rides the same mock backend the
 * inbox suite uses, so the assertion at the end is the genuine prefix classification.
 */
import { makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

const ALFRED_ID = '11111111-1111-4111-8111-111111111111';
const RELAY_ID = '22222222-2222-4222-8222-222222222222';

test('a leading colon suggests projects; ↓ ↵ inserts the key prefix and the capture lands as Code', async ({
  page,
  seed,
}) => {
  await seed({
    items: [makeItem('Existing thought')],
    projects: [
      makeProject('Alfred', { id: ALFRED_ID, key: 'ALF' }),
      makeProject('Relay', { id: RELAY_ID, key: 'RLP' }),
    ],
  });
  await page.goto('/?view=inbox');

  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.click();

  // No colon, no dropdown — an ordinary capture never summons one.
  await box.pressSequentially('buy milk');
  await expect(page.getByRole('listbox', { name: 'Projects' })).toBeHidden();
  await box.fill('');

  // A leading colon lists every project, first row active.
  await box.press(':');
  const listbox = page.getByRole('listbox', { name: 'Projects' });
  await expect(listbox.getByRole('option')).toHaveText([/Alfred/, /Relay/]);

  // Typing filters it down to the one match.
  await box.pressSequentially('al');
  await expect(listbox.getByRole('option')).toHaveText([/Alfred/]);

  // Back to the full list, then arrow to Relay and back to Alfred — the list is keyboard-driven.
  await box.press('Backspace');
  await box.press('Backspace');
  await expect(listbox.getByRole('option')).toHaveCount(2);
  await box.press('ArrowDown');
  await box.press('ArrowUp');

  // Enter commits the suggestion instead of capturing the half-typed ":".
  await box.press('Enter');
  await expect(box).toHaveValue('ALF: ');
  await expect(listbox).toBeHidden();
  // Nothing was captured — the seeded row is still the only one in the list.
  await expect(page.getByRole('list', { name: 'Tasks' }).getByRole('listitem')).toHaveCount(1);

  // Finish the capture through the ordinary path: the prefix classifies it as Code.
  await box.pressSequentially('add dark mode');
  await box.press('Enter');

  const row = page.getByRole('listitem').filter({ hasText: 'Add dark mode' }).first();
  await expect(row.getByText('Code', { exact: true })).toBeVisible();
  await expect(row.getByText('ALF', { exact: true })).toBeVisible();
});

test('Escape dismisses the list and leaves the text alone, so Enter captures it verbatim', async ({
  page,
  seed,
}) => {
  await seed({ projects: [makeProject('Alfred', { id: ALFRED_ID, key: 'ALF' })] });
  await page.goto('/?view=inbox');

  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.click();
  await box.press(':');
  await box.pressSequentially('alf thoughts');

  const listbox = page.getByRole('listbox', { name: 'Projects' });
  await expect(listbox).toBeVisible();

  await box.press('Escape');
  await expect(listbox).toBeHidden();
  await expect(box).toHaveValue(':alf thoughts');

  await box.press('Enter');
  await expect(page.getByRole('list', { name: 'Tasks' }).getByText(':alf thoughts')).toBeVisible();
});
