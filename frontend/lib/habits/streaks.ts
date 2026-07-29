import { type DateWindow, addDays, isoWeekday } from '@/lib/habits/dates';
import type { CellStatus, FormationStage, HabitDay, HabitStats } from '@/lib/habits/types';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * The streak engine — one walk, two consumers.
 *
 * The grid's connectors ARE this walk made visible: a link is drawn exactly where the run
 * continues, and greyed exactly where the rolling allowance absorbed a spent day. Deriving
 * "enough walk to draw links" separately from the scalars would mean writing the same rolling-
 * window logic twice and risking the two disagreeing, so both come from here.
 *
 * WINDOW LIMITATION: `metDaysTotal` and `longestStreak` are all-history figures, but the shell
 * seeds a bounded trailing window of entries. Handed that window, this module reads every day
 * before it as unlogged, so those two (and any run reaching back past the window) are figures
 * over the entries supplied, not over all history. `GET /api/habits` therefore hands it EVERY
 * entry and passes the requested span as the optional `window` argument, which scopes the hit
 * rate and the counts without touching the scalars.
 */

/**
 * The met-day count at which a habit is called possibly established — the top rung of the
 * ladder, and the marker the rail's meter fills toward. It is the MEDIAN of a wide observed
 * range (roughly 18 to 254 days), which is why every string the owner reads hedges it.
 */
export const ESTABLISHED_DAYS = 66;

/** The formation ladder, keyed to cumulative met days. It never decreases — banked days don't unbank. */
const LADDER: readonly { readonly from: number; readonly stage: FormationStage }[] = [
  { from: ESTABLISHED_DAYS, stage: 'possibly_established' },
  { from: 42, stage: 'nearing_automaticity' },
  { from: 14, stage: 'gaining_momentum' },
  { from: 0, stage: 'fully_deliberate' },
];

/** The rolling window the allowance is measured over: this day and the six before it. */
const ROLLING_WINDOW_DAYS = 7;

/**
 * A date this habit could ever be scored on — on a weekday in `active_days`, and before
 * `archived_at` if it has one. Deliberately silent about `started_on`: a start date is the one
 * part of the definition that MOVES when the owner backfills a day behind it, so "the habit
 * hadn't started yet" is a reason to offer the day rather than to rule it out.
 */
export function isTrackableDay(habit: Habit, date: string): boolean {
  if (habit.archived_at !== null && date >= habit.archived_at.slice(0, 10)) return false;
  return habit.active_days.includes(isoWeekday(date));
}

/**
 * A date the habit is scored on: on or after `started_on`, before `archived_at` if it has one,
 * and on a weekday in `active_days`. Anything else is never scored and appears in no
 * denominator — it is not a miss.
 */
export function isApplicableDay(habit: Habit, date: string): boolean {
  return date >= habit.started_on && isTrackableDay(habit, date);
}

/** This habit's entries, keyed by date. Rows for other habits are ignored. */
function entriesByDate(habit: Habit, entries: HabitEntry[]): Map<string, HabitEntry> {
  const byDate = new Map<string, HabitEntry>();
  for (const entry of entries) {
    if (entry.habit_id === habit.id) byDate.set(entry.entry_date, entry);
  }
  return byDate;
}

/** What a cell shows: a stored status, `unknown` for an applicable day with no row, else n/a. */
function cellStatus(
  habit: Habit,
  byDate: Map<string, HabitEntry>,
  date: string,
  today: string,
): CellStatus {
  if (date > today || !isApplicableDay(habit, date)) return 'not_applicable';
  return byDate.get(date)?.status ?? 'unknown';
}

/**
 * The facts the walk needs over one span of applicable days: which spend allowance, and which
 * break the chain outright.
 *
 * A spent day is an applicable day that came out `missed`, `partial`, or was never logged;
 * `met` and `skipped` cost nothing. TODAY, while still unlogged, is not spent — it hasn't
 * happened yet, and charging it would drop the streak to zero every morning until logged.
 *
 * A spent day BREAKS the chain only when the spent days in its rolling week exceed the
 * allowance. A broken day belongs to no run and no connector crosses it.
 */
function walkFacts(
  habit: Habit,
  byDate: Map<string, HabitEntry>,
  from: string,
  to: string,
  today: string,
): { days: string[]; spent: Set<string>; broken: Set<string> } {
  const days: string[] = [];
  const spent = new Set<string>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!isApplicableDay(habit, date)) continue;
    days.push(date);
    const entry = byDate.get(date);
    if (entry === undefined) {
      if (date !== today) spent.add(date);
    } else if (entry.status === 'missed' || entry.status === 'partial') {
      spent.add(date);
    }
  }

  // Slide the rolling window across the applicable days, counting spent ones inside it.
  const broken = new Set<string>();
  let left = 0;
  let inWindow = 0;
  for (const date of days) {
    if (spent.has(date)) inWindow += 1;
    const windowStart = addDays(date, -(ROLLING_WINDOW_DAYS - 1));
    // `days` is ascending and `windowStart` only moves forward, so this never rewinds.
    while ((days[left] ?? date) < windowStart) {
      if (spent.has(days[left] ?? '')) inWindow -= 1;
      left += 1;
    }
    if (spent.has(date) && inWindow > habit.allowance) broken.add(date);
  }

  return { days, spent, broken };
}

