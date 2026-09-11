import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { askLine } from '@/lib/comms/ask';
import { messageDeepLink } from '@/lib/comms/deep-link';
import { readCommAccount, readCommMessage } from '@/lib/data/comms-messages';
import type { CommMessage, Item } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/comms/messages/[id]/inbox-item — the third way out of the queue
//
// Spinning a message into a task stays a human act, but it is ONE action from the row, and it
// clears the row at that moment. Without the clear, the owner would be tracking one obligation
// in two places — the duplicated-inbox failure the module exists to remove — and the comms row
// could never drain, since nobody ever replies to a message they turned into a task.
//
// The message itself is untouched: alfred mirrors and never writes back. It is the ROW that
// clears, and the new item carries the link back through `source_url`.
//
// The write itself is a single `comm_create_inbox_item` RPC (0034_comms.sql): the INSERT into
// `items` and the UPDATE of `comm_messages` commit together, and the idempotency guard — reuse
// the linked item on a retry rather than minting a second, orphaned one — lives INSIDE that
// function, where the check-then-write is one round trip with no gap for a retry to land in.
// This route only computes what the RPC needs (title, notes, the deep link — plain TypeScript,
// not SQL) and reports the shape the RPC hands back.
// ---------------------------------------------------------------------------

/** How much of a body travels into the item's notes before it stops being a summary. */
const NOTES_BODY_LENGTH = 2000;

/** What `comm_create_inbox_item` returns, beyond the item and message the response carries. */
interface InboxItemRpcResult {
  item: Item;
  message: CommMessage;
  /** true = a fresh item was minted this call; false = an already-linked item was reused. */
  created: boolean;
}

/**
 * Narrow the RPC's `json` return (typed `Json` — a union too wide to index) to the shape this
 * route relies on. The function's own contract guarantees the fields; this is the one place
 * that trusts it, the same trust boundary every other route places in the generated `Database`
 * types for an ordinary table read.
 */
function isInboxItemRpcResult(value: unknown): value is InboxItemRpcResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'item' in value &&
    'message' in value &&
    'created' in value &&
    typeof value.created === 'boolean'
  );
}

export const POST = withSession(
  async (session, _request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const { data: message, error: loadError } = await readCommMessage(supabase, id);
    if (loadError) {
      const { status, message: text } = mapSupabaseError(loadError);
      return jsonError(status, text);
    }
    if (message === null) return jsonError(404, 'Message not found');

    const { data: account, error: accountError } = await readCommAccount(
      supabase,
      message.account_id,
    );
    if (accountError) {
      const { status, message: text } = mapSupabaseError(accountError);
      return jsonError(status, text);
    }

    const sender = message.sender_name ?? message.sender_handle;
    const accountLabel = account?.label ?? 'unknown account';
    const body = message.body.trim().slice(0, NOTES_BODY_LENGTH);
    // The link back is the deep link the row itself offers, so the item opens the same place the
    // row would have. A row with nothing to open carries no URL rather than a broken one.
    const { href } = messageDeepLink(message, account ?? undefined);

    // `p_source_url` is LEFT OFF when there is nothing to open, rather than sent as null: the
    // generated arg type has no `| null` (Postgres gives the route no way to say "the caller
    // deliberately passed nothing" versus "not provided"), so an omitted key is how "no link"
    // reaches the default-NULL parameter — the same convention `/api/comms/purge` uses.
    const args: { p_message: string; p_title: string; p_notes: string; p_source_url?: string } = {
      p_message: id,
      // The ask is the title, because the ask is what the obligation IS — a subject line would
      // import the ambiguity the module exists to resolve.
      p_title: askLine(message),
      p_notes: `From ${sender} via ${accountLabel}\n\n${body}`,
    };
    if (href !== undefined) args.p_source_url = href;

    const { data, error } = await supabase.rpc('comm_create_inbox_item', args);

    if (error) {
      const { status, message: text } = mapSupabaseError(error);
      return jsonError(status, text);
    }
    if (!isInboxItemRpcResult(data)) {
      return jsonError(500, 'comm_create_inbox_item returned an unexpected shape');
    }

    return jsonOk({ message: data.message, item: data.item }, data.created ? 201 : 200);
  },
);
