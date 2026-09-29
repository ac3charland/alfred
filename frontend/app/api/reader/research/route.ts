import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendItemsToResearchSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getResearchConfig } from '@/lib/research/config';
import { fireAndRecord } from '@/lib/research/fire';
import { researchUnconfiguredResponse } from '@/lib/research/responses';
import type { ReaderPost, ReaderPostListItem } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/reader/research — dispatch research rows from the Inbox to the Reader
//
// Each id must be an undispatched, childless ROOT research row — the first one that isn't is named
// in a 409 (a 404 when it isn't there at all), and nothing changes. Then `send_items_to_research`
// consumes the rows in one transaction: each becomes a queued Reader post carrying its brief and
// the item is deleted. Only after that commits is the research Routine fired — once per post,
// sequentially within this request, so a session always delivers to a post that exists and the
// request's fires fit its time budget (the Inbox may still send several requests at once; the
// Routine's cap is a daily count, so that costs nothing). Each fire is claimed on its post first and
// recorded as it lands: researching with the session link, or failed with the reason.
//
// A refused fire is not a failed request. The questions have left the Inbox either way; the answer
// carries each post as its fire left it, and a failed post says why in the Reader and offers Retry.
// A fire that could not be RECORDED (the patch write failed) is likewise logged, not answered as a
// failure — a 500 here would roll the rows back into an Inbox they are no longer in. The post is
// answered as the RPC created it, queued; with the claim's attempt on it, it reads after ten minutes
// as a run whose start was never confirmed and offers Retry. The session, if one started, delivers
// to it whatever state it is in.
//
// Up to five posts fit one request (`RESEARCH_SEND_MAX`): five fires at their ten-second timeout
// are inside the minute this route is given. Node runtime.
//
// Logging names posts and Postgres error codes and messages — never the fire token or a brief.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs';
export const maxDuration = 60;

/** The columns the checks read: the shape a research row must have to be dispatched. */
const ITEM_COLUMNS = 'id,title,item_type,parent_id,dispatched_at';

interface ItemForResearch {
  id: string;
  title: string;
  item_type: string;
  parent_id: string | null;
  dispatched_at: string | null;
}

/** Why research can't take this item, or `null` when it can. */
function refusal(item: ItemForResearch, hasChildren: boolean): string | null {
  if (item.item_type !== 'research') return 'is not a research item';
  if (item.parent_id !== null) return 'is a subtask';
  if (hasChildren) return 'has subtasks';
  if (item.dispatched_at !== null) return 'has already been dispatched';
  return null;
}

/** A created post as the list carries it: the brief and both bodies stay on the server. */
function toListItem(post: ReaderPost): ReaderPostListItem {
  const { text: _text, html: _html, research_brief: _brief, ...row } = post;
  return row;
}

export const POST = withSession(async (session, request) => {
  // Checked first: a deployment with no Routine has nothing to offer whatever the request says.
  const config = getResearchConfig();
  if (config === undefined) return researchUnconfiguredResponse();

  const input = await parseRequestBody(request, sendItemsToResearchSchema);
  if (input instanceof Response) return input;
  const ids = [...new Set(input.ids)];
  const { supabase } = session;

  const { data: rows, error: readError } = await supabase
    .from('items')
    .select(ITEM_COLUMNS)
    .in('id', ids);
  if (readError) {
    const { status, message } = mapSupabaseError(readError);
    return jsonError(status, message);
  }

  const { data: children, error: childrenError } = await supabase
    .from('items')
    .select('parent_id')
    .in('parent_id', ids);
  if (childrenError) {
    const { status, message } = mapSupabaseError(childrenError);
    return jsonError(status, message);
  }

  const byId = new Map<string, ItemForResearch>(rows.map((row) => [row.id, row]));
  const parents = new Set(children.map((child) => child.parent_id));
  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined) return jsonError(404, `Item ${id} not found`);
    const reason = refusal(item, parents.has(id));
    if (reason !== null) return jsonError(409, `Item ${id} ${reason}`);
  }

  const { data: created, error: rpcError } = await supabase.rpc('send_items_to_research', {
    p_ids: ids,
  });
  if (rpcError) {
    const { status, message } = mapSupabaseError(rpcError);
    return jsonError(status, message);
  }

  const posts: ReaderPostListItem[] = [];
  for (const post of created) {
    const { claimed, data, error } = await fireAndRecord(supabase, config, {
      id: post.id,
      research_brief: post.research_brief ?? post.title,
      research_attempts: post.research_attempts,
      research_state: post.research_state ?? 'queued',
    });
    if (error !== null || data === null) {
      // The code and message only: a constraint violation's `details` quotes the failing row,
      // brief and all.
      console.error(
        claimed
          ? 'research dispatch: fired, but could not record the outcome'
          : 'research dispatch: could not claim the post, so nothing was fired',
        { postId: post.id, code: error?.code, message: error?.message },
      );
      posts.push(toListItem(post));
    } else {
      posts.push(data);
    }
  }
  return jsonOk({ posts });
});
