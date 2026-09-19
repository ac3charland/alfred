import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { patchReaderPostSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostResummarizeState, patchReaderPost } from '@/lib/data/reader';

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
// attempts and file the row failed all over again. That pre-read never asks for `text` itself —
// `word_count` says whether there is a body just as well, without pulling tens of KB across the
// wire to null-check it. The list payload carries `text_swept_at` and `word_count` so the UI
// hides the verb in those cases — the refusals below are what a stale tab gets, and they say
// which of the three reasons applies rather than a bare "no". The third is the row already being
// on the worklist: re-queueing a post the tick has leased would clear that lease and reset its
// attempts mid-run, so the same post is summarised twice. That third rule rides in the write's
// own WHERE clause as well, so a lease taken in the gap between the two statements is refused
// rather than trampled.
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

    const resummarizing = 'resummarize' in input;
    if (resummarizing) {
      const { data: stored, error: readError } = await getReaderPostResummarizeState(
        session.supabase,
        id,
      );
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
      if (stored.word_count === 0) {
        return jsonError(409, 'Post has no stored text to summarise');
      }
      // Last, because a row that cannot be summarised at all should hear that rather than
      // "wait a moment".
      if (stored.summary_state === 'pending') {
        return jsonError(409, 'That post is already queued for a summary');
      }
    }

    const { data, error } = await patchReaderPost(session.supabase, id, input, new Date());
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    // The write carries the queue rule too, so for a re-summarise whose pre-read DID find the
    // row, nothing coming back means the tick leased it in between — the row is there, the verb
    // is refused, and that is the same answer the pre-read would have given a moment later.
    if (data === null) {
      return resummarizing
        ? jsonError(409, 'That post is already queued for a summary')
        : jsonError(404, 'Post not found');
    }

    return jsonOk(data);
  },
);
