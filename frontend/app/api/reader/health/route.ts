import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';
import { getReaderHealthSnapshot } from '@/lib/data/reader';

// ---------------------------------------------------------------------------
// GET /api/reader/health — the tick's row and the mailbox it reads from
//
// The shell seeds both, and nothing pushes into this browser out of band, so nothing renders
// through here on a first load. This is the recovery path: the health surface is read against a
// ticking clock, so a seed frozen at first paint decays on its own — a tab left open overnight
// would report a stall that ended hours ago, and one returning from sleep would report none at
// all. The store re-reads this when the tab comes back.
//
// Both halves come back together because the surface is derived from both at once: a dead
// mailbox suppresses the summariser's banner, and a reading taken from two round trips a second
// apart describes a state that never existed.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { data, error } = await getReaderHealthSnapshot(session.supabase);
  if (error !== null) {
    const { status, message } = mapSupabaseError(error);
    return jsonError(status, message);
  }

  // A failed read is the 4xx/5xx above rather than a partial body: the client REPLACES its whole
  // health surface with this answer, so half a snapshot shipped as a success would render "all
  // clear" off a broken read — the one failure this surface exists to prevent. Either field may
  // legitimately be absent (the tick has never run; the mailbox was never provisioned), and
  // `undefined` simply drops out of the JSON.
  return jsonOk(data);
});
