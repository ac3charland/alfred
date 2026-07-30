import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateHabitSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import { lockedFieldsChanged, lockedFieldsMessage } from '@/lib/habits';
import type { HabitUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/habits/[id] — change a habit's definition
//
// Session-only, like POST: the ingest key is widened for LOGGING a day, not for redefining or
// destroying things.
//
// `name`, `notes` and `criteria` are free to change at any time — a day's status is frozen when
// it is written, so retargeting a criterion never rewrites history. The cadence fields are
// frozen once there is a day to protect, and the guard lives HERE rather than only in the form:
// the invariant protects stored history, so it belongs where the write happens.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateHabitSchema);
    if (input instanceof Response) return input;

    // `.maybeSingle()`, not `.single()`: the shared error mapper has no PGRST116 case, so a
    // missing row would surface as a 500. Widening the mapper would change every other route.
    const { data: current, error: loadError } = await supabase
      .from('habits')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (loadError) {
      const { status, message } = mapSupabaseError(loadError);
      return jsonError(status, message);
    }
    if (current === null) return jsonError(404, 'Habit not found');

    // Only a real CHANGE to a frozen field is refused, and only once there is history to
    // restate — so a habit got wrong five minutes ago can still be fixed freely.
    const locked = lockedFieldsChanged(current, input);
    if (locked.length > 0) {
      const { count, error: countError } = await supabase
        .from('habit_entries')
        .select('*', { head: true, count: 'exact' })
        .eq('habit_id', id);

      if (countError) {
        const { status, message } = mapSupabaseError(countError);
        return jsonError(status, message);
      }
      const logged = count ?? 0;
      if (logged > 0) {
        return jsonError(409, lockedFieldsMessage(locked, current.name, logged));
      }
    }

    const updates = toUpdatePayload<HabitUpdate>(input, [
      'name',
      'notes',
      'criteria',
      'active_days',
      'allowance',
      'started_on',
    ]);
    // The wire says `archived: boolean` and the server owns the instant, so no caller can
    // archive "as of" a past date and retroactively un-score the days behind it.
    if (input.archived !== undefined) {
      updates.archived_at = input.archived ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from('habits')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data);
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/habits/[id] — destroy a habit and every day logged against it
//
// Archiving is the expected path; this is for mistakes. Entries go with the row through the
// migration's `on delete cascade`, so there is no second statement and no orphan sweep.
// Deleting an id that isn't there is a successful no-op, matching DELETE /api/folders/[id].
// ---------------------------------------------------------------------------

export const DELETE = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const { error } = await supabase.from('habits').delete().eq('id', id);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk({ success: true });
  },
);
