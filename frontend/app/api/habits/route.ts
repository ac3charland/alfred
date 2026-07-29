import { resolveIngestClient, withSession } from '@/lib/api/auth';
import { parseQueryParams, parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createHabitSchema, habitsQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getHabitsWithHistory } from '@/lib/data/habits';
import {
  computeHabitStats,
  resolveTimezone,
  resolveWindow,
  toHabitsPayload,
  todayIn,
} from '@/lib/habits';
import type { HabitInsert } from '@/lib/types';

// ---------------------------------------------------------------------------
// GET /api/habits — every habit's definition, a window of its entries, and every derived
// number, in one payload.
//
// Session OR the ingest API key, resolved through `resolveIngestClient` — NOT
// `withSessionOrApiKey`, which yields no Supabase client. A keyed caller carries no cookie, so
// a route reaching for `createClient()` under it would read anonymously and answer `200` with
// `habits: []` — indistinguishable, to the coach, from "the owner has no habits".
//
// One route and one engine on purpose: the streak rules are subtle enough that a second
// derivation would disagree with the one the app shows, and a coach quoting a different streak
// than the screen is a trust bug. Numbers arrive pre-rounded so they can be quoted directly.
//
// No caching and no `revalidate` export: auth reads cookies or headers on every call, which
// already makes this dynamic, and the numbers must be current the moment a day is logged.
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a 401 Response directly on auth failure.
  if (clientResult instanceof Response) return clientResult;
  const { supabase } = clientResult;

  const query = parseQueryParams(request, habitsQuerySchema);
  if (query instanceof Response) return query;

  // The RESOLVED zone is what the payload echoes: a caller who sent a typo needs to see that
  // its days were bucketed in UTC rather than read the numbers as if they weren't.
  const timezone = resolveTimezone(query.tz ?? 'UTC');
  const today = todayIn(timezone);

  const window = resolveWindow(query, today);
  if ('error' in window) return jsonError(400, window.error);

  const { habits, entriesByHabit, error } = await getHabitsWithHistory(supabase, {
    includeArchived: query.include_archived === 'true',
  });
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(
    toHabitsPayload({
      today,
      timezone,
      window,
      habits: habits.map((habit) => {
        // Every entry feeds the engine — the scalars are all-history — while only the
        // in-window ones are carried in the payload.
        const entries = entriesByHabit.get(habit.id) ?? [];
        return {
          habit,
          stats: computeHabitStats(habit, entries, today, window),
          entries: entries.filter(
            (entry) => entry.entry_date >= window.from && entry.entry_date <= window.to,
          ),
        };
      }),
    }),
  );
}

// ---------------------------------------------------------------------------
// POST /api/habits — define a habit
//
// Session-only: defining a new entity is a deliberate act at a keyboard. The ingest key is
// widened for LOGGING a day (see the entries route), not for creating things.
//
// Omitted `active_days` / `allowance` / `started_on` are left off the insert entirely so the
// column defaults apply (all seven weekdays, no allowance, today).
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createHabitSchema);
  if (input instanceof Response) return input;

  const insert: HabitInsert = { name: input.name, criteria: input.criteria };
  if (input.notes !== undefined) insert.notes = input.notes;
  if (input.active_days !== undefined) insert.active_days = input.active_days;
  if (input.allowance !== undefined) insert.allowance = input.allowance;
  if (input.started_on !== undefined) insert.started_on = input.started_on;

  const { data, error } = await supabase.from('habits').insert(insert).select().single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
