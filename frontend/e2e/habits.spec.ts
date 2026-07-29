import { makeHabit, makeHabitEntry } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The habit tracker's whole loop through the real stack: define a habit, log today, watch the
 * chain and the sidebar badge react, and prove it survived the round-trip by reloading.
 *
 * Everything here goes through the real routes and the real store — the only thing faked is
 * the database behind them.
 */

/** The browser's own today, which is the day the grid highlights and the badge counts. */
function localToday(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/** A local calendar date `count` days behind today — the same arithmetic the grid walks. */
function daysAgo(count: number): string {
  const then = new Date();
  then.setDate(then.getDate() - count);
  return `${String(then.getFullYear())}-${String(then.getMonth() + 1).padStart(2, '0')}-${String(
    then.getDate(),
  ).padStart(2, '0')}`;
}

test('creates a habit, logs today, and keeps it across a reload', async ({ page, seed }) => {
  await seed({});
  await page.goto('/priority');

  // ⌘K → Habits. The palette is the deep-link-free way in.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('option', { name: 'Habits' }).click();
  await expect(page).toHaveURL(/\/habits$/);
  await expect(page.getByText('No habits yet')).toBeVisible();

  // Build the reference habit as one sentence.
  await page.getByRole('button', { name: 'New habit' }).first().click();
  await page.getByLabel('Habit name').fill('Morning routine');

  await page.getByRole('button', { name: 'Add a criterion' }).click();
  await page.getByRole('button', { name: /A time/ }).click();
  await page.getByLabel('Label').fill('be up by');
  await page.getByLabel('No later than').fill('06:15');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Add a criterion' }).click();
  await page.getByRole('button', { name: /Yes \/ no/ }).click();
  await page.getByLabel('Label').fill('get outside for light');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /^Allowance:/ }).click();
  await page.getByRole('button', { name: '1 miss a week' }).click();

  await page.getByRole('button', { name: 'Create habit' }).click();

  // The empty state is replaced by the habit's card, with no page refresh.
  await expect(page.getByText('No habits yet')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();
  await expect(page.getByText('· every day · 1 miss / rolling week')).toBeVisible();

  // Today is outstanding, so the sidebar says so.
  await expect(page.getByLabel('1 not logged today')).toBeVisible();

  // Open today's cell and record both criteria.
  const today = localToday();
  const todayCell = page.locator(`[data-date="${today}"] button`);
  await todayCell.click();
  // `exact` matters: Playwright's getByText is case-insensitive by default, and the page's
  // legend already names every status in lowercase.
  await expect(page.getByText('Missed', { exact: true })).toBeVisible();

  // `exact` again: a logged cell's accessible name quotes every criterion label, so a
  // substring match would find the grid before it found the field.
  await page.getByLabel('be up by', { exact: true }).fill('06:04');
  await page.getByRole('button', { name: 'get outside for light', exact: true }).click();

  // The header re-derives from the criteria beneath it — it is never typed.
  await expect(page.getByText('Met', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // The cell now carries the verdict, and the badge has cleared.
  await expect(page.locator(`[data-date="${today}"]`)).toHaveAttribute('data-status', 'met');
  await expect(page.getByLabel('1 not logged today')).toBeHidden();

  // A hard reload re-reads everything from the database.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();
  await expect(page.locator(`[data-date="${today}"]`)).toHaveAttribute('data-status', 'met');
  await expect(page.getByLabel('1 not logged today')).toBeHidden();
});

test('skipping a day takes a second step and a reason, and the reason survives in the grid', async ({
  page,
  seed,
}) => {
  const habit = makeHabit('Morning routine', { started_on: '2026-01-01' });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  const today = localToday();
  await page.locator(`[data-date="${today}"] button`).click();

  // The overflow item opens a confirm step rather than skipping the day outright.
  await page.getByRole('button', { name: /More options/ }).click();
  await page.getByRole('menuitem', { name: 'Mark as skipped…' }).click();
  await expect(
    page.getByText(
      "This day won't count for or against the habit, and won't spend your allowance.",
    ),
  ).toBeVisible();

  const commit = page.getByRole('button', { name: 'Skip this day' });
  await expect(commit).toBeDisabled();

  await page.getByLabel('Reason for skipping').fill('flu, off all week');
  await expect(commit).toBeEnabled();
  await commit.click();

  // The reason is retrievable from the grid months later, without opening anything.
  await page.reload();
  await expect(page.locator(`[data-date="${today}"]`)).toHaveAttribute('data-status', 'skipped');
  await expect(
    page.locator(`[data-date="${today}"] button`).and(page.locator('[aria-label*="skipped: flu"]')),
  ).toBeVisible();
});

test('filling a day behind the start date moves the habit back to it, and it sticks', async ({
  page,
  seed,
}) => {
  // The shape that made this a bug: a habit defined today over a routine already being kept, so
  // every day worth backfilling sits before `started_on`.
  const habit = makeHabit('Morning routine', { started_on: localToday() });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  const backfill = daysAgo(3);
  await expect(page.locator(`[data-date="${backfill}"]`)).toHaveAttribute(
    'data-status',
    'not_applicable',
  );

  await page.locator(`[data-date="${backfill}"] button`).click();
  await expect(page.getByText('Logging this moves the start back')).toBeVisible();

  await page.getByRole('button', { name: 'Outside for light', exact: true }).click();
  await expect(page.getByText('Met', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  // The day is scored, and the days between it and the old start have joined the habit's life —
  // they read as unlogged now, which is the whole point: they are days it was running.
  await page.reload();
  await expect(page.locator(`[data-date="${backfill}"]`)).toHaveAttribute('data-status', 'met');
  await expect(page.locator(`[data-date="${daysAgo(2)}"]`)).toHaveAttribute(
    'data-status',
    'unknown',
  );
  await expect(page.locator(`[data-date="${daysAgo(4)}"]`)).toHaveAttribute(
    'data-status',
    'not_applicable',
  );
});

test('a chain crosses a forgiven day in grey and breaks where the allowance runs out', async ({
  page,
  seed,
}) => {
  const habit = makeHabit('Morning routine', { started_on: '2026-06-01', allowance: 1 });
  await seed({
    habits: [habit],
    habitEntries: [
      // A run, one forgiven partial inside it, then two spent days back to back.
      makeHabitEntry(habit.id, '2026-06-01'),
      makeHabitEntry(habit.id, '2026-06-02'),
      makeHabitEntry(habit.id, '2026-06-03', { status: 'partial' }),
      makeHabitEntry(habit.id, '2026-06-04'),
      makeHabitEntry(habit.id, '2026-06-05', { status: 'missed' }),
      makeHabitEntry(habit.id, '2026-06-06', { status: 'missed' }),
      makeHabitEntry(habit.id, '2026-06-07'),
    ],
  });
  await page.goto('/habits');

  // Grey either side of the forgiven day, lit where the run was earned…
  await expect(page.locator('[data-date="2026-06-02"] [data-connector="out"]')).toHaveAttribute(
    'data-tone',
    'bridge',
  );
  await expect(page.locator('[data-date="2026-06-03"] [data-connector="out"]')).toHaveAttribute(
    'data-tone',
    'bridge',
  );
  await expect(page.locator('[data-date="2026-06-01"] [data-connector="out"]')).toHaveAttribute(
    'data-tone',
    'streak',
  );
  // …and nothing at all across the break, where two spent days share one rolling week.
  await expect(page.locator('[data-date="2026-06-06"] [data-connector="out"]')).toHaveCount(0);
});
