import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderCandidates } from '@/lib/data/reader-publications';

// ---------------------------------------------------------------------------
// GET /api/reader/publications/candidates — bulk senders not on the roster
//
// The view's own rank (volume, then recency) is preserved as-is — see `getReaderCandidates`.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { data, error } = await getReaderCandidates(session.supabase);
  if (error) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  return jsonOk(data);
});
