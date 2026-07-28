import { resolveIngestClient } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { upsertHabitEntrySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { deriveDayStatus, parseCriteria, todayIn } from '@/lib/habits';
import type { HabitEntryInsert } from '@/lib/types';

// ---------------------------------------------------------------------------
// PUT /api/habits/[id]/entries — log or correct one day
//
// Session OR the ingest API key: logging a morning is exactly the write a Shortcut or the
// coach makes, so it takes the keyed path too.
//
// The caller sends evidence and the server scores it, storing BOTH the raw results and the
// status it derived. That status is then frozen: editing the habit's criteria later never
// re-scores history. Re-logging the same day is the correction path — the upsert overwrites
// the results and re-freezes the verdict, which is not the same thing as retroactive scoring.
// ---------------------------------------------------------------------------

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const clientResult = await resolveIngestClient(request);
  // resolveIngestClient returns a 401 Response directly on auth failure.
  if (clientResult instanceof Response) return clientResult;
  const { supabase } = clientResult;

  const { id: rawId } = await context.params;
  const id = parseUUID(rawId);
  if (id instanceof Response) return id;

  const input = await parseRequestBody(request, upsertHabitEntrySchema);
  if (input instanceof Response) return input;

  const { data: habit, error: loadError } = await supabase
    .from('habits')
    .select('criteria, started_on, archived_at')
    .eq('id', id)
    .maybeSingle();

  if (loadError) {
    const { status, message } = mapSupabaseError(loadError);
    return jsonError(status, message);
  }
  if (habit === null) return jsonError(404, 'Habit not found');

  // One resolution of "today" for both the default and the future check, so a caller can never
  // be told its own explicit date is in the future of a differently-resolved now.
  const today = todayIn(input.tz ?? 'UTC');
  const entryDate = input.date ?? today;
  if (entryDate > today) return jsonError(400, 'Cannot log a day in the future');
  if (entryDate < habit.started_on) {
    return jsonError(400, 'Cannot log a day before the habit started');
  }

  const results = input.results ?? null;
  const status =
    input.status ?? deriveDayStatus(parseCriteria(habit.criteria), input.results ?? {});

  // The whole row is rewritten, not merged: correcting a skipped day back to a logged one has
  // to take its reason with it, or the grid keeps answering "why is this here?" with a stale
  // excuse. `updated_at` is stamped by the writer — this repo sets it, no trigger does.
  const row: HabitEntryInsert = {
    habit_id: id,
    entry_date: entryDate,
    status,
    results,
    note: input.note ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('habit_entries')
    .upsert(row, { onConflict: 'habit_id,entry_date' })
    .select()
    .single();

  if (error) {
    const { status: errorStatus, message } = mapSupabaseError(error);
    return jsonError(errorStatus, message);
  }

  return jsonOk(data);
}
