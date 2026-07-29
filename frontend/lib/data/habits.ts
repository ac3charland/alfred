import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { Database } from '@/lib/database.types';
import { APP_WINDOW_DAYS, addDays, todayIn } from '@/lib/habits/dates';
import { computeHabitStats } from '@/lib/habits/streaks';
import type { HabitStats } from '@/lib/habits/types';
import { createClient } from '@/lib/supabase/server';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * Server-only read layer for habits: the shell's seed for `HabitsProvider` below, and the
 * API's all-history read further down.
 *
 * Like the weekly-plan readers, the seed deliberately hands the client a BOUNDED slice of
 * entries rather than everything: a daily habit grows a few hundred rows a year, which is the
 * point at which the shell's "fetch everything" default stops holding. It swallows the
 * Supabase error and degrades in layers — a seed failure must not blank the whole shell.
 */

/** Active habits in display order. Archived ones are excluded — nothing renders them yet. */
export async function getHabits(): Promise<Habit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('habits')
    .select('*')
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return data ?? [];
}

/**
 * The shell's habit seed: every habit, the trailing {@link APP_WINDOW_DAYS} of entries, and the
 * all-history stats the rail's banked / longest / average figures need.
 *
 * ONE read backs all three: the stats are cumulative-forever figures and so need full history,
 * which means windowing the entry read as well would re-fetch rows this read already returned.
 * The window is applied in TS afterwards. If entry volume ever makes the full read expensive
 * the answer is a SQL rollup of those scalars, not a truncated read (see
 * {@link getHabitsWithHistory}).
 *
 * The seeded slice reaches one day FURTHER back than the window the client walks, so a browser
 * west of UTC — whose local today is the server's yesterday — still holds every day of its own
 * window. The invariant: the client's window is always a subset of what was seeded, whichever
 * side of the date line the browser sits on.
 */
export async function getHabitSeed(): Promise<{
  habits: Habit[];
  entries: HabitEntry[];
  stats: Record<string, HabitStats>;
}> {
  const supabase = await createClient();
  const today = todayIn('UTC');
  const { habits, entriesByHabit, error } = await getHabitsWithHistory(supabase, {
    includeArchived: false,
  });

  // Degrade in layers, never to a blank shell: without entries the rail falls back to its live
  // window walk, which is right for every habit younger than the window and understated — never
  // absent — for older ones.
  if (error) return { habits: await getHabits(), entries: [], stats: {} };

  const from = addDays(today, -APP_WINDOW_DAYS);
  const entries: HabitEntry[] = [];
  const stats: Record<string, HabitStats> = {};
  for (const habit of habits) {
    const all = entriesByHabit.get(habit.id) ?? [];
    // No window argument, so every figure is scored over the habit's whole life.
    stats[habit.id] = computeHabitStats(habit, all, today);
    entries.push(...all.filter((entry) => entry.entry_date >= from));
  }
  return { habits, entries, stats };
}

// ---------------------------------------------------------------------------
// The API read — every habit plus its ENTIRE entry history, for `GET /api/habits`.
//
// Unlike the seeders above it takes the client rather than creating one (a keyed caller has no
// cookie session and must read through the admin client) and surfaces the Supabase error
// rather than falling back to `[]`. A blank seed degrades the shell; an API answering "no
// habits" when the database is unreachable tells the coach the owner did nothing this week.
// ---------------------------------------------------------------------------

/**
 * Rows per entry request. PostgREST caps a response at the project's `Max rows` (1000 by
 * default) and TRUNCATES SILENTLY when it does — a `.limit(50_000)` does not lift it. So the
 * read is paged rather than asked for in one go.
 */
export const PAGE_SIZE = 1000;

/**
 * How many pages a single read may take before it is called a failure. One daily habit crosses
 * a page at about two years nine months, so this is ~275 habit-years of headroom; a run that
 * exhausts it means a backend that never returns a short page, and truncating there would show
 * up as a quietly shrinking streak the coach would then state with confidence.
 */
export const MAX_PAGES = 100;

function pagingError(): PostgrestError {
  const error = {
    name: 'PostgrestError',
    message: `Entry read did not terminate within ${String(MAX_PAGES)} pages`,
    details: '',
    hint: '',
    code: 'PGRST_PAGING',
  };
  return { ...error, toJSON: () => error };
}

/** Every entry belonging to `habitIds`, walked a page at a time until a short page arrives. */
async function readAllEntries(
  supabase: SupabaseClient<Database>,
  habitIds: string[],
): Promise<{ entries: HabitEntry[]; error: PostgrestError | null }> {
  const entries: HabitEntry[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from('habit_entries')
      .select('*')
      .in('habit_id', habitIds)
      // A total order across pages is what makes paging safe: without it two requests can
      // return the same row twice and never return another.
      .order('habit_id', { ascending: true })
      .order('entry_date', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) return { entries: [], error };
    entries.push(...data);
    if (data.length < PAGE_SIZE) return { entries, error: null };
  }
  return { entries: [], error: pagingError() };
}

/**
 * Every habit (optionally including archived ones) plus its entire entry history, grouped.
 *
 * Deliberately unwindowed: the streak scalars and the formation stage are cumulative-forever
 * figures, so anything less than full history is a wrong number. If entry volume ever makes
 * this expensive the answer is a SQL rollup of those scalars, not a truncated read.
 */
export async function getHabitsWithHistory(
  supabase: SupabaseClient<Database>,
  options: { includeArchived: boolean },
): Promise<{
  habits: Habit[];
  entriesByHabit: Map<string, HabitEntry[]>;
  error: PostgrestError | null;
}> {
  const empty = new Map<string, HabitEntry[]>();

  let builder = supabase.from('habits').select('*');
  if (!options.includeArchived) builder = builder.is('archived_at', null);

  // Active habits first and in the app's own display order, so the coach lists them the way
  // the owner sees them whether or not archived ones are included.
  const { data, error } = await builder
    .order('archived_at', { ascending: true, nullsFirst: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) return { habits: [], entriesByHabit: empty, error };

  // An empty `in.()` is a query with no answer worth asking for.
  if (data.length === 0) return { habits: data, entriesByHabit: empty, error: null };

  const { entries, error: entriesError } = await readAllEntries(
    supabase,
    data.map((habit) => habit.id),
  );
  if (entriesError) return { habits: [], entriesByHabit: empty, error: entriesError };

  const entriesByHabit = new Map<string, HabitEntry[]>(data.map((habit) => [habit.id, []]));
  for (const entry of entries) entriesByHabit.get(entry.habit_id)?.push(entry);

  return { habits: data, entriesByHabit, error: null };
}
