import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { patchReaderPostSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { patchReaderPost } from '@/lib/data/reader';

// ---------------------------------------------------------------------------
// PATCH /api/reader/posts/[id] — the reading list's two verbs
//
// `{ archived: boolean }` stamps or clears `archived_at`; `{ opened: true }` stamps
// `opened_at`. The schema accepts `{ archived: false }` even though no UI sends it yet — the
// store has no unarchive action until the archive view exists (S2) — because the column is a
// plain boolean and there's no reason the route should refuse a direction the data model
// already supports. The row comes back through `READER_POST_LIST_COLUMNS`, so a patch response
// carries no `text` either, matching the seed and the GET route.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, patchReaderPostSchema);
    if (input instanceof Response) return input;

    const { data, error } = await patchReaderPost(session.supabase, id, input, new Date());
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Post not found');

    return jsonOk(data);
  },
);
