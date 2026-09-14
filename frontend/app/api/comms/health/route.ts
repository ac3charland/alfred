import { withSession } from '@/lib/api/auth';
import { jsonError, jsonOk } from '@/lib/api/responses';
import { mapSupabaseError } from '@/lib/api/supabase-errors';

// ---------------------------------------------------------------------------
// GET /api/comms/health — the accounts and the classifier's row, as they stand right now
//
// The shell seeds both and Realtime keeps them current, so nothing renders through here on a
// first load. This is the recovery path: Realtime is fire-and-forget, so a socket that lapses
// while the tab is backgrounded or the machine asleep drops every change made in the gap and
// never replays it. Account health is the surface that shows it — it is read against a ticking
// clock, so a `last_seen_at` frozen at the seed decays into "stale" on its own — and this is
// how a returning tab replaces the frozen reading with the current one (ALF-227).
//
// Both rows are read, not just the accounts: the classifier banner goes stale in the same gap
// and for the same reason, and one round trip re-establishes the whole surface.
// ---------------------------------------------------------------------------

export const GET = withSession(async (session) => {
  const { supabase } = session;

  const { data: accounts, error: accountsError } = await supabase
    .from('comm_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (accountsError) {
    const { status, message } = mapSupabaseError(accountsError);
    return jsonError(status, message);
  }

  const { data: health, error: healthError } = await supabase
    .from('comm_classifier_health')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (healthError) {
    const { status, message } = mapSupabaseError(healthError);
    return jsonError(status, message);
  }

  // A failed read is a 4xx/5xx above rather than a partial body: the caller REPLACES its health
  // surface with what this returns, so an empty roster shipped as success would blank every dot.
  return jsonOk({ accounts, health: health ?? undefined });
});
