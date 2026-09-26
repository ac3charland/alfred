import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendReaderIdeasSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import {
  appendWikiSentIdeas,
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
// POST /api/reader/posts/[id]/wiki — send picked Novel-ideas bullets into the wiki
//
// One request is one commit: the post's text as `source.md` plus the picked bullets as
// `picks-<today>.md`, in a brand-new `inbox/` folder. The bullets must still be in the post's
// current overview (a re-summarise can reword them underneath an open tab), and any already sent
// are dropped — a send with nothing left to send answers the row unchanged and commits nothing.
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

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    // Checked first: a deployment with no writer has nothing to offer whatever the request says,
    // and must not read the post's body for a send it cannot make.
    const config = getWikiConfig();
    if (config === undefined) return wikiUnconfiguredResponse();

    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;

    const input = await parseRequestBody(request, sendReaderIdeasSchema);
    if (input instanceof Response) return input;

    const { data: post, error: readError } = await getReaderPostForWiki(session.supabase, id);
    if (readError) {
      const { status, message } = mapSupabaseError(readError);
      return jsonError(status, message);
    }
    if (post === null) return jsonError(404, 'Post not found');

    const offered = new Set(isReaderOverview(post.overview) ? post.overview.novel_ideas : []);
    if (input.ideas.some((idea) => !offered.has(idea))) return jsonError(409, STALE_IDEA);

    const sent = new Set(post.wiki_sent_ideas);
    const fresh = [...new Set(input.ideas)].filter((idea) => !sent.has(idea));

    if (fresh.length === 0) {
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

    const { data: saved, error: appendError } = await appendWikiSentIdeas(
      session.supabase,
      id,
      fresh,
    );
    if (appendError || saved === null) {
      // The commit is in the wiki; only the mark is missing — see the header comment.
      console.error(
        'reader wiki send: committed, but could not record the sent ideas',
        appendError,
      );
      return jsonError(500, "Sent to the wiki, but couldn't mark the ideas as sent");
    }
    return jsonOk(saved);
  },
);
