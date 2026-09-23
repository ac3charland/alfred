import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { commsSnapshotQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { readCommsSnapshot } from '@/lib/data/comms';

// ---------------------------------------------------------------------------
// GET /api/comms/snapshot?shelf= — everything the Comms queue view holds, as it stands now
//
// Comms has no Realtime subscription — every source it mirrors is minutes-granular, so a socket
// bought almost nothing over polling (ALF-258). This is the read the view polls on a timer
// (`COMMS_POLL_MS`) while visible, plus whenever it may have missed something sooner: the tab
// returning to the front, a bfcache restore, coming back online, a failed optimistic write, or
// "Show more" paging the shelf. Each read REPLACES the view with what it returns, rather than
// trusting a push it might have missed. `shelf` is how many shelf rows the tab is showing, which
// is also how "Show more" loads the next page: the same read, asked for more.
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
