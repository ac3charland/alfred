import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { parseRequestBody } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { pruneExampleSchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import type { CommCorrectionUpdate } from '@/lib/types';

// ---------------------------------------------------------------------------
// PATCH /api/comms/examples/[id] — take a correction out of the prompt's example set, or put it
// back
//
// A flag, never a DELETE: the correction itself is the record that the owner disagreed with the
// model, and that record survives whether or not the row still steers anything.
//
// Only `pruned_at` is written. The set version is stamped by the database trigger, so no writer
// can forget to bump it and no two writers can disagree about the count — which is what makes a
// verdict stamped "set v7" reconstructable from the rows alone.
//
// Un-pruning clears BOTH columns, which re-admits the row and, deliberately, forgets that it was
// ever out: a row pruned at v7 and restored at v9 afterwards reads as though it had been a member
// the whole way through, so a verdict stamped v8 reconstructs a set slightly larger than the one
// it actually saw. A membership table would fix that; for one owner correcting their own
// classifier it is not worth the second table, and the alternative — refusing to un-prune — would
// make a mis-click permanent.
// ---------------------------------------------------------------------------

export const PATCH = withSession(
  async (session, request, context: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await context.params;
    const id = parseUUID(rawId);
    if (id instanceof Response) return id;
    const { supabase } = session;

    const input = await parseRequestBody(request, pruneExampleSchema);
    if (input instanceof Response) return input;

    // The migration's CHECK keeps `pruned_at` and `pruned_version` null together, so the restore
    // has to clear the stamp the trigger wrote rather than leave it behind.
    const updates: CommCorrectionUpdate = input.pruned
      ? { pruned_at: new Date().toISOString() }
      : { pruned_at: null, pruned_version: null };

    const { data, error } = await supabase
      .from('comm_corrections')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      const { status, message } = mapSupabaseError(error);
      return jsonError(status, message);
    }
    if (data === null) return jsonError(404, 'Example not found');

    return jsonOk(data);
  },
);
