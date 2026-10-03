import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Due times (ALF-161): a task can carry a wall-clock time beside its date, set from the due-date
 * picker's time row, shown on every due chip, ordering a day's tasks, and turning the chip red the
 * minute it passes.
 *
 * Pinned to en-US in Chicago so the labels ("3 PM") and the local "today" are deterministic.
 */
test.use({ locale: 'en-US', timezoneId: 'America/Chicago' });

function task(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

/** Saturday 3 October 2026, 14:59:30 in Chicago (CDT) — a moment before a 3 PM deadline. */
const BEFORE_THREE = new Date('2026-10-03T14:59:30-05:00');
const TODAY = '2026-10-03';

test('a time set from the detail panel survives a reload and reads on the row and in Today', async ({
  page,
  seed,
}) => {
  await page.clock.install({ time: new Date('2026-10-03T09:00:00-05:00') });
  await seed({ items: [task('Call the dentist', { due_date: TODAY })] });
  await page.goto('/?view=inbox');

  await expect(page.getByText('Call the dentist')).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open details' }).click();

  const panelChip = page.getByRole('button', { name: 'Due date', exact: true });
  await panelChip.click();
  await page.getByRole('button', { name: 'Add time' }).click();
  const field = page.getByLabel('Due time');
  await expect(field).toBeFocused();
  // The native <input type="time"> takes a 24-hour HH:MM fill in Chromium.
  await field.fill('15:00');
  await field.press('Enter');

  // Saved optimistically, and the picker stays open for a day pick.
  await expect(panelChip).toHaveText('Today 3 PM');
  await expect(field).toHaveValue('15:00');

  await page.reload();
  const rowChip = page.getByRole('button', { name: `Due date: ${TODAY} 15:00` });
  await expect(rowChip).toHaveText('Today 3 PM');

  await page.goto('/today');
  const list = page.getByRole('list', { name: 'Tasks due today' });
  await expect(list.getByRole('button', { name: `Due date: ${TODAY} 15:00` })).toHaveText(
    'Today 3 PM',
  );
});

test('a timed task due today turns red at its minute, without a reload', async ({ page, seed }) => {
  await page.clock.install({ time: BEFORE_THREE });
  await seed({
    items: [
      task('Call the dentist', { due_date: TODAY, due_time: '15:00:00' }),
      task('Water the plants', { due_date: TODAY }),
    ],
  });
  await page.goto('/today');

  const list = page.getByRole('list', { name: 'Tasks due today' });
  const timed = list.getByRole('button', { name: `Due date: ${TODAY} 15:00` });
  const untimed = list.getByRole('button', { name: `Due date: ${TODAY}`, exact: true });
  await expect(timed).toHaveClass(/text-accent-amber/);
  await expect(untimed).toHaveClass(/text-accent-amber/);

  await page.clock.fastForward('01:00');

  await expect(timed).toHaveClass(/text-accent-red/);
  // An untimed task stays amber all day.
  await expect(untimed).toHaveClass(/text-accent-amber/);
});

test('Today runs a day by time, the untimed task last whatever its priority', async ({
  page,
  seed,
}) => {
  await page.clock.install({ time: BEFORE_THREE });
  await seed({
    items: [
      task('Water the plants', { due_date: TODAY, priority: 'high' }),
      task('Pick up dry cleaning', { due_date: TODAY, due_time: '17:30:00', priority: 'low' }),
      task('Call the dentist', { due_date: TODAY, due_time: '15:00:00' }),
      task('Send standup notes', { due_date: TODAY, due_time: '09:00:00', priority: 'high' }),
      task('Renew passport', { due_date: '2026-10-02', priority: 'medium' }),
    ],
  });
  await page.goto('/today');

  const rows = page.getByRole('list', { name: 'Tasks due today' }).getByRole('listitem');
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText('Renew passport');
  await expect(rows.nth(1)).toContainText('Send standup notesToday 9 AM');
  await expect(rows.nth(2)).toContainText('Call the dentistToday 3 PM');
  await expect(rows.nth(3)).toContainText('Pick up dry cleaningToday 5:30 PM');
  await expect(rows.nth(4)).toContainText('Water the plants');
});

test('completing a recurring timed task spawns the next occurrence at the same time', async ({
  page,
  seed,
}) => {
  await page.clock.install({ time: new Date('2026-10-03T09:00:00-05:00') });
  await seed({
    items: [
      task('Take out the bins', {
        due_date: TODAY,
        due_time: '19:00:00',
        recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
      }),
    ],
  });
  await page.goto('/?view=inbox');
  await expect(page.getByRole('button', { name: `Due date: ${TODAY} 19:00` })).toHaveText(
    'Today 7 PM',
  );

  await page.getByRole('button', { name: 'Mark "Take out the bins" complete' }).click();

  // The optimistic next occurrence already carries the time…
  const next = page.getByRole('button', { name: 'Due date: 2026-10-04 19:00' });
  await expect(next).toHaveText('Tomorrow 7 PM');
  // …and so does the row the server spawned.
  await page.reload();
  await expect(next).toHaveText('Tomorrow 7 PM');
});
