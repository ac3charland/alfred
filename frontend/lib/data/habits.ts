import 'server-only';

import { addDays } from '@/lib/habits/dates';
import { createClient } from '@/lib/supabase/server';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * Server-only read layer for habits — the shell's seed for `HabitsProvider`.
 *
 * Like the weekly-plan readers, this deliberately seeds a BOUNDED slice rather than
 * everything: a daily habit grows a few hundred rows a year, which is the point at which the
 * shell's "fetch everything" default stops holding. Both readers swallow the Supabase error
 * and fall back to `[]` — a seed failure must not blank the whole shell.
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
