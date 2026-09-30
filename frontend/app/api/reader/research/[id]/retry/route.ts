import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPostForResearch } from '@/lib/data/reader';
import { researchPhase, researchRetryable } from '@/lib/reader/research';
import { getResearchConfig } from '@/lib/research/config';
import { fireAndRecord } from '@/lib/research/fire';
import { researchUnconfiguredResponse } from '@/lib/research/responses';

// ---------------------------------------------------------------------------
// POST /api/reader/research/[id]/retry — the row's "Retry research" verb
//
// Starts a new research session for a post that has none running: one whose fire was refused
// (failed), whose fire never happened (queued for over ten minutes) or whose session never
// reported back (researching for over three hours). `researchPhase` is the one function that says
// which — the row asks the same question to decide whether to offer the verb — and anything else
// answers 409, so a stale tab can't start a second session beside a live one.
//
// Then exactly what dispatch does for each post: claim, fire, and record the outcome — researching
// with the session link, or failed with the reason (a refused fire is a 200 with a failed row, not
// an error). The claim counts the attempt only while the post is as this request read it, so two
// retries racing on one post (two tabs, two devices) start one session: the loser answers 409 and
// fires nothing. The answer is the list-shaped row. A retried run that later delivers anyway is
// refused by the delivery route; the first report wins.
//
// If the outcome can't be recorded, this answers the write's error and leaves the post as it was:
// still failed or stalled, so it still offers Retry. (Dispatch can't do that — its items are
// already gone — but here nothing has been consumed.)
//
// Node runtime; one fire at its ten-second timeout, and the two queries around it, get 30 seconds.
// Logging is left to the fire, which names neither the token nor the brief.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 30;

export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    // Checked first: a deployment with no Routine has nothing to offer whatever the request says.
    const config = getResearchConfig();
    if (config === undefined) return researchUnconfiguredResponse();

    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const { data: post, error: readError } = await getReaderPostForResearch(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post?.source !== 'research') return jsonError(404, 'Post not found');

    if (!researchRetryable(researchPhase(post, new Date())) || post.research_brief === null) {
      return jsonError(409, 'Only a failed or stalled research post can be retried');
    }

    const { claimed, data, error } = await fireAndRecord(session.supabase, config, {
      id,
      research_brief: post.research_brief,
      research_attempts: post.research_attempts,
      research_state: post.research_state ?? 'failed',
    });
    if (!claimed && error === null) {
      return jsonError(409, 'This research is already being retried');
    }
    if (error !== null) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    // The write's guard matched nothing: a report landed (or the post went) while the fire was in
    // flight. The new session's own delivery will be refused; the first report stands.
    if (data === null) {
      return jsonError(409, 'The report arrived while retrying — reload to read it');
    }

    return jsonOk(data);
  },
);
