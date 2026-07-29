import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { Database } from '@/lib/database.types';
import { addDays } from '@/lib/habits/dates';
import { createClient } from '@/lib/supabase/server';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * Server-only read layer for habits: the shell's seed for `HabitsProvider` below, and the
 * API's all-history read further down.
 *
 * Like the weekly-plan readers, the seeders deliberately load a BOUNDED slice rather than
 * everything: a daily habit grows a few hundred rows a year, which is the point at which the
 * shell's "fetch everything" default stops holding. Both swallow the Supabase error and fall
 * back to `[]` — a seed failure must not blank the whole shell.
 */

/**
 * How far back the entry seed reaches. Computed in UTC on the server and deliberately
 * generous, so whichever side of midnight the browser's zone is on, today's row is inside it.
 */
export const ENTRY_WINDOW_DAYS = 120;

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

/** Entries for every habit over the trailing {@link ENTRY_WINDOW_DAYS}, inclusive of today. */
export async function getHabitEntries(
  windowDays: number = ENTRY_WINDOW_DAYS,
): Promise<HabitEntry[]> {
  const supabase = await createClient();
  const from = addDays(new Date().toISOString().slice(0, 10), -windowDays);
  const { data } = await supabase
    .from('habit_entries')
    .select('*')
    .gte('entry_date', from)
    .order('entry_date', { ascending: false });
  return data ?? [];
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
