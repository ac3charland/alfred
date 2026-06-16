import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateEpicSchema } from '@/lib/api/schemas';
import type { EpicUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/epics/[id] — edit an epic's header fields
//
// Supports `name` (inline rename), `notes` and `archived_at` (set to an ISO timestamp to
// archive, null to un-archive). Archiving drops the epic off the active board (the M3 read
// filter on `archived_at`); un-archiving restores it.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const { supabase } = session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const parsed = updateEpicSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, 'Invalid request body', parsed.error.issues);
    }

    // PATCH semantics: set only the keys the caller actually sent. A present key — even
    // `null` — is forwarded (null clears notes / un-archives); an absent one is untouched.
    const d = parsed.data;
    const updates: EpicUpdate = {};
    if (d.name !== undefined) updates.name = d.name;
    if (d.notes !== undefined) updates.notes = d.notes;
    if (d.archived_at !== undefined) updates.archived_at = d.archived_at;

    const { data, error } = await supabase
      .from('epics')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return jsonError(500, error.message);

    return jsonOk(data);
  },
);
