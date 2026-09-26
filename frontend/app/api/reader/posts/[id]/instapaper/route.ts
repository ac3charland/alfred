import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostForSend, markReaderPostSent } from '@/lib/data/reader';
import { addBookmark, buildBookmarkParams, sendFailureResponse } from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/instapaper — the row's Send verb
//
// Saves the post to the owner's Instapaper and, once Instapaper confirms, stamps it sent and
// archives it: once a post is in Instapaper, that is where it lives. No request body — everything
// the bookmark is built from is read here, server-side, because the body sent is the post's own
// email HTML (or its stored text) and the credentials it is signed with must never reach the
// browser. Node runtime, for `node:crypto`.
//
// The order is the design. Configuration first, so an unconfigured deployment (the Work
// instance, local dev) answers 501 before touching the database or the network. Then the read,
// then Instapaper, and only on a confirmed save the write — a refused or failed send leaves the
// row exactly as it was. Every failure answers with a sentence the owner's toast can say as-is.
// If the stamp itself fails after Instapaper saved the post, the store rolls the row back and a
// second press is safe: Instapaper moves an existing bookmark to the top rather than duplicating it.
//
// Logging names the post, the outcome and Instapaper's error code — never the credentials, the
// signed Authorization header, or the post's body.
// ---------------------------------------------------------------------------

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
      console.warn('reader: instapaper send saved nothing', {
        postId: id,
        outcome: outcome.kind,
        code: outcome.code,
      });
      const { status, detail } = sendFailureResponse(outcome);
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
