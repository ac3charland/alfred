import { localDaysAgo, localToday, makeHabit, makeHabitEntry } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The habit tracker's whole loop through the real stack: define a habit, log today, watch the
 * chain and the sidebar badge react, and prove it survived the round-trip by reloading.
 *
 * Everything here goes through the real routes and the real store — the only thing faked is
 * the database behind them.
 */

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

  // The rail beside the grid moved in the same frame as the cell — no refetch, no refresh.
  const currentStreak = page.locator('[data-figure="current-streak"]');
  await expect(currentStreak).toContainText('1');
  await expect(page.getByRole('group', { name: 'Morning routine stats' })).toBeVisible();

  // A hard reload re-reads everything from the database.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();
  await expect(page.locator(`[data-date="${today}"]`)).toHaveAttribute('data-status', 'met');
  await expect(page.getByLabel('1 not logged today')).toBeHidden();
  // The number the tap painted and the number the server computes from all history are the
  // same number — which is the whole point of splicing the two rather than picking one.
  await expect(currentStreak).toContainText('1');
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

  const backfill = localDaysAgo(3);
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
  await expect(page.locator(`[data-date="${localDaysAgo(2)}"]`)).toHaveAttribute(
    'data-status',
    'unknown',
  );
  await expect(page.locator(`[data-date="${localDaysAgo(4)}"]`)).toHaveAttribute(
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

test('retargets a criterion without moving a logged day, then archives, restores and deletes', async ({
  page,
  seed,
}) => {
  // A habit with real history: the retarget has to be visibly inert for it, and the cadence
  // slots have to be frozen because of it.
  const habit = makeHabit('Morning routine', {
    started_on: localDaysAgo(3),
    criteria: [{ key: 'wake', label: 'be up by', kind: 'time', target: 420, comparator: 'lte' }],
  });
  const logged = localDaysAgo(3);
  await seed({
    habits: [habit],
    habitEntries: [
      // 06:50 met the original 07:00 target. It must still read met under 06:15.
      makeHabitEntry(habit.id, logged, { status: 'met', results: { wake: 410 } }),
    ],
  });
  await page.goto('/habits');

  await expect(page.locator(`[data-date="${logged}"]`)).toHaveAttribute('data-status', 'met');

  // ── Retarget 07:00 → 06:15 ────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Options for Morning routine' }).click();
  await page.getByRole('menuitem', { name: 'Edit habit…' }).click();
  await expect(page.getByLabel('Habit name')).toHaveValue('Morning routine');

  // The cadence is frozen, and clicking it explains rather than doing nothing.
  await page.getByRole('button', { name: /^Locked: Allowance:/ }).click();
  await expect(page.getByText('Fixed for this habit')).toBeVisible();
  await expect(page.getByText(/1 day is already logged/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Edit criterion: be up by 07:00' }).click();
  await page.getByLabel('No later than').fill('06:15');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();

  // The definition moved; the day it was scored under did not. This is the whole argument for
  // letting criteria be editable at all.
  await expect(page.getByRole('button', { name: /^Options for/ })).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-date="${logged}"]`)).toHaveAttribute('data-status', 'met');

  // ── Archive → the Archived section → unarchive ────────────────────────────
  await page.getByRole('button', { name: 'Options for Morning routine' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeHidden();
  const archived = page.getByRole('button', { name: 'Archived (1)' });
  await expect(archived).toBeVisible();
  await archived.click();
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();

  // The round trip through the database kept the day, and the archive flag really cleared.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();
  await expect(page.locator(`[data-date="${logged}"]`)).toHaveAttribute('data-status', 'met');

  // ── Delete, behind the confirm ────────────────────────────────────────────
  await page.getByRole('button', { name: 'Options for Morning routine' }).click();
  await page.getByRole('menuitem', { name: 'Delete habit…' }).click();
  await expect(page.getByRole('heading', { name: 'Delete “Morning routine”?' })).toBeVisible();
  await expect(page.getByText(/1 day, since/)).toBeVisible();

  // Cancel first: the confirm is the gate, so backing out must leave the habit alone.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Morning routine' })).toBeVisible();

  await page.getByRole('button', { name: 'Options for Morning routine' }).click();
  await page.getByRole('menuitem', { name: 'Delete habit…' }).click();
  await page.getByRole('button', { name: 'Delete habit' }).click();

  await expect(page.getByText('No habits yet')).toBeVisible();
  // Gone for real: the cascade took the entry with it, and a reload proves the row is not there.
  await page.reload();
  await expect(page.getByText('No habits yet')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Archived/ })).toBeHidden();
});

test('a cadence slot opened from the card menu stays open long enough to use', async ({
  page,
  seed,
}) => {
  // A regression guard for a focus race, which is why it lives here rather than in jsdom: the
  // card's ⋯ menu restores focus to its trigger asynchronously when it closes, and that late
  // jump used to reach out of the dialog the menu had just opened and shut any popover inside it
  // that doesn't autofocus its own content — the days and allowance slots.
  const habit = makeHabit('Cold shower', { started_on: localToday(), allowance: 1 });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  await page.getByRole('button', { name: 'Options for Cold shower' }).click();
  await page.getByRole('menuitem', { name: 'Edit habit…' }).click();

  // Nothing is logged, so the cadence is still open for editing.
  await page.getByRole('button', { name: /^Allowance:/ }).click();
  await page.getByRole('button', { name: '3 misses a week', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Allowance: 3 misses a week' })).toBeVisible();

  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.reload();
  await expect(page.getByText('· every day · 3 misses / rolling week')).toBeVisible();
});

test('the stats rail stays inside the card, and the grid takes the overflow', async ({
  page,
  seed,
}) => {
  // A layout regression guard, and it has to run in a real browser: the rail must not shrink (its
  // figures would wrap) so the GRID is what has to give way. If the grid can't shrink below its
  // 27 columns of squares, the row grows past the card and pushes the rail out through its right
  // edge — which reads as the numbers hanging in space beside the card.
  const habit = makeHabit('Morning routine', { started_on: '2026-01-01' });
  await seed({ habits: [habit], habitEntries: [makeHabitEntry(habit.id, localDaysAgo(2))] });
  await page.goto('/habits');

  // Defaults chosen so a missing box FAILS the assertion rather than skipping it: an absent row
  // collapses to zero width, an absent rail to an edge no container can contain.
  const row = (await page.locator('section:has(h2) > div').first().boundingBox()) ?? {
    x: 0,
    width: 0,
  };
  const rail = (await page.getByRole('group', { name: 'Morning routine stats' }).boundingBox()) ?? {
    x: Number.POSITIVE_INFINITY,
    width: 0,
  };

  expect(rail.x + rail.width).toBeLessThanOrEqual(row.x + row.width + 1);

  // And the overflow really did go to the grid's own scroller rather than nowhere.
  const scroller = page.locator('[data-testid="history-scroll"]');
  const { scrollWidth, clientWidth } = await scroller.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
});
