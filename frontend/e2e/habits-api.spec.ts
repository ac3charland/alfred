import { INGEST_API_KEY, makeHabit, makeHabitEntry } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * `GET /api/habits` and `PUT /api/habits/[id]/entries` through the whole stack — the read and
 * the write the productivity coach actually makes, in the order it makes them.
 *
 * Deliberately keyed-only, with the stored browser session cleared: a keyed caller carries no
 * cookie, so this is the case where reading through the wrong Supabase client would answer
 * `200` with an empty list and look like "the owner has no habits".
 */

test.use({ storageState: { cookies: [], origins: [] } });

/** Today in UTC — the zone every request below names, so the numbers are reproducible. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `days` before today, as a `YYYY-MM-DD` calendar date. */
function daysAgo(days: number): string {
  const date = new Date(`${utcToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const HABIT_ID = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8';

/**
 * The epic's worked example: one week, allowance 1, a single `partial` mid-week. The run
 * survives the forgiven day but does not count it, and the week's one allowance is spent.
 *
 * The seeded days end YESTERDAY, leaving today unlogged — which is the state the coach finds a
 * habit in when it is asked to log the morning it just heard about.
 */
const habit = makeHabit('Morning routine', {
  id: HABIT_ID,
  allowance: 1,
  started_on: daysAgo(7),
  sort_order: 1,
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
  ],
});

const week = [7, 6, 5, 4, 3, 2, 1].map((offset) =>
  makeHabitEntry(HABIT_ID, daysAgo(offset), {
    // The fifth day back is the forgiven one — up on time, but no light.
    ...(offset === 5
      ? { status: 'partial' as const, results: { wake: 362, light: false } }
      : { status: 'met' as const, results: { wake: 364, light: true } }),
  }),
);

interface HabitsResponse {
  today: string;
  timezone: string;
  window: { from: string; to: string };
  habits: {
    id: string;
    name: string;
    stats: { current_streak: number; allowance_remaining: number; met_days_total: number };
    entries: { date: string; status: string }[];
  }[];
}

test('reads a habit’s numbers with the ingest key, then logs a day and sees them move', async ({
  request,
  seed,
}) => {
  await seed({ habits: [habit], habitEntries: week });

  const read = await request.get('/api/habits?tz=UTC', {
    headers: { 'x-api-key': INGEST_API_KEY },
  });
  expect(read.status()).toBe(200);
  const before = (await read.json()) as HabitsResponse;

  // A keyed caller with no session gets the owner's real data, not an RLS-empty list.
  expect(before.habits).toHaveLength(1);
  expect(before.habits[0]?.name).toBe('Morning routine');
  expect(before.today).toBe(utcToday());
  expect(before.timezone).toBe('UTC');

  // Six met days across a seven-day run: the forgiven day was not earned, and it spent the
  // week's one allowance.
  expect(before.habits[0]?.stats.current_streak).toBe(6);
  expect(before.habits[0]?.stats.allowance_remaining).toBe(0);
  expect(before.habits[0]?.entries.map((entry) => entry.date)).not.toContain(utcToday());

  // The write half of the loop: send evidence, let the server score it.
  const write = await request.put(`/api/habits/${HABIT_ID}/entries`, {
    headers: { 'x-api-key': INGEST_API_KEY },
    data: { tz: 'UTC', results: { wake: 360, light: true } },
  });
  expect(write.status()).toBe(200);

  const reread = await request.get('/api/habits?tz=UTC', {
    headers: { 'x-api-key': INGEST_API_KEY },
  });
  const after = (await reread.json()) as HabitsResponse;

  // Today appears, scored `met` from the results alone, and the run grows by exactly it.
  expect(after.habits[0]?.entries[0]).toMatchObject({ date: utcToday(), status: 'met' });
  expect(after.habits[0]?.stats.current_streak).toBe(7);
  expect(after.habits[0]?.stats.met_days_total).toBe(7);
});

test('keeps the all-history scalars still while the window moves the counts', async ({
  request,
  seed,
}) => {
  await seed({ habits: [habit], habitEntries: week });

  const wideResponse = await request.get('/api/habits?tz=UTC', {
    headers: { 'x-api-key': INGEST_API_KEY },
  });
  const wide = (await wideResponse.json()) as HabitsResponse;

  const narrowResponse = await request.get(`/api/habits?tz=UTC&from=${daysAgo(1)}`, {
    headers: { 'x-api-key': INGEST_API_KEY },
  });
  const narrow = (await narrowResponse.json()) as HabitsResponse;

  expect(narrow.window.from).toBe(daysAgo(1));
  // The window carries fewer entries…
  expect(narrow.habits[0]?.entries).toHaveLength(1);
  expect(wide.habits[0]?.entries).toHaveLength(7);
  // …but the streak and the banked days are all-history figures and do not move.
  expect(narrow.habits[0]?.stats.current_streak).toBe(6);
  expect(narrow.habits[0]?.stats.met_days_total).toBe(6);
});

test('refuses an unauthenticated read rather than answering with an empty list', async ({
  request,
  seed,
}) => {
  await seed({ habits: [habit], habitEntries: week });

  const response = await request.get('/api/habits');

  expect(response.status()).toBe(401);
  expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
});
