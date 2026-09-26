import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { wikiPageQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getWikiPageBody } from '@/lib/data/wiki';

// ---------------------------------------------------------------------------
// GET /api/wiki/page?path=wiki/<section>/<name>.md — one page's body, `{ path, blob_oid, body }`
//
// The on-demand read behind opening a page: the shell seeds the index without bodies, so the
// store pulls one through here the first time its page opens and caches it by blob id. The path
// is validated to the exact snapshot shape before it reaches the query — a section the Worker
// syncs and one file stem — so the route can only ever answer for a snapshotted page (400
// otherwise), and a path not in the snapshot is a 404.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const query = parseQueryParams(request, wikiPageQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await getWikiPageBody(session.supabase, query.path);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }
  if (data === null) return jsonError(404, 'Page not found');

  return jsonOk(data);
});
