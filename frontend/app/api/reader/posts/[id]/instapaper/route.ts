import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostForSend, markReaderPostSent } from '@/lib/data/reader';
import { addBookmark, buildBookmarkParams } from '@/lib/instapaper/bookmark';
import { getInstapaperConfig } from '@/lib/instapaper/config';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/instapaper — save the post to the owner's Instapaper account
//
// The row's primary verb. It takes no body: the post's id is the whole request, and everything
// Instapaper is told comes out of the row, read here rather than sent from the browser.
//
// The call runs HERE and not in the browser because the four OAuth credentials must never reach
// it, and not in the Worker because the Worker is cron-driven with no endpoint a browser calls —
// while a send is a synchronous act the owner is waiting on. The PR-ratio route is the house
// pattern for the same shape: a server-only third-party credential, read by its literal name,
// with 501 meaning "this deployment doesn't do that" and 502 meaning "it does, and the upstream
// is unhappy right now".
//
// Node runtime, declared rather than inherited: the signer needs `node:crypto` for HMAC-SHA1 and
// the nonce, which the Edge runtime does not provide.
//
// Nothing is written unless Instapaper confirms the save. Every failure below leaves the row
// exactly as it was, which is what makes the store's optimistic send safe to roll back — and it
// is why the config check and the "nothing to send" check both run BEFORE any outbound call.
//
// No log line may carry the credentials, the Authorization header or the post's content: the
// post id, the outcome and the numeric error code are the whole of what is worth recording, and
// the rest is either a secret or the owner's reading.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';

/**
 * What the owner reads when Instapaper refuses. Keyed by Instapaper's own numeric error code —
 * its accompanying `message` is documented as not intended to be displayed to users, so it is
 * logged and never shown.
 *
 * The status beside each sentence is load-bearing for the store: a 422 is this post (the
 * publication opted out, the link was rejected), a 429 is "wait a minute", and a 502 is alfred's
 * own credentials or Instapaper itself — three different things for the owner to do next.
 */
const REFUSALS: Record<number, { status: number; message: string }> = {
  // The publication has asked Instapaper not to store its articles.
  1221: { status: 422, message: 'This publication has opted out of Instapaper' },
  // Instapaper could not fetch the article and was given no content to parse — a swept post
  // whose link Instapaper cannot read on its own.
  1220: {
    status: 422,
    message: "Instapaper can't fetch this post itself, and its stored text is gone",
  },
  1240: { status: 422, message: "Instapaper didn't accept this post's link" },
  1040: { status: 429, message: 'Instapaper is rate-limiting — try again in a minute' },
  1041: { status: 502, message: 'Instapaper says this needs a Premium account' },
  1042: { status: 502, message: "Instapaper rejected alfred's credentials" },
  401: { status: 502, message: "Instapaper rejected alfred's credentials" },
  403: { status: 502, message: "Instapaper rejected alfred's credentials" },
};

/** Any code not in the table, and every inconclusive answer, read the same way: try again. */
const UNAVAILABLE = { status: 502, message: "Instapaper didn't answer — try again" };

export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    // Ahead of the read as well as the call: an unconfigured deployment should cost nothing and
    // learn nothing about the post.
    const config = getInstapaperConfig();
    if (config === null) return jsonError(501, "Instapaper isn't set up on this deployment");

    const { data: post, error: readError } = await getReaderPostForSend(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const parameters = buildBookmarkParams(post);
    if (parameters === null) {
      // No web link and no body: there is no article and no address to find one at, so there is
      // nothing for Instapaper to save and no point asking it.
      return jsonError(409, 'Nothing to send — this post has no link and no stored text');
    }

    const outcome = await addBookmark(config, parameters);
    if (outcome.kind === 'refused') {
      console.error('instapaper send refused', { postId: id, code: outcome.code });
      const refusal = REFUSALS[outcome.code] ?? UNAVAILABLE;
      return jsonError(refusal.status, refusal.message);
    }
    if (outcome.kind === 'unavailable') {
      console.error('instapaper send unavailable', { postId: id });
      return jsonError(UNAVAILABLE.status, UNAVAILABLE.message);
    }

    const { data, error } = await markReaderPostSent(
      session.supabase,
      id,
      outcome.bookmarkId,
      new Date(),
      post.archived_at,
    );
    if (error) {
      // Instapaper HAS the post at this point, and the stamp is what the row's badge is drawn
      // from — so the owner sees a failure and a row still on the list. Pressing again is safe:
      // Instapaper moves an existing bookmark to the top rather than duplicating it.
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Post not found');

    return jsonOk(data);
  },
);
