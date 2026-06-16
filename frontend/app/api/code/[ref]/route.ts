import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateCodeSchema } from '@/lib/api/schemas';
import type { CodeItemUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/code/[ref] — transition a code story to a new factory state
//
// The keyed lookup is by `ref` (the human id, KEY-N) — refs are unique per project by
// construction, so a single ref names one story. Drives both the link-click write
// (in_refinement / in_development) and the manual controls (Block / Abandon / hop).
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ ref: string }> }) => {
    const { ref } = await context.params;
    const { supabase } = session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'Invalid JSON body');
    }

    const parsed = updateCodeSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, 'Invalid request body', parsed.error.issues);
    }

    // PATCH semantics: set only the fields the caller actually provided. `blocked_reason`
    // is sent as null to clear it (the null-aware api-client decides when), so a present
    // key — even null — is forwarded; an absent one is left untouched.
    const d = parsed.data;
    const updates: CodeItemUpdate = { factory_state: d.factory_state };
    if (d.blocked_reason !== undefined) updates.blocked_reason = d.blocked_reason;

    const { data, error } = await supabase
      .from('code_items')
      .update(updates)
      .eq('ref', ref)
      .select()
      .single();

    if (error) return jsonError(500, error.message);

    return jsonOk(data);
  },
);
