import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { convertCodeEpicSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/code/epic — the epic conversion (ALF-129)
//
// Convert a 1-deep parent (a code inbox item or a decomposed task) into a NEW epic plus one
// story per active child, all in one atomic `convert_to_code_epic` RPC: the epic takes the
// parent's title and notes, the stories land at the top of the project's Backlog in the
// children's display order, and the parent is consumed (a code row is deleted, a task is
// completed). Returns `{ epic, stories }` — the created epic row plus the story sidecars in
// display order.
//
// A static segment beside /api/code/move and /api/code/reorder: static wins over `[ref]`,
// and a real ref is always KEY-N, so `epic` can never shadow one.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, convertCodeEpicSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase.rpc('convert_to_code_epic', {
    p_item: input.item_id,
    p_project: input.project_id,
  });

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
