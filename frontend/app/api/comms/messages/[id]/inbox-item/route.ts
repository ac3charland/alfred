import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { askLine } from '@/lib/comms/ask';
import { messageDeepLink } from '@/lib/comms/deep-link';
import { readCommAccount, readCommMessage } from '@/lib/data/comms-messages';

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
// ---------------------------------------------------------------------------

/** How much of a body travels into the item's notes before it stops being a summary. */
const NOTES_BODY_LENGTH = 2000;

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

    const { data: item, error: itemError } = await supabase
      .from('items')
      .insert({
        // The ask is the title, because the ask is what the obligation IS — a subject line
        // would import the ambiguity the module exists to resolve.
        title: askLine(message),
        notes: `From ${sender} via ${accountLabel}\n\n${body}`,
        source_url: href ?? null,
        // Untriaged, exactly like a capture: where it belongs is the Inbox's question, not this
        // route's.
        item_type: 'unclassified',
        status: 'active',
      })
      .select()
      .single();

    if (itemError) {
      const { status, message: text } = mapSupabaseError(itemError);
      return jsonError(status, text);
    }

    const { data: updated, error } = await supabase
      .from('comm_messages')
      .update({
        inbox_item_id: item.id,
        cleared_at: new Date().toISOString(),
        cleared_by: 'inbox_item',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const { status, message: text } = mapSupabaseError(error);
      return jsonError(status, text);
    }

    return jsonOk({ message: updated, item }, 201);
  },
);
