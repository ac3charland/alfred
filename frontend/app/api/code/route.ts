import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createCodeSchema } from '@/lib/api/schemas';
import type { CodeStory } from '@/lib/types';

// ---------------------------------------------------------------------------
// GET /api/code — list every code story (the flattened v_code_stories view, §4.5)
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { supabase } = session;

  // v_code_stories is a view, so Postgres carries no NOT NULL metadata; the inner joins
  // guarantee fully-resolved rows, so override the result type back to CodeStory (the
  // same gotcha lib/data/code.ts handles — see the supabase skill).
  const { data, error } = await supabase
    .from('v_code_stories')
    .select('*')
    .order('ref_number', { ascending: true })
    .overrideTypes<CodeStory[]>();

  if (error) return jsonError(500, error.message);

  return jsonOk(data);
});

// ---------------------------------------------------------------------------
// POST /api/code — the gate. Admits an item to the factory via enter_code_module (§8.3)
//
// The RPC flips the item to `code`, clears its task-only fields (so converting a task
// with a due date / subtasks is safe), and creates the `code_items` sidecar at
// `needs_refinement` with a server-allocated ref. Returns the new sidecar row.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }

  const parsed = createCodeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, 'Invalid request body', parsed.error.issues);
  }

  const { data, error } = await supabase
    .rpc('enter_code_module', {
      p_item: parsed.data.item_id,
      p_project: parsed.data.project_id,
      p_epic: parsed.data.epic_id,
    })
    .single();

  if (error) return jsonError(500, error.message);

  return jsonOk(data, 201);
});
