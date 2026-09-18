import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { patchReaderPostSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostText, patchReaderPost } from '@/lib/data/reader';

// ---------------------------------------------------------------------------
// PATCH /api/reader/posts/[id] — the row's verbs
//
// `{ archived: boolean }` stamps or clears `archived_at`; `{ opened: true }` stamps `opened_at`;
// `{ resummarize: true }` puts the row back on the tick's worklist. The schema accepts
// `{ archived: false }` even though no UI sends it yet — the column is a plain boolean and
// there's no reason the route should refuse a direction the data model already supports. The row
// comes back through `READER_POST_LIST_COLUMNS`, so a patch response carries no `text` either,
// matching the seed and the GET route.
//
// Re-summarising reads the row first, because the tick summarises from the STORED text and the
// retention sweep eventually takes it: queueing a post whose body is gone would burn three
// attempts and file the row failed all over again. The list payload carries `text_swept_at` so
// the UI hides the verb in that case — the refusals below are what a stale tab gets, and they
// say which of the two reasons applies rather than a bare "no".
// ---------------------------------------------------------------------------

const MONTH_DAY_YEAR: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  // The sweep's cutoff is computed in the database, in UTC; naming the same day back in the
  // server's local zone would put the stamp a day out either side of midnight.
  timeZone: 'UTC',
};

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, patchReaderPostSchema);
    if (input instanceof Response) return input;

    if ('resummarize' in input) {
      const { data: stored, error: readError } = await getReaderPostText(session.supabase, id);
      if (readError) {
        const { status, message } = mapSupabaseError(readError);
        return jsonError(status, message);
      }
      if (stored === null) return jsonError(404, 'Post not found');

      // The stamp is checked ahead of the body, so a swept post is told it was swept rather than
      // that it never had anything — the two have different answers for the owner.
      if (stored.text_swept_at !== null) {
        const swept = new Date(stored.text_swept_at).toLocaleDateString('en-US', MONTH_DAY_YEAR);
        return jsonError(409, `Post text was swept on ${swept}`);
      }
      if (stored.text === null) return jsonError(409, 'Post has no stored text to summarise');
    }

    const { data, error } = await patchReaderPost(session.supabase, id, input, new Date());
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Post not found');

    return jsonOk(data);
  },
);
