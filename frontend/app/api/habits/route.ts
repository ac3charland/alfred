import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createHabitSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import type { HabitInsert } from '@/lib/types';

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
