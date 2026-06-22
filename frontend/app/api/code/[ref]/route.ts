import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateCodeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { CodeItemUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/code/[ref] — edit a code story's sidecar: its factory state and/or its epic
//
// The keyed lookup is by `ref` (the human id, KEY-N) — refs are unique per project by
// construction, so a single ref names one story. `ref` is NOT a UUID, so it is NOT
// validated with parseUUID. Drives the link-click write (in_refinement / in_development),
// the manual controls (Block / Abandon / hop), and the detail modal's move-to-epic dropdown.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ ref: string }> }) => {
    const { ref } = await context.params;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateCodeSchema);
    if (input instanceof Response) return input;

    // Moving the story to a different epic: an epic belongs to exactly one project, and a
    // story's ref/project_id are tied to its project, so re-homing it under an epic in another
    // project would desync them. Verify the target epic shares the story's project before
    // applying epic_id; reject otherwise. The UI only ever offers same-project epics, so this
    // is defence-in-depth, not the happy path.
    if (input.epic_id !== undefined) {
      const { data: story } = await supabase
        .from('code_items')
        .select('project_id')
        .eq('ref', ref)
        .single();
      const { data: epic } = await supabase
        .from('epics')
        .select('project_id')
        .eq('id', input.epic_id)
        .single();
      if (!story || epic?.project_id !== story.project_id) {
        return jsonError(400, 'Target epic must belong to the same project as the story');
      }
    }

    // Build the update from whichever fields the body carried (all optional): `factory_state`
    // and its `blocked_reason` companion exactly as before, plus `epic_id` when moving. A
    // present key — even null — is forwarded; an absent one is untouched.
    const updates: CodeItemUpdate = toUpdatePayload<CodeItemUpdate>(input, [
      'factory_state',
      'blocked_reason',
      'epic_id',
    ]);

    const { data, error } = await supabase
      .from('code_items')
      .update(updates)
      .eq('ref', ref)
      .select()
      .single();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data);
  },
);
