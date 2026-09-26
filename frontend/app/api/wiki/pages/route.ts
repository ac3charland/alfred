import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getWikiSnapshot } from '@/lib/data/wiki';

// ---------------------------------------------------------------------------
// GET /api/wiki/pages — the whole index plus the sync row, `{ pages, sync }`
//
// The shell seeds the store with the same pair at load time, so nothing renders through here on
// first paint: this is the store's `refresh()` on a navigation within the module and on the tab
// returning. No page bodies come back — `getWikiPages` selects the index columns only, and a
// body is fetched by `GET /api/wiki/page` when its page opens.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { data, error } = await getWikiSnapshot(session.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }
  return jsonOk(data);
});
