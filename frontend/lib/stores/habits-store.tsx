'use client';

import * as React from 'react';

import { type CreateHabitInput, createHabit, upsertHabitEntry } from '@/lib/api-client';
import {
  appWindow,
  computeHabitStats,
  deriveDayStatus,
  isApplicableDay,
  parseCriteria,
  statsWithBaseline,
  todayIn,
} from '@/lib/habits';
import type { HabitResults, HabitStats } from '@/lib/habits';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { useToastActions } from '@/lib/stores/toast-store';
import { tempId } from '@/lib/tree';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * Habits store — the optimistic source of truth for the habit definitions and the seeded
 * window of logged days.
 *
 * The optimistic status a write paints is derived with the SAME `deriveDayStatus` the route
 * will run, so reconciling with the server row is a no-op in the normal case: the cell and the
 * connectors around it repaint on the tap, and the response confirms rather than corrects.
 */

export interface HabitsState {
  habits: Habit[];
  /** habitId → (YYYY-MM-DD → entry). A map, not a list: every read is "this habit, this day". */
  entries: Record<string, Record<string, HabitEntry>>;
  /** The owner's local today, corrected on mount (see {@link HabitsProvider}). */
  today: string;
  /** The entries exactly as seeded — the reference the rail measures in-session edits against. */
  seedEntries: Record<string, Record<string, HabitEntry>>;
  /** Server-computed all-history stats per habit id. Absent for a habit created this session. */
  baselineStats: Record<string, HabitStats>;
}

export interface HabitsActions {
  /** Define a habit. It appears in the list before the server answers. */
  addHabit: (input: CreateHabitInput) => Promise<Habit>;
  /** Log or correct a day. The optimistic status is derived locally from the same rules. */
  logDay: (
    habitId: string,
    date: string,
    results: HabitResults,
    note?: string | null,
  ) => Promise<void>;
  /** Excuse a day. `reason` is required and lands in the entry's `note`. */
  skipDay: (habitId: string, date: string, reason: string) => Promise<void>;
}

type HabitsAction =
  | { type: 'insertHabit'; habit: Habit }
  | { type: 'replaceHabit'; id: string; habit: Habit }
  | { type: 'removeHabit'; id: string }
  | { type: 'setHabitStart'; id: string; startedOn: string }
  | { type: 'putEntry'; habitId: string; entry: HabitEntry }
  | { type: 'removeEntry'; habitId: string; date: string }
  | { type: 'setToday'; today: string };

/**
 * Pure reducer over the store. `putEntry` is keyed by date, so an optimistic write and the
 * server row that follows it land in the same slot — reconcile is a replace, not an insert.
 *
 * No action touches `seedEntries` or `baselineStats`: they are seed-time constants that live in
 * state only because the stats selector needs them beside the mutable entries.
 */
export function habitsReducer(state: HabitsState, action: HabitsAction): HabitsState {
  switch (action.type) {
    case 'insertHabit': {
      return { ...state, habits: [...state.habits, action.habit] };
    }
    case 'replaceHabit': {
      return {
        ...state,
        habits: state.habits.map((habit) => (habit.id === action.id ? action.habit : habit)),
      };
    }
    case 'removeHabit': {
      const { [action.id]: _dropped, ...entries } = state.entries;
      return { ...state, habits: state.habits.filter((habit) => habit.id !== action.id), entries };
    }
    case 'setHabitStart': {
      return {
        ...state,
        habits: state.habits.map((habit) =>
          habit.id === action.id ? { ...habit, started_on: action.startedOn } : habit,
        ),
      };
    }
    case 'putEntry': {
      const forHabit = {
        ...state.entries[action.habitId],
        [action.entry.entry_date]: action.entry,
      };
      return { ...state, entries: { ...state.entries, [action.habitId]: forHabit } };
    }
    case 'removeEntry': {
      const { [action.date]: _dropped, ...forHabit } = state.entries[action.habitId] ?? {};
      return { ...state, entries: { ...state.entries, [action.habitId]: forHabit } };
    }
    case 'setToday': {
      return { ...state, today: action.today };
    }
    default: {
      return assertNever(action, 'habits action');
    }
  }
}

