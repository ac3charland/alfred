import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { moveCodeInProjectSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/code/move-project — jump one story to the top or bottom of ITS OWN PROJECT (ALF-110),
// the repurposed double-chevron move.
//
// One atomic `move_code_priority_in_project(ref, to_top)` RPC re-ranks the story to the midpoint
// between its project's current best/worst story and whichever OTHER project's story sits just
// past it — a single-row UPDATE, so no other story's priority ever changes. Keyed by `ref` (KEY-N),
// the code module's convention. Returns the updated row.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, moveCodeInProjectSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase.rpc('move_code_priority_in_project', {
    p_ref: input.ref,
    p_to_top: input.to_top,
  });

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk({ rows: data });
});
