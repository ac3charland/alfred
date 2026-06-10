import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';

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
    const { id } = await context.params;
    const { supabase } = session;

    const { data, error } = await supabase.rpc('complete_subtree', {
      root_id: id,
    });

    if (error) return jsonError(500, error.message);

    return jsonOk(data);
  },
);
