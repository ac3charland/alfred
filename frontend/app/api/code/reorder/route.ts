import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { reorderCodeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/code/reorder — swap two stories' global Backlog priority (the chevron reorder)
//
// One atomic `swap_code_priority(a, b)` RPC (NOT two PATCHes) so the `unique(priority)` index is
// never transiently violated and a partial failure can't leave one story re-ranked. Keyed by
// `ref` (KEY-N) — the code module's convention, refs not UUIDs. Returns the two updated rows.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, reorderCodeSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase.rpc('swap_code_priority', {
    p_a: input.a,
    p_b: input.b,
  });

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk({ rows: data });
});
