import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostForSend, markReaderPostSent } from '@/lib/data/reader';
import {
  NOTHING_TO_SEND,
  NOT_CONFIGURED,
  addBookmark,
  buildBookmarkParams,
  sendFailure,
} from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/instapaper — the row's primary verb
//
// Saves the post to the owner's Instapaper account and archives it here. Server-side because the
// four OAuth credentials must never reach the browser, and synchronous because the owner is
// watching the row leave: a send that quietly retried later would be a verb whose outcome they
// can't see.
//
// The bookmark carries the post's own email HTML (or its stored text, for a post ingested before
// the HTML was kept), so a paid post arrives whole rather than as the web paywall's teaser. This
// is the only frontend reader of either body, and neither ever leaves it: the answer is the list
// row, through the same column list as every other Reader read.
//
// Nothing is written unless Instapaper confirms the save. Every refusal answers in a sentence
// for the owner rather than Instapaper's own message, which its docs say is not meant for users.
// The log line names the post, the outcome and Instapaper's error code — never a credential, the
// signed header, or the post's content.
// ---------------------------------------------------------------------------

export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    // Before any read: a deployment without credentials has nothing to do with the post at all.
    const config = getInstapaperConfig();
    if (config === null) return jsonError(NOT_CONFIGURED.status, NOT_CONFIGURED.message);

    const { data: post, error: readError } = await getReaderPostForSend(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const params = buildBookmarkParams(post);
    if (params === null) return jsonError(NOTHING_TO_SEND.status, NOTHING_TO_SEND.message);

    const outcome = await addBookmark(config, params);
    if (outcome.kind !== 'saved') {
      console.error('reader instapaper send: not saved', {
        id,
        outcome: outcome.kind,
        code: outcome.kind === 'refused' ? outcome.code : undefined,
      });
      const { status, message } = sendFailure(outcome);
      return jsonError(status, message);
    }

    const { data, error } = await markReaderPostSent(
      session.supabase,
      id,
      outcome.bookmarkId,
      new Date(),
      post.archived_at,
    );
    if (error) {
      // Instapaper has the post; only the stamp is missing. Re-sending is safe for a post with a
      // public link — Instapaper moves an existing bookmark to the top rather than duplicating it.
      console.error('reader instapaper send: saved but not stamped', {
        id,
        bookmarkId: outcome.bookmarkId,
      });
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }

    return jsonOk(data);
  },
);
