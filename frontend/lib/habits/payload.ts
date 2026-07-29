import type { Json } from '@/lib/database.types';
import { parseCriteria } from '@/lib/habits/criteria';
import type { DateWindow } from '@/lib/habits/dates';
import type { FormationStage, HabitCriterion, HabitStats } from '@/lib/habits/types';
import { stableSorted } from '@/lib/sort';
import type { Habit, HabitDayStatus, HabitEntry } from '@/lib/types';

/**
 * The serializer for `GET /api/habits` — the one place the published payload's key names,
 * rounding and projection live.
 *
 * Three jobs, all of which exist because the consumer is outside this repo:
 *
 *   - snake_case, matching every other alfred response rather than the engine's camelCase.
 *   - PRE-ROUNDED numbers, so a caller can quote a hit rate without re-deriving it and get the
 *     same figure twice. The engine keeps full precision for the optimistic store.
 *   - a PROJECTION, not a row dump: row identity and timestamps stay server-side. A day is
 *     addressed by `(habit id, date)`, which is exactly what the entry-upsert route takes, so
 *     an `id` in the payload would be a key we could never change and nobody could use.
 */

/** One day, as the payload carries it. */
export interface HabitEntryPayload {
  date: string;
  status: HabitDayStatus;
  results: Json | null;
  note: string | null;
}

/**
 * A habit's derived numbers. `hit_rate` and the five counts are over the requested window;
 * everything else is over all history — the distinction a consumer cannot infer from the shape.
 */
export interface HabitStatsPayload {
  current_streak: number;
  longest_streak: number;
  average_streak: number | null;
  allowance_remaining: number;
  hit_rate: number | null;
  met_days_total: number;
  stage: FormationStage;
  met: number;
  partial: number;
  missed: number;
  skipped: number;
  unknown: number;
}

export interface HabitPayload {
  id: string;
  name: string;
  notes: string | null;
  criteria: HabitCriterion[];
  active_days: number[];
  allowance: number;
  started_on: string;
  archived_at: string | null;
  stats: HabitStatsPayload;
  entries: HabitEntryPayload[];
}

export interface HabitsPayload {
  today: string;
  timezone: string;
  window: DateWindow;
  habits: HabitPayload[];
}

/** One habit's inputs: its row, the stats computed for it, and its in-window entries. */
export interface HabitPayloadInput {
  habit: Habit;
  stats: HabitStats;
  entries: HabitEntry[];
}

export interface HabitsPayloadInput {
  today: string;
  timezone: string;
  window: DateWindow;
  habits: HabitPayloadInput[];
}

/** Round to `places` decimals, preserving a null. `toFixed` then back, so 0.9400 reads 0.94. */
function round(value: number | null, places: number): number | null {
  return value === null ? null : Number(value.toFixed(places));
}

function toEntryPayload(entry: HabitEntry): HabitEntryPayload {
  return {
    date: entry.entry_date,
    status: entry.status,
    results: entry.results,
    note: entry.note,
  };
}

function toStatsPayload(stats: HabitStats): HabitStatsPayload {
  return {
    current_streak: stats.currentStreak,
    longest_streak: stats.longestStreak,
    // One decimal: a mean of whole-day runs is never more precise than a tenth of a day.
    average_streak: round(stats.averageStreak, 1),
    allowance_remaining: stats.allowanceRemaining,
    // Three decimals, so a rate quoted as a percentage keeps a tenth of a point.
    hit_rate: round(stats.hitRate, 3),
    met_days_total: stats.metDaysTotal,
    stage: stats.stage,
    ...stats.counts,
  };
}

function toHabitPayload({ habit, stats, entries }: HabitPayloadInput): HabitPayload {
  return {
    id: habit.id,
    name: habit.name,
    notes: habit.notes,
    criteria: parseCriteria(habit.criteria),
    active_days: habit.active_days,
    allowance: habit.allowance,
    started_on: habit.started_on,
    archived_at: habit.archived_at,
    stats: toStatsPayload(stats),
    // Newest first, sorted here rather than trusted from the caller: the order is part of the
    // published contract, so it is produced in the same place the contract is tested.
    entries: stableSorted(entries, (a, b) =>
      a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : 0,
    ).map((entry) => toEntryPayload(entry)),
  };
}

/** The whole `GET /api/habits` body. */
export function toHabitsPayload(input: HabitsPayloadInput): HabitsPayload {
  return {
    today: input.today,
    timezone: input.timezone,
    window: { from: input.window.from, to: input.window.to },
    habits: input.habits.map((habit) => toHabitPayload(habit)),
  };
}
