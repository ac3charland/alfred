import type { RealtimeClient } from '@supabase/supabase-js';

/**
 * Run `join` — a store's `.subscribe()` calls — only once the realtime socket holds the signed-in
 * session's JWT. Returns a cancel for the effect's cleanup, so an unmount that beats the token
 * joins nothing.
 *
 * A channel's join payload is frozen the moment `.subscribe()` runs. On a fresh page load the
 * browser client hasn't read the session yet, so a join sent straight from a mount effect carries
 * no token and the server subscribes it as `anon` — which the `authenticated`-only RLS policies
 * let see nothing, silently. supabase-js re-sends a token to a joined channel only when it
 * CHANGES, and it has already stored this one by the time the join lands, so the channel stays
 * anon until the JWT next rotates (up to an hour): a store that looks live and never updates
 * (ALF-258). `setAuth()` with no argument loads the session's token through the client's own
 * callback (so refreshes still flow); a join sent after it carries that token.
 *
 * Register handlers with `.on()` before calling this — only the join waits.
 */
export function joinWhenAuthenticated(realtime: RealtimeClient, join: () => void): () => void {
  let cancelled = false;
  const run = () => {
    if (!cancelled) join();
  };
  // A failed token read still joins: an anon channel is no worse than none, and the next token
  // the client does read is pushed to it.
  void realtime.setAuth().then(run, run);
  return () => {
    cancelled = true;
  };
}

/**
 * Keep only the columns a realtime UPDATE actually delivered, so a patch built from `payload.new`
 * changes what the payload carried and nothing else.
 *
 * `payload.new` is not always the whole row: Postgres leaves an UPDATE's unchanged TOASTed columns
 * (values over ~2 KB — a snapshotted spec, say) out of the replication message, so Supabase omits
 * the key entirely. Copied field by field into a patch, that absence becomes `undefined` and
 * overwrites the value the store holds (ALF-277). An omitted column means "unchanged"; one the
 * write really cleared arrives as `null` and is kept.
 */
export function deliveredColumns<T extends object>(patch: T): Partial<T> {
  // `fromEntries` can't carry T's keys through; the result is a subset of `patch`'s own entries.
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
