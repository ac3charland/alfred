import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { commsSnapshotQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { readCommsSnapshot } from '@/lib/data/comms';

// ---------------------------------------------------------------------------
// GET /api/comms/snapshot?shelf= — everything the Comms queue view holds, as it stands now
//
// Realtime is fire-and-forget: a socket that lapses (a backgrounded tab, a machine asleep, a
// phone that suspended the app) drops every change made in the gap and never replays it, and
// the gap between the shell's server read and the channel joining is lost the same way. So a
// tab re-reads this whenever it may have missed something, and replaces its view with it
// (ALF-258). `shelf` is how many shelf rows the tab is showing, which is also how "Show more"
// loads the next page: the same read, asked for more.
//
// A failed read is a 4xx/5xx rather than a partial body: the caller REPLACES its view with what
// this returns, so an empty slice shipped as success would blank the queue.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const query = parseQueryParams(request, commsSnapshotQuerySchema);
  if (query instanceof Response) return query;

  const { seed, error } = await readCommsSnapshot(session.supabase, query.shelf);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }
  return jsonOk(seed);
});
