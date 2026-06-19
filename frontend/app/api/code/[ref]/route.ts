import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateCodeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { toUpdatePayload } from '@/lib/api/updates';
import type { CodeItemUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/code/[ref] — transition a code story to a new factory state
//
// The keyed lookup is by `ref` (the human id, KEY-N) — refs are unique per project by
// construction, so a single ref names one story. `ref` is NOT a UUID, so it is NOT
// validated with parseUUID. Drives both the link-click write (in_refinement /
// in_development) and the manual controls (Block / Abandon / hop).
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ ref: string }> }) => {
    const { ref } = await context.params;
    const { supabase } = session;

    const input = await parseRequestBody(request, updateCodeSchema);
    if (input instanceof Response) return input;

    // `factory_state` is required; `blocked_reason` is the optional companion (sent as null
    // to clear it). A present key — even null — is forwarded; an absent one is untouched.
    const updates: CodeItemUpdate = {
      factory_state: input.factory_state,
      ...toUpdatePayload<CodeItemUpdate>(input, ['blocked_reason']),
    };

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
