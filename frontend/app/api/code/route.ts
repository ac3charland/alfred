import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createCodeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getCodeStoryList } from '@/lib/data/code';

// ---------------------------------------------------------------------------
// GET /api/code — list every code story (the flattened v_code_stories view)
// ---------------------------------------------------------------------------

export const GET = withSession(async () => {
  const { data, error } = await getCodeStoryList();
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/code — the gate. Admits an item to the factory via enter_code_module
//
// The RPC flips the item to `code`, clears its task-only fields (so converting a task
// with a due date / subtasks is safe), and creates the `code_items` sidecar at
// `needs_refinement` with a server-allocated ref. Returns the new sidecar row.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createCodeSchema);
  if (input instanceof Response) return input;

  const { data, error } = await supabase
    .rpc('enter_code_module', {
      p_item: input.item_id,
      p_project: input.project_id,
      p_epic: input.epic_id,
    })
    .single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
