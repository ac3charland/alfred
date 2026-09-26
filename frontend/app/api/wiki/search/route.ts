import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { wikiSearchQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { searchWikiBodies } from '@/lib/data/wiki';

// ---------------------------------------------------------------------------
// GET /api/wiki/search?q=&limit= — body matches for the Wiki module's search, `WikiSearchHit[]`
//
// The module's second, debounced result group ("In page text"): Postgres full-text search over
// page bodies through the `search_wiki_pages` RPC, ranked, each hit carrying a snippet whose
// matched words sit between control characters (never HTML — the client splits them into
// <mark> runs). Titles, summaries and tags are matched instantly client-side and never come
// through here. A query under two characters (after trimming) is a 400: it would match nearly
// every page for a list nobody wants.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const query = parseQueryParams(request, wikiSearchQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await searchWikiBodies(session.supabase, query.q, query.limit);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }
  return jsonOk(data ?? []);
});
