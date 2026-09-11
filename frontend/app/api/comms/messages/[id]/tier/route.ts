import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { changeTierSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { readCommAccount, readCommMessage, recordCommCorrection } from '@/lib/data/comms-messages';
import type { CommMessageUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// POST /api/comms/messages/[id]/tier — the owner overriding the model
//
// Its own endpoint rather than a generic message PATCH because it RECORDS: every tier change is
// a correction and a few-shot example, and the most valuable one the set can hold is a
// promotion out of `fyi` — tier membership is also the entry ticket to the queue, so that
// promotion corrects the obligation judgment rather than the urgency. It is the only path back
// from a false negative, which is the failure the whole module is organised against.
//
// Which is also why a promotion clears the exit: a shelved row the owner drags back into a
// counted tier is a row they mean to answer, and one that stayed cleared would be corrected in
// the example set and still invisible in the queue.
// ---------------------------------------------------------------------------

export const POST = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, changeTierSchema);
    if (input instanceof Response) return input;

    const { data: message, error: loadError } = await readCommMessage(supabase, id);
    if (loadError) {
      const { status, message: text } = mapSupabaseError(loadError);
      return jsonError(status, text);
    }
    if (message === null) return jsonError(404, 'Message not found');

    // Picking the tier a row is already in is not a correction — recording one would teach the
    // model to agree with itself and would bump the example-set version for nothing.
    if (message.tier === input.tier) return jsonOk(message);

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
      chosenTier: input.tier,
      kind: 'tier_change',
    });
    if (correctionError) {
      const { status, message: text } = mapSupabaseError(correctionError);
      return jsonError(status, text);
    }

    const updates: CommMessageUpdate = { tier: input.tier, judged_by: 'owner' };
    if (input.tier !== 'fyi') {
      updates.cleared_at = null;
      updates.cleared_by = null;
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
