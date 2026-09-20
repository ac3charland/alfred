import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { createReaderPublicationSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { createReaderPublication, getReaderPublications } from '@/lib/data/reader-publications';

// ---------------------------------------------------------------------------
// GET /api/reader/publications — the roster, ordered by name
// POST /api/reader/publications — put a sender on the roster by hand
//
// POST returns the stored TABLE row, not the view: a publication created a moment ago has no
// posts yet, so there is no derived `last_post_at` to report and the client fills in `null`
// itself rather than this route re-reading the view for a value it already knows.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { data, error } = await getReaderPublications(session.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});

export const POST = withSession(async (session, request) => {
  const input = await parseRequestBody(request, createReaderPublicationSchema);
  if (input instanceof Response) return input;

  const { data, error } = await createReaderPublication(session.supabase, input);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data, 201);
});
