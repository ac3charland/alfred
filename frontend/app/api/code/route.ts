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
// POST /api/code — create a code story. Two shapes, one route (see createCodeSchema):
//
// - The **gate** (`{ item_id, project_id, epic_id }`) admits a pre-existing item via
//   `enter_code_module`: it flips the item to `code`, clears its task-only fields (so
//   converting a task with a due date / subtasks is safe), and creates the sidecar.
// - **New story** (`{ title, notes?, project_id, epic_id, requires_refinement? }`, no
//   `item_id`) mints a fresh item AND its sidecar in one step via `create_code_story` — no
//   inbox row to admit.
//
// Both land the `code_items` sidecar with a server-allocated ref and return that row. It
// starts at `needs_refinement`, unless the new-story shape sends `requires_refinement: false`
// — the "Needs refinement" checkbox, which lands the story straight in `ready_for_dev`.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, createCodeSchema);
  if (input instanceof Response) return input;

  // The gate carries an `item_id`; the new-story shape does not — branch on its presence.
  const rpc =
    'item_id' in input
      ? supabase.rpc('enter_code_module', {
          p_item: input.item_id,
          p_project: input.project_id,
          p_epic: input.epic_id,
        })
      : supabase.rpc('create_code_story', {
          p_project: input.project_id,
          p_epic: input.epic_id,
          p_title: input.title,
          // p_notes is `string | undefined` (the RPC defaults a missing arg to NULL), so an
          // absent / null notes value omits the arg rather than passing null.
          ...(input.notes === null || input.notes === undefined ? {} : { p_notes: input.notes }),
          // Same treatment for the refinement mark: omit the arg when the body didn't carry it
          // so the RPC's own `default true` applies.
          ...(input.requires_refinement === undefined
            ? {}
            : { p_requires_refinement: input.requires_refinement }),
        });

  const { data, error } = await rpc.single();

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