/** Group the seeded flat entry list into the habitId → date → entry map the store holds. */
export function groupEntries(entries: HabitEntry[]): Record<string, Record<string, HabitEntry>> {
  const grouped: Record<string, Record<string, HabitEntry>> = {};
  for (const entry of entries) {
    (grouped[entry.habit_id] ??= {})[entry.entry_date] = entry;
  }
  return grouped;
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  HabitsState,
  HabitsActions
>('a HabitsProvider');

export function HabitsProvider({
  initialHabits,
  initialEntries,
  initialStats,
  serverToday,
  children,
}: {
  initialHabits: Habit[];
  initialEntries: HabitEntry[];
  /**
   * The server's all-history stats per habit id — the baseline the rail's banked / longest /
   * average figures rest on, since the client only ever holds a trailing window of entries.
   */
  initialStats: Record<string, HabitStats>;
  /** The server's UTC date — first paint has to match it, whatever zone the browser is in. */
  serverToday: string;
  children: React.ReactNode;
}) {
  // One grouping serves both slots: the reducer only ever replaces, never mutates, so `entries`
  // moves away from the shared object on the first write and `seedEntries` keeps the seed.
  const seeded = groupEntries(initialEntries);
  const [state, dispatch] = React.useReducer(habitsReducer, {
    habits: initialHabits,
    entries: seeded,
    today: serverToday,
    seedEntries: seeded,
    baselineStats: initialStats,
  });

  // Whose "today"? The shell renders on the server, which doesn't know the browser's zone, so
  // rendering a zone-resolved date directly would be a hydration mismatch for any owner off
  // UTC. Start from the server's UTC date and correct it here, before the owner can act; the
  // seeded window is generous enough that the corrected date is always already in hand.
  // Writes are unaffected — they always name their date explicitly.
  React.useEffect(() => {
    const local = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (local !== serverToday) dispatch({ type: 'setToday', today: local });
  }, [serverToday]);

  // Latest state, readable inside the stable action closures so they can capture pre-mutation
  // values for rollback without going stale. Synced via an effect, like the other stores.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<HabitsActions>(() => {
    /** The optimistic → reconcile → rollback dance both day-writes share. */
    const writeEntry = async (
      habitId: string,
      optimistic: HabitEntry,
      input: Parameters<typeof upsertHabitEntry>[1],
      errorMessage: string,
    ): Promise<void> => {
      const previous = stateRef.current.entries[habitId]?.[optimistic.entry_date];
      // Recording a day behind the habit's start moves the start back to it — the same rule the
      // route runs, applied locally so the whole stretch in between repaints on the tap.
      const previousStart = stateRef.current.habits.find((row) => row.id === habitId)?.started_on;
      const movesStart = previousStart !== undefined && optimistic.entry_date < previousStart;
      await runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'putEntry', habitId, entry: optimistic });
          if (movesStart)
            dispatch({ type: 'setHabitStart', id: habitId, startedOn: optimistic.entry_date });
        },
        apiCall: () => upsertHabitEntry(habitId, input),
        reconcile: (saved) => {
          dispatch({ type: 'putEntry', habitId, entry: saved });
        },
        rollback: () => {
          // A correction restores the row it replaced; a first log leaves the day unlogged.
          if (previous === undefined)
            dispatch({ type: 'removeEntry', habitId, date: optimistic.entry_date });
          else dispatch({ type: 'putEntry', habitId, entry: previous });
          if (movesStart)
            dispatch({ type: 'setHabitStart', id: habitId, startedOn: previousStart });
        },
        onError: () => {
          showToastRef.current(errorMessage);
        },
      });
    };

    return {
      async addHabit(input) {
        const optimistic = makeOptimisticHabit(input);
        return runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'insertHabit', habit: optimistic });
          },
          apiCall: () => createHabit(input),
          reconcile: (saved) => {
            dispatch({ type: 'replaceHabit', id: optimistic.id, habit: saved });
          },
          rollback: () => {
            dispatch({ type: 'removeHabit', id: optimistic.id });
          },
          onError: () => {
            showToastRef.current("Couldn't create habit");
          },
        });
      },
      async logDay(habitId, date, results, note) {
        const habit = stateRef.current.habits.find((row) => row.id === habitId);
        const status = deriveDayStatus(parseCriteria(habit?.criteria ?? []), results);
        await writeEntry(
          habitId,
          makeOptimisticEntry(habitId, date, status, results, note ?? null),
          { date, results, ...(note === undefined ? {} : { note }) },
          "Couldn't save that day",
        );
      },
      async skipDay(habitId, date, reason) {
        await writeEntry(
          habitId,
          makeOptimisticEntry(habitId, date, 'skipped', null, reason),
          { date, status: 'skipped', note: reason },
          "Couldn't skip that day",
        );
      },
    };
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
  }, []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Build an optimistic habit row (a temp id until the server row reconciles). */
