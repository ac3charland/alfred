import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/tasks/[id]/complete
// ---------------------------------------------------------------------------

/**
 * Cascade-completes a task and all its descendants via the `complete_subtree`
 * Postgres RPC. The client confirms the cascade modal BEFORE calling this —
 * this handler simply executes and returns the affected items.
 */
export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const { data, error } = await supabase.rpc('complete_subtree', {
      root_id: id,
    });

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data);
  },
);
