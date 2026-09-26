import { withSession } from '@/lib/api/auth';
import { parseQueryParams } from '@/lib/api/parsing';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { readerPostsQuerySchema } from '@/lib/api/schemas';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderPosts } from '@/lib/data/reader';

// ---------------------------------------------------------------------------
// GET /api/reader/posts?scope=active|archived&limit=N — the reading list's own reread
//
// The shell seeds the store with the active list at load time, so nothing renders the list
// through here on first paint: this is for the focus refetch (the store's `refresh()`) and, later,
// the archive view (`scope=archived`). `text` never comes back — `getReaderPosts` selects
// `READER_POST_LIST_COLUMNS`, the same column list the seed and the patch share, because the
// list never renders a post's body (the owner reads in Instapaper; the Send route reads the body
// server-side itself) and a 30 KB-per-row column on every refetch is weight nobody asked for.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session, request) => {
  const query = parseQueryParams(request, readerPostsQuerySchema);
  if (query instanceof Response) return query;

  const { data, error } = await getReaderPosts(session.supabase, query);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});
