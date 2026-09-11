import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { addHandleSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { normalizeHandle } from '@/lib/comms';

// ---------------------------------------------------------------------------
// POST /api/comms/people/[id]/handles — give a person one more address or number
//
// Its own endpoint rather than a field on the person PATCH: handles arrive one at a time as the
// owner discovers them, and a whole-list write is how an address gets dropped by accident.
//
// Normalised here, as on the create route — the resolver only ever compares stored forms, so a
// handle that skipped normalisation would silently fail to match the messages it belongs to.
// A handle already claimed by someone else is a 409: one address resolves to one human.
// ---------------------------------------------------------------------------

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const personId = parseUUID(rawId);
    if (personId instanceof Response) return personId;
    const { supabase } = session;

    const input = await parseRequestBody(request, addHandleSchema);
    if (input instanceof Response) return input;

    const { data, error } = await supabase
      .from('comm_handles')
      .insert({ person_id: personId, handle: normalizeHandle(input.handle), kind: input.kind })
      .select()
      .single();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data, 201);
  },
);
