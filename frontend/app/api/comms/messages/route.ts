import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { commMessagesQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getCommMessagesByScope } from '@/lib/data/comms-messages';

// ---------------------------------------------------------------------------
// GET /api/comms/messages?scope=queue|shelf&limit= — one side of the module
//
// The shell seeds the store with every message inside the retention window, so nothing renders
// the queue through here: this is for the shelf's on-demand paging and for a long-lived tab
// reconciling itself. `scope` is required rather than defaulted — the queue is meant to be a
// handful of rows and the shelf is thousands, and an endpoint that answered both without being
// told which would make the expensive read the accidental default.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const query = parseQueryParams(request, commMessagesQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await getCommMessagesByScope(session.supabase, query);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});
