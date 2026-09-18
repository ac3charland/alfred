import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { updateReaderPublicationSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { updateReaderPublication } from '@/lib/data/reader-publications';

// ---------------------------------------------------------------------------
// PATCH /api/reader/publications/[id] — pause, resume, rename or annotate one publication
//
// The handle is never in `updateReaderPublicationSchema`, so it can never reach this route: it
// is the join key every post is matched against, and changing it would orphan history rather
// than rename it.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, updateReaderPublicationSchema);
    if (input instanceof Response) return input;

    const { data, error } = await updateReaderPublication(session.supabase, id, input);
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Publication not found');

    return jsonOk(data);
  },
);
