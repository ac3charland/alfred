import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendReaderPicksSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  appendWikiSentPicks,
  getReaderPostForWiki,
  getReaderPostListItem,
} from '@/lib/data/reader';
import { isReaderOverview } from '@/lib/reader/overview';
import { WikiWriteError, commitEnvelopes } from '@/lib/wiki/writer/commit';
import { getWikiConfig } from '@/lib/wiki/writer/config';
import { readerEnvelope } from '@/lib/wiki/writer/envelope';
import { todayUtc } from '@/lib/wiki/writer/paths';
import { wikiUnconfiguredResponse, wikiWriteErrorResponse } from '@/lib/wiki/writer/responses';

// ---------------------------------------------------------------------------
// POST /api/reader/posts/[id]/wiki — send picked Novel-ideas and Evidence bullets into the wiki
//
// One request is one commit, whatever mix of the two sections it carries: the post's text as
// `source.md` plus the picked bullets as `picks-<today>.md`, headed per section, in a brand-new
// `inbox/` folder. A research report is the exception: its text is the model's own words, so it is
// never filed as a source, and its envelope holds the picks alone (see `readerEnvelope`). Each list
// must still be in its own section of the post's current overview (a re-summarise can reword them
// underneath an open tab), and any already sent are dropped, each list against its own sent
// column — a send with nothing left in either list answers the row unchanged and commits nothing.
// A tab on an older bundle posts `{ ideas }` alone, which still works.
//
// The commit lands BEFORE the sent marks are recorded, deliberately. Reserving the bullets first
// and un-reserving them on a failed commit risks the worse outcome: a bullet marked sent that
// never reached the wiki. So if the append fails after the commit, the route answers 500 and the
// bullet still reads unsent although it is in the wiki. A same-day retry commits a byte-identical
// picks file, which the wiki's filing drops; a retry on a later day files the bullet twice — a
// repeated citation, never a lost idea.
//
// The row is read with its body (the envelope needs it) but answered through the list columns,
// so `text` never reaches the client.
// ---------------------------------------------------------------------------

const STALE_IDEA = "That idea isn't in this post's overview any more";
const STALE_EVIDENCE = "That evidence isn't in this post's overview any more";

/** Each picked bullet once, in the order picked, minus those already sent. */
function freshOf(picked: readonly string[], sent: readonly string[]): string[] {
  const held = new Set(sent);
  return [...new Set(picked)].filter((bullet) => !held.has(bullet));
}

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    // Checked first: a deployment with no writer has nothing to offer whatever the request says,
    // and must not read the post's body for a send it cannot make.
    const config = getWikiConfig();
    if (config === undefined) return wikiUnconfiguredResponse();

    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, sendReaderPicksSchema);
    if (input instanceof Response) return input;
    const { ideas = [], evidence = [] } = input;

    const { data: post, error: readError } = await getReaderPostForWiki(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const overview = isReaderOverview(post.overview) ? post.overview : null;
    const offeredIdeas = new Set(overview?.novel_ideas);
    if (ideas.some((idea) => !offeredIdeas.has(idea))) return jsonError(409, STALE_IDEA);
    const offeredEvidence = new Set(overview?.evidence);
    if (evidence.some((item) => !offeredEvidence.has(item))) {
      return jsonError(409, STALE_EVIDENCE);
    }

    const fresh = {
      ideas: freshOf(ideas, post.wiki_sent_ideas),
      evidence: freshOf(evidence, post.wiki_sent_evidence),
    };

    if (fresh.ideas.length === 0 && fresh.evidence.length === 0) {
      const { data: row, error } = await getReaderPostListItem(session.supabase, id);
      if (error) {
        const { status, message } = mapSupabaseError(error);
        return jsonError(status, message);
      }
      if (row === null) return jsonError(404, 'Post not found');
      return jsonOk(row);
    }

    try {
      await commitEnvelopes(config, [readerEnvelope(post, fresh, todayUtc(new Date()))]);
    } catch (error) {
      if (error instanceof WikiWriteError) return wikiWriteErrorResponse(error);
      throw error;
    }

    const { data: saved, error: appendError } = await appendWikiSentPicks(
      session.supabase,
      id,
      fresh,
    );
    if (appendError || saved === null) {
      // The commit is in the wiki; only the marks are missing — see the header comment.
      console.error(
        'reader wiki send: committed, but could not record the sent bullets',
        appendError,
      );
      return jsonError(500, "Sent to the wiki, but couldn't mark the bullets as sent");
    }
    return jsonOk(saved);
  },
);
