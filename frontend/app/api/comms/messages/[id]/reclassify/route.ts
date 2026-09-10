import { withSession } from '@/lib/api/auth';
import { parseUUID } from '@/lib/api/params';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { readCommMessage } from '@/lib/data/comms-messages';

// ---------------------------------------------------------------------------
// POST /api/comms/messages/[id]/reclassify — ask for one row to be judged again
//
// Nothing is ever re-judged silently: editing the rubric, the roster or the example set sweeps
// nothing, because a verdict the owner has already seen — and possibly already acted on —
// moving underneath them costs more trust than a stale tier costs attention. So a re-run is
// always an explicit act on an explicit row, and this endpoint only ever REQUESTS one.
//
// The attempt counter is reset with the request, which is what makes this reach a row the
// classification ceiling has already given up on — the marked, unjudged rows this verb exists
// for. The new verdict arrives later, over the realtime stream; the response is just the row
// carrying its pending request.
// ---------------------------------------------------------------------------

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

    const { data, error } = await supabase
      .from('comm_messages')
      .update({ reclassify_requested_at: new Date().toISOString(), classify_attempts: 0 })
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
