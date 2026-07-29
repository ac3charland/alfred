import { ESTABLISHED_DAYS, evaluateCriterion } from '@/lib/habits';
import type { CellStatus, FormationStage, HabitCriterion, HabitResults } from '@/lib/habits';
import type { Habit } from '@/lib/types';

/**
 * Turning habit data into the words the view shows. Pure and separate from the components so
 * the strings a screen reader depends on — every cell's name is one of these — are unit-tested
 * rather than asserted through a render.
 */

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** ISO weekday numbers in calendar order — the canonical order every day list reads back in. */
const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * `activeDays` in calendar order, deduplicated. Filtering the canonical list rather than
 * sorting the caller's normalizes the order and the duplicates in one pass.
 */
function orderedDays(activeDays: number[]): number[] {
  return ISO_WEEKDAYS.filter((day) => activeDays.includes(day));
}

/** Read a calendar date as UTC midnight, so formatting never shifts it into another day. */
function asUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** `Thursday 23 July` — the long form the cell's accessible name opens with. */
export function formatLongDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(asUtcDate(date));
}

/** `Thu 23 Jul` — the compact form the day editor's header uses. */
export function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(asUtcDate(date));
}

/** Minutes after midnight → `HH:MM`, the form a `time` criterion is read and typed in. */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  return `${String(hours).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/** `HH:MM` → minutes after midnight; `undefined` when the field is empty or unparseable. */
export function timeToMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

/** How a recorded value reads back: a time as `HH:MM`, anything else as its own number. */
export function formatValue(criterion: HabitCriterion, value: boolean | number): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return criterion.kind === 'time' ? minutesToTime(value) : String(value);
}

/** How a criterion's target reads inside the sentence: `06:15`, `3`, `20`. */
export function formatTarget(criterion: HabitCriterion): string {
  return criterion.kind === 'boolean' ? '' : formatValue(criterion, criterion.target);
}

/** The status word shown in the day editor's header and in a cell's accessible name. */
export const STATUS_WORD: Record<CellStatus, string> = {
  met: 'Met',
  partial: 'Partial',
  missed: 'Missed',
  skipped: 'Skipped',
  unknown: 'Not logged',
  not_applicable: 'Not tracked',
};

/** One clause per criterion: what it asked for, and what the day actually recorded. */
function criterionClause(criterion: HabitCriterion, results: HabitResults): string {
  const value = results[criterion.key];
  const outcome = evaluateCriterion(criterion, value);
  if (outcome === 'unrecorded') return `${criterion.label}: not recorded`;
  const recorded = value === undefined ? '' : ` (${formatValue(criterion, value)})`;
  // A boolean's value is the outcome, so repeating it back would just read "met (yes)".
  const detail = typeof value === 'boolean' ? '' : recorded;
  return `${criterion.label}: ${outcome === 'pass' ? 'met' : 'not met'}${detail}`;
}

/**
 * A cell's accessible name (and `title`): the date, the verdict, and enough of the day to
 * answer "why is this here?" months later. A skipped day carries its REASON — which is what
 * makes requiring one worth anything.
 */
export function dayAccessibleName(
  date: string,
  status: CellStatus,
  criteria: HabitCriterion[],
  results: HabitResults,
  note: string | null,
): string {
  const when = formatLongDate(date);
  if (status === 'unknown') return `${when} — not logged`;
  if (status === 'skipped') {
    return `${when} — skipped${note === null || note.trim() === '' ? '' : `: ${note.trim()}`}`;
  }
  const clauses = criteria.map((criterion) => criterionClause(criterion, results));
  return `${when} — ${STATUS_WORD[status].toLowerCase()}.${clauses.map((clause) => ` ${clause}.`).join('')}`;
}

/**
 * A pre-start day's name. It has no verdict to report — the habit wasn't running yet — so it
 * names the offer instead: filling the day is what moves the start back to it.
 */
export function beforeStartName(date: string): string {
  return `${formatLongDate(date)} — before this habit started. Log it to start the habit here`;
}

/** `every day`, `weekdays`, or the days themselves — the cadence half of a habit's summary. */
export function formatActiveDays(activeDays: number[]): string {
  const days = orderedDays(activeDays);
  if (days.length === 7) return 'every day';
  if (days.length === 5 && days.every((day) => day <= 5)) return 'weekdays';
  if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'weekends';
  return days.map((day) => WEEKDAY_SHORT[day - 1] ?? '').join(', ');
}

/** The weekday slot inside the create sentence: `Every <day>`, `Every <weekday>`, `Every <Mon, Fri>`. */
export function formatDaysSlot(activeDays: number[]): string {
  const days = orderedDays(activeDays);
  if (days.length === 7) return 'day';
  if (days.length === 5 && days.every((day) => day <= 5)) return 'weekday';
  if (days.length === 0) return 'day';
  return days.map((day) => WEEKDAY_SHORT[day - 1] ?? '').join(', ');
}

/** The allowance slot inside the create sentence: `forgiving <1 miss a week>.` */
export function formatAllowanceSlot(allowance: number): string {
  if (allowance === 0) return 'no misses a week';
  return `${String(allowance)} ${allowance === 1 ? 'miss' : 'misses'} a week`;
}

/** The full weekday name, for a toggle's accessible label. */
export function weekdayName(isoDay: number): string {
  return WEEKDAY_NAMES[isoDay - 1] ?? '';
}

/** `no misses`, `1 miss / rolling week`, `2 misses / rolling week`. */
export function formatAllowance(allowance: number): string {
  if (allowance === 0) return 'no misses';
  return `${String(allowance)} ${allowance === 1 ? 'miss' : 'misses'} / rolling week`;
}

/** `every day · 1 miss / rolling week` — the line under a habit's name. */
export function habitSummary(habit: Habit): string {
  return `${formatActiveDays(habit.active_days)} · ${formatAllowance(habit.allowance)}`;
}

/** What the rail shows for a figure with no value — "no runs have ended yet" is not "zero". */
const NO_VALUE = '—';

/**
 * The formation ladder in the owner's own words. Every rung hedges, because the marker it
 * counts toward is the median of a range wide enough (roughly 18 to 254 days) that a confident
 * "Established" would be a claim the evidence doesn't support.
 */
export const STAGE_LABEL: Record<FormationStage, string> = {
  fully_deliberate: 'Fully Deliberate',
  gaining_momentum: 'Gaining Momentum',
  nearing_automaticity: 'Nearing Automaticity',
  possibly_established: 'Possibly Established',
};

/** `0.9375` → `94%`, rounded to a whole percent. Nothing rated yet reads as an em dash. */
export function formatHitRate(rate: number | null): string {
  return rate === null ? NO_VALUE : `${String(Math.round(rate * 100))}%`;
}

/** `14` → `14`, `5.5` → `5.5` — one decimal, with a trailing `.0` dropped. */
export function formatStreakLength(length: number | null): string {
  return length === null ? NO_VALUE : String(Math.round(length * 10) / 10);
}

/** `47 of ~66 banked days`, or `82 banked days · past ~66` once the marker is reached. */
export function formatBanked(metDays: number): string {
  return metDays >= ESTABLISHED_DAYS
    ? `${String(metDays)} banked days · past ~${String(ESTABLISHED_DAYS)}`
    : `${String(metDays)} of ~${String(ESTABLISHED_DAYS)} banked days`;
}

/**
 * The meter's accessible name: the caption spelled out, with "about" in place of the tilde —
 * which a screen reader reads as noise rather than as a hedge.
 */
export function bankedAccessibleName(metDays: number): string {
  const marker = `about ${String(ESTABLISHED_DAYS)}`;
  return metDays >= ESTABLISHED_DAYS
    ? `${String(metDays)} banked days, past ${marker}`
    : `${String(metDays)} of ${marker} banked days`;
}

/**
 * A criterion key from its label: lowercase, underscore-separated, ≤ 32 chars, de-duplicated
 * with a numeric suffix. Generated rather than typed, and frozen once the criterion exists, so
 * renaming a criterion later leaves stored history intact.
 */
export function criterionKeyFrom(label: string, taken: readonly string[]): string {
  const base =
    label
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 32) || 'criterion';
  if (!taken.includes(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base.slice(0, 32 - String(suffix).length - 1)}_${String(suffix)}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
