import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostForSend, markReaderPostSent } from '@/lib/data/reader';
import { addBookmark, bookmarkFailure, buildBookmarkParams } from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/instapaper — save a post to the owner's Instapaper, and archive it
//
// No body. The route reads the post server-side (its bodies never reach the browser), signs a
// `bookmarks/add` with the four server-only credentials, and only once Instapaper confirms the
// save stamps the row: `instapaper_sent_at`, the bookmark id, and `archived_at` (kept when the
// post was already archived). Any failure writes nothing.
//
// 501 = this deployment has no Instapaper (checked before any read); 404 = no such post; 409 =
// nothing to send (no web link, no stored body); 422 / 429 / 502 = Instapaper said no, or didn't
// answer — each with a sentence the store toasts as is. Instapaper's own error message is never
// shown or logged; the log line carries the post id, the outcome kind and the error code only —
// never the credentials, the Authorization header, or the post's content.
// ---------------------------------------------------------------------------

// `node:crypto` signs the request.
export const runtime = 'nodejs';

export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const config = getInstapaperConfig();
    if (config === null) return jsonError(501, "Instapaper isn't set up on this deployment");

    const { data: post, error: readError } = await getReaderPostForSend(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const params = buildBookmarkParams(post);
    if (params === null) {
      return jsonError(409, 'Nothing to send — this post has no link and no stored text');
    }

    const outcome = await addBookmark(config, params);
    if (outcome.kind !== 'saved') {
      console.warn('reader instapaper: send failed', {
        postId: id,
        outcome: outcome.kind,
        code: outcome.kind === 'refused' ? outcome.code : undefined,
      });
      const { status, detail } = bookmarkFailure(outcome);
      return jsonError(status, detail);
    }

    const { data, error } = await markReaderPostSent(
      session.supabase,
      id,
      outcome.bookmarkId,
      new Date(),
      post.archived_at,
    );
    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Post not found');

    return jsonOk(data);
  },
);
