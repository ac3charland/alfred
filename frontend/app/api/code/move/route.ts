import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { moveCodeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/code/move — jump one story to the top or bottom of the global Backlog (the
// double-chevron move).
//
// One atomic `move_code_priority(ref, to_top)` RPC re-ranks the story to just beyond the current
// extreme (min-1 for the top, max+1 for the bottom) — a single-row UPDATE outside the live range,
// so the `unique(priority)` index never sees a transient duplicate. Keyed by `ref` (KEY-N), the
// code module's convention. Returns the updated row.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, moveCodeSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase.rpc('move_code_priority', {
    p_ref: input.ref,
    p_to_top: input.to_top,
  });

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk({ rows: data });
});
