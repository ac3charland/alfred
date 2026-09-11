import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updatePersonSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { CommPersonUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/comms/people/[id] — rename someone, change their priority, or edit the note
//
// Handles are deliberately not touched here: they are added and removed one at a time through
// their own endpoints, so a rename can never silently drop an address. The response carries the
// handles anyway, because the store holds a person and their handles as one row.
//
// `.maybeSingle()`, not `.single()`: the shared error mapper has no PGRST116 case, so an id that
// matches nothing would surface as a 500 rather than the 404 it is.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updatePersonSchema);
    if (input instanceof Response) return input;

    const updates = toUpdatePayload<CommPersonUpdate>(input, ['name', 'priority', 'notes']);

    const { data, error } = await supabase
      .from('comm_people')
      .update(updates)
      .eq('id', id)
      .select('*,comm_handles(*)')
      .maybeSingle();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Person not found');

    return jsonOk(data);
  },
);

// ---------------------------------------------------------------------------
// DELETE /api/comms/people/[id] — drop someone from the roster
//
// Their handles go with them through the migration's `on delete cascade`, so there is no second
// statement and no orphan sweep. A verdict that named this person keeps its row and loses the
// attribution — the judgment it recorded is history and stays readable.
//
// Deleting an id that isn't there is a successful no-op, matching every other DELETE here.
// ---------------------------------------------------------------------------

export const DELETE = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const { error } = await supabase.from('comm_people').delete().eq('id', id);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk({ success: true });
  },
);
