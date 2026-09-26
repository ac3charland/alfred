import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { sendItemsToWikiSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { WikiWriteError, commitEnvelopes } from '@/lib/wiki/writer/commit';
import { getWikiConfig } from '@/lib/wiki/writer/config';
import { knowledgeEnvelope } from '@/lib/wiki/writer/envelope';
import { todayUtc } from '@/lib/wiki/writer/paths';
import { wikiUnconfiguredResponse, wikiWriteErrorResponse } from '@/lib/wiki/writer/responses';

// ---------------------------------------------------------------------------
// POST /api/wiki/items — dispatch knowledge rows from the Inbox into the wiki
//
// One request is one commit: each item becomes its own brand-new `inbox/` folder holding one
// `notes-<today>.md`, so a bulk dispatch starts one filing batch on the wiki's side, not N. Every
// id must be an undispatched, childless ROOT knowledge row — the first one that isn't is named in
// a 409 (a 404 when it isn't there at all), and nothing is committed.
//
// The commit lands BEFORE `send_items_to_wiki` stamps the rows dispatched (which logs any
// classifier correction) and deletes them — an idea deleted from Alfred that never reached the
// wiki is the one outcome this order rules out. So if the RPC fails after the commit, the route
// answers 500 and the client rolls the rows back into the Inbox although their notes are in the
// wiki. A same-day retry commits byte-identical notes files, which the wiki's filing drops; a
// retry on a later day files a second notes file into the same source folder — a repeated note,
// never a lost one.
// ---------------------------------------------------------------------------

/** The columns the send reads: the envelope's four, plus the shape the checks below need. */
const ITEM_COLUMNS = 'id,title,notes,source_url,item_type,parent_id,dispatched_at';

interface ItemForWiki {
  id: string;
  title: string;
  notes: string | null;
  source_url: string | null;
  item_type: string;
  parent_id: string | null;
  dispatched_at: string | null;
}

/** Why the wiki can't take this item, or `null` when it can. */
function refusal(item: ItemForWiki, hasChildren: boolean): string | null {
  if (item.item_type !== 'knowledge') return 'is not a knowledge item';
  if (item.parent_id !== null) return 'is a subtask';
  if (hasChildren) return 'has subtasks';
  if (item.dispatched_at !== null) return 'has already been dispatched';
  return null;
}

export const POST = withSession(async (session, request) => {
  // Checked first: a deployment with no writer has nothing to offer whatever the request says.
  const config = getWikiConfig();
  if (config === undefined) return wikiUnconfiguredResponse();

  const input = await parseRequestBody(request, sendItemsToWikiSchema);
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

  const byId = new Map<string, ItemForWiki>(rows.map((row) => [row.id, row]));
  const parents = new Set(children.map((child) => child.parent_id));
  const items: ItemForWiki[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item === undefined) return jsonError(404, `Item ${id} not found`);
    const reason = refusal(item, parents.has(id));
    if (reason !== null) return jsonError(409, `Item ${id} ${reason}`);
    items.push(item);
  }

  const captured = todayUtc(new Date());
  try {
    await commitEnvelopes(
      config,
      items.map((item) => knowledgeEnvelope(item, captured)),
    );
  } catch (error) {
    if (error instanceof WikiWriteError) return wikiWriteErrorResponse(error);
    throw error;
  }

  const { error: rpcError } = await supabase.rpc('send_items_to_wiki', { p_ids: ids });
  if (rpcError) {
    // The notes are in the wiki; only the stamp-and-delete is missing — see the header comment.
    console.error('wiki items send: committed, but could not remove the items', rpcError);
    return jsonError(500, "Sent to the wiki, but couldn't remove the items from the Inbox");
  }
  return jsonOk({ sent: ids });
});
