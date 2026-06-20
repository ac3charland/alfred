import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateEpicSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { EpicUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/epics/[id] — edit an epic's header fields
//
// Supports `name` (inline rename), `notes` and `archived_at` (set to an ISO timestamp to
// archive, null to un-archive). Archiving drops the epic off the active board (the board's
// read filter on `archived_at`); un-archiving restores it.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateEpicSchema);
    if (input instanceof Response) return input;

    // PATCH semantics: forward only the keys the caller sent. A present key — even `null` —
    // is forwarded (null clears notes / un-archives); an absent one is left untouched.
    const updates = toUpdatePayload<EpicUpdate>(input, ['name', 'notes', 'archived_at']);

    const { data, error } = await supabase
      .from('epics')
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
