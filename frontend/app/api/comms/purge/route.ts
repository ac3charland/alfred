import { withSession } from '@/lib/api/auth';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { purgeSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// POST /api/comms/purge — the deliberate "I want this gone"
//
// Distinct from the 60-day retention sweep in the one way that matters: the sweep leaves the
// example set alone, and this CASCADES into it, stripping the denormalised text from every
// correction it reaches. A delete that left the message's words sitting in a few-shot example
// would be theatre, and this is the action that has to actually work.
//
// The whole thing is one `comm_purge` call rather than a delete plus a follow-up update,
// because the cascade has to be atomic: a purge that removed the messages and then failed
// half-way through the corrections would leave exactly the text the owner asked to destroy.
//
// The schema refuses a bodiless purge — with no selector at all this would delete the entire
// mirror, which is never something to reach by accident.
// ---------------------------------------------------------------------------

export const POST = withSession(async (session, request) => {
  const { supabase } = session;

  const input = await parseRequestBody(request, purgeSchema);
  if (input instanceof Response) return input;

  // Each selector is LEFT OFF when absent rather than sent as null: every argument defaults to
  // NULL in SQL, so an omitted one already means "don't narrow on this" — and under
  // exactOptionalPropertyTypes an explicit `undefined` is not the same as an absent key.
  const args: { p_message?: string; p_account?: string; p_before?: string } = {};
  if (input.message_id !== undefined) args.p_message = input.message_id;
  if (input.account_id !== undefined) args.p_account = input.account_id;
  if (input.before !== undefined) args.p_before = input.before;

  const { data, error } = await supabase.rpc('comm_purge', args);

  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk({ purged: data });
});