function makeOptimisticHabit(input: CreateHabitInput): Habit {
  const now = new Date();
  return {
    id: tempId(),
    name: input.name,
    notes: input.notes ?? null,
    criteria: input.criteria,
    active_days: input.active_days ?? [1, 2, 3, 4, 5, 6, 7],
    allowance: input.allowance ?? 0,
    started_on: input.started_on ?? todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone, now),
    archived_at: null,
    sort_order: null,
    created_at: now.toISOString(),
  };
}

/** Build an optimistic entry row for one day. */
function makeOptimisticEntry(
  habitId: string,
  date: string,
  status: HabitEntry['status'],
  results: HabitResults | null,
  note: string | null,
): HabitEntry {
  const now = new Date().toISOString();
  return {
    id: tempId(),
    habit_id: habitId,
    entry_date: date,
    status,
    results,
    note,
    created_at: now,
    updated_at: now,
  };
}

/** The habit definitions, in display order. Throws outside a HabitsProvider. */
export function useHabits(): Habit[] {
  return useStateValue('useHabits').habits;
}

// A shared empty map, so a habit with no entries returns a stable reference rather than a
// fresh object that re-runs every memo depending on it.
const EMPTY_ENTRIES: Record<string, HabitEntry> = {};

/** One habit's logged days, keyed by date. Empty when nothing has been logged. */
export function useHabitEntries(habitId: string): Record<string, HabitEntry> {
  const entries = useStateValue('useHabitEntries').entries;
  return entries[habitId] ?? EMPTY_ENTRIES;
}

/** The owner's local today, as `YYYY-MM-DD`. */
export function useHabitsToday(): string {
  return useStateValue('useHabitsToday').today;
}

/**
 * One habit's figures for the stats rail: the server's all-history baseline, nudged by whatever
 * the owner has changed since the page loaded.
 *
 * Two walks over the same window — the entries as seeded and the entries as they are now — and
 * a splice. Re-walking rather than applying a delta on write is what lets a correction in the
 * middle of a run break the streak, and it is the same walk the grid draws its connectors from,
 * so the two can never disagree. The walks are the memo's cost: every store change re-walks
 * every habit, which at a handful of habits is far below the grid's own per-cell rendering.
 */
export function useHabitStats(habit: Habit): HabitStats {
  const state = useStateValue('useHabitStats');
  return React.useMemo(() => {
    const window = appWindow(state.today);
    const walk = (rows: Record<string, HabitEntry> | undefined) =>
      computeHabitStats(habit, Object.values(rows ?? {}), state.today, window);
    return statsWithBaseline(
      state.baselineStats[habit.id],
      walk(state.seedEntries[habit.id]),
      walk(state.entries[habit.id]),
    );
  }, [habit, state]);
}

/** The habit mutation actions. Throws outside a HabitsProvider. */
export function useHabitActions(): HabitsActions {
  return useActions('useHabitActions');
}

/**
 * How many habits are scored today but not yet logged — the sidebar badge. A habit today isn't
 * applicable to (wrong weekday, not started, archived) is not outstanding; nor is one already
 * logged, whatever the verdict.
 */
export function useUnloggedTodayCount(): number {
  const state = useStateValue('useUnloggedTodayCount');
  return React.useMemo(
    () =>
      state.habits.filter(
        (habit) =>
          isApplicableDay(habit, state.today) &&
          state.entries[habit.id]?.[state.today] === undefined,
      ).length,
    [state],
  );
}
