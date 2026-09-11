import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { clearMessageSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { readCommAccount, readCommMessage, recordCommCorrection } from '@/lib/data/comms-messages';
import type { CommMessageUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/comms/messages/[id]/clear — the owner's two clearing verbs
//
// There are exactly three ways out of the queue: a detected reply, an Inbox item, and this.
// This one is the fallback for the ask nobody will ever answer, and it is TWO verbs rather than
// one because they are opposite signals and only one of them may reach the example set:
//
//   - `not_replying`      — the verdict was right, and the owner is declining. Records nothing.
//   - `nothing_to_answer` — the row should never have been queued. Records a demotion to FYI,
//                           which is the correction the recall bias makes most common and the
//                           one the example set would otherwise starve for.
//
// The demotion also re-tiers the row to `fyi` and stamps `judged_by: 'owner'`: the owner has
// just judged it, and a row left on a counted tier while cleared would keep the wrong answer on
// the record the example set is drawn from.
// ---------------------------------------------------------------------------

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, clearMessageSchema);
    if (input instanceof Response) return input;

    const { data: message, error: loadError } = await readCommMessage(supabase, id);
    if (loadError) {
      const { status, message: text } = mapSupabaseError(loadError);
      return jsonError(status, text);
    }
    if (message === null) return jsonError(404, 'Message not found');

    const clearedAt = new Date().toISOString();
    const updates: CommMessageUpdate = { cleared_at: clearedAt, cleared_by: input.exit };

    if (input.exit === 'nothing_to_answer') {
      // The account's label is denormalised onto the correction so the example outlives the
      // message the 60-day sweep will eventually take.
      const { data: account, error: accountError } = await readCommAccount(
        supabase,
        message.account_id,
      );
      if (accountError) {
        const { status, message: text } = mapSupabaseError(accountError);
        return jsonError(status, text);
      }

      const { error: correctionError } = await recordCommCorrection(supabase, {
        message,
        accountLabel: account?.label ?? 'unknown account',
        chosenTier: 'fyi',
        kind: 'nothing_to_answer',
      });
      // The correction is the whole point of this verb, so a failed insert is a failed clear —
      // clearing anyway would spend the gesture and teach nothing.
      if (correctionError) {
        const { status, message: text } = mapSupabaseError(correctionError);
        return jsonError(status, text);
      }

      updates.tier = 'fyi';
      updates.judged_by = 'owner';
    }

    const { data, error } = await supabase
      .from('comm_messages')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      const { status, message: text } = mapSupabaseError(error);
      return jsonError(status, text);
    }

    return jsonOk(data);
  },
);