/** Can a connector touch this day at all? Only a scored, unbroken day that has happened. */
function isLinkable(habit: Habit, broken: Set<string>, date: string, today: string): boolean {
  return date <= today && isApplicableDay(habit, date) && !broken.has(date);
}

/** Split the applicable days into maximal unbroken runs — the chains the grid draws. */
function runsFrom(days: string[], broken: Set<string>): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const date of days) {
    if (broken.has(date)) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(date);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** A run's length is its MET days, not its elapsed days — a forgiven day was not earned. */
function metDaysIn(run: string[], byDate: Map<string, HabitEntry>): number {
  return run.filter((date) => byDate.get(date)?.status === 'met').length;
}

/**
 * The per-day projection the grid renders — one entry per date in `[range.from, range.to]`,
 * whether or not the habit is scored that day. The walk is extended a rolling window before
 * the range so the first rendered day's allowance arithmetic sees the days behind it.
 */
export function buildHabitCalendar(
  habit: Habit,
  entries: HabitEntry[],
  range: { from: string; to: string; today: string },
): HabitDay[] {
  const byDate = entriesByDate(habit, entries);
  const { days, spent, broken } = walkFacts(
    habit,
    byDate,
    addDays(range.from, -(ROLLING_WINDOW_DAYS - 1)),
    range.today,
    range.today,
  );
  const runs = runsFrom(days, broken);
  const last = days.at(-1);
  const currentRun = runs.find((run) => last !== undefined && run.includes(last)) ?? [];
  const inCurrentRun = new Set(currentRun);

  /** Does the chain span `date` → the next calendar day, and was it earned or forgiven? */
  const linkFrom = (date: string): HabitDay['link'] => {
    const next = addDays(date, 1);
    if (!isLinkable(habit, broken, date, range.today)) return 'none';
    if (!isLinkable(habit, broken, next, range.today)) return 'none';
    return spent.has(date) || spent.has(next) ? 'bridge' : 'streak';
  };

  const calendar: HabitDay[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    calendar.push({
      date,
      status: cellStatus(habit, byDate, date, range.today),
      canLog: date <= range.today && isTrackableDay(habit, date),
      isToday: date === range.today,
      inStreak: inCurrentRun.has(date),
      link: linkFrom(date),
    });
  }
  return calendar;
}

/**
 * The scalars beside the grid. Measured over `[started_on, today]` — see the module's window
 * limitation for what that means when the caller holds a bounded window of entries.
 *
 * `window` scopes ONLY `hitRate` and `counts`, to the applicable days inside it. Every other
 * figure stays all-history: the formation stage is keyed to cumulative met days, so a windowed
 * `metDaysTotal` would demote a habit for the crime of being asked about a short span. Because
 * the window is intersected with the days actually walked, one reaching before `started_on` or
 * past `today` adds no phantom `unknown` days. Omitting it counts every applicable day.
 */
export function computeHabitStats(
  habit: Habit,
  entries: HabitEntry[],
  today: string,
  window?: DateWindow,
): HabitStats {
  const byDate = entriesByDate(habit, entries);
  const { days, spent, broken } = walkFacts(habit, byDate, habit.started_on, today, today);
  const runs = runsFrom(days, broken);
  const last = days.at(-1);
  const currentRun = runs.find((run) => last !== undefined && run.includes(last));

  const countedDays =
    window === undefined ? days : days.filter((date) => date >= window.from && date <= window.to);

  const counts = { met: 0, partial: 0, missed: 0, skipped: 0, unknown: 0 };
  for (const date of countedDays) {
    const status = byDate.get(date)?.status ?? 'unknown';
    counts[status] += 1;
  }

  const metDaysTotal = days.filter((date) => byDate.get(date)?.status === 'met').length;

  const runLengths = runs.map((run) => metDaysIn(run, byDate));
  // Only ENDED runs feed the average, so a long healthy streak doesn't drag it down while it
  // is still growing. A run of nothing but forgiven days has no length to average.
  const endedLengths = runs
    .filter((run) => run !== currentRun)
    .map((run) => metDaysIn(run, byDate))
    .filter((length) => length > 0);

  const rated = counts.met + counts.partial + counts.missed;
  const windowStart = addDays(today, -(ROLLING_WINDOW_DAYS - 1));
  const spentThisWeek = days.filter((date) => date >= windowStart && spent.has(date)).length;

  return {
    currentStreak: currentRun === undefined ? 0 : metDaysIn(currentRun, byDate),
    longestStreak: runLengths.length === 0 ? 0 : Math.max(...runLengths),
    averageStreak:
      endedLengths.length === 0
        ? null
        : endedLengths.reduce((total, length) => total + length, 0) / endedLengths.length,
    allowanceRemaining: Math.max(0, habit.allowance - spentThisWeek),
    hitRate: rated === 0 ? null : counts.met / rated,
    metDaysTotal,
    stage: formationStage(metDaysTotal),
    counts,
  };
}

/** Where `metDays` lands on the formation ladder. */
export function formationStage(metDays: number): FormationStage {
  return LADDER.find((rung) => metDays >= rung.from)?.stage ?? 'fully_deliberate';
}
