import type { HabitDayStatus } from '@/lib/types';

/**
 * The habit domain's vocabulary. Every date here is a plain `YYYY-MM-DD` calendar string,
 * never an instant: for a wake-time habit the day boundary IS the measurement, and an instant
 * re-read in another zone lands on the previous day and silently corrupts a chain.
 */

/** What a criterion measures. `boolean` is a yes/no; the other three carry a numeric target. */
export type CriterionKind = 'boolean' | 'time' | 'count' | 'duration';

/** How a measured criterion's value is compared against its target. */
export type Comparator = 'lte' | 'gte' | 'eq';

export interface BooleanCriterion {
  key: string;
  label: string;
  kind: 'boolean';
}

export interface MeasuredCriterion {
  key: string;
  label: string;
  kind: 'time' | 'count' | 'duration';
  /** Minutes after local midnight for `time` (375 = 06:15); a plain number otherwise. */
  target: number;
  comparator: Comparator;
}

export type HabitCriterion = BooleanCriterion | MeasuredCriterion;

/**
 * One day's recorded values, keyed by criterion key. A key with no entry is *unrecorded*,
 * which is not the same as `false` — the editor renders an empty field for it.
 */
export type HabitResults = Record<string, boolean | number>;

/** The three statuses the criteria can produce. `skipped` is only ever set by hand. */
export type DerivedStatus = 'met' | 'partial' | 'missed';

/**
 * What one grid cell shows. Beyond the four stored statuses: `unknown` is an applicable day
 * with no row at all (it spends allowance), and `not_applicable` covers a day the habit isn't
 * scored on — before `started_on`, after `archived_at`, off the weekday set, or still ahead.
 */
export type CellStatus = HabitDayStatus | 'unknown' | 'not_applicable';

/** One day of the projection the history grid renders. */
export interface HabitDay {
  /** YYYY-MM-DD. */
  date: string;
  status: CellStatus;
  /**
   * Whether the day can be opened and recorded. Every day the habit has scored, plus the days
   * BEFORE it started — logging one of those moves `started_on` back to it, so a grid that
   * refused them would leave the owner unable to enter a history they actually kept. A future
   * day, an off-weekday one, and anything past `archived_at` can never be logged.
   */
  canLog: boolean;
  isToday: boolean;
  /**
   * In the run the current streak is made of. The lit-filament grid carries the run in its
   * connectors rather than in the cell fill, so this rides the cell as a data attribute for
   * tests and for the stats rail rather than changing a colour.
   */
  inStreak: boolean;
  /**
   * The connector drawn OUT of this day, toward the next calendar day. `streak` when the run
   * continues on the strength of a met day at both ends, `bridge` when it only continues
   * because the rolling allowance absorbed a spent day, `none` when nothing links the two.
   */
  link: 'none' | 'streak' | 'bridge';
}

/** How far along the formation ladder a habit is, from its cumulative met days. */
export type FormationStage =
  | 'fully_deliberate'
  | 'gaining_momentum'
  | 'nearing_automaticity'
  | 'possibly_established';

/** The scalar figures beside the grid. */
export interface HabitStats {
  currentStreak: number;
  longestStreak: number;
  /** Mean length of every run, including the current one; null until a run exists. */
  averageStreak: number | null;
  allowanceRemaining: number;
  /** met / (met + partial + missed); null when that denominator is 0. */
  hitRate: number | null;
  metDaysTotal: number;
  stage: FormationStage;
  counts: { met: number; partial: number; missed: number; skipped: number; unknown: number };
}

/**
 * How many days a habit has logged, and whether the client can claim that number is the whole
 * truth. The store holds only a trailing window of entries, so a habit older than the window is
 * a FLOOR rather than a total — and the sentences built from it must never round a floor up into
 * a certainty, least of all the one naming what a delete destroys.
 */
export interface LoggedDays {
  count: number;
  /** True when the habit's whole life sits inside the seeded window. */
  isExact: boolean;
}
