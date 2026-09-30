/**
 * The database calls the classifier sweep needs that `store.ts` cannot express.
 *
 * Every write in `store.ts` leaves an unwanted column out of the payload rather than sending a
 * null, deliberately, so that nothing there can clear a column by accident. A finished re-run has
 * to do exactly that — `reclassify_requested_at` is a request, and a request that has been
 * answered must go back to empty or the sweep re-runs the same row every two minutes forever —
 * and so must one that has been given up on. So the calls that genuinely mean "clear this" live
 * here, apart from the calls that cannot.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';

/**
 * A JSON `null`, parsed rather than written: `unicorn/no-null` bans the literal in this package's
 * source, and PostgREST has no other way to spell "empty this column".
 */
const JSON_NULL: unknown = JSON.parse('null');

/**
 * Clear a message's re-run request, and report whether a row matched.
 *
 * Called AFTER the verdict has been written, so a failure in between leaves the request standing
 * and the next tick re-runs it — a duplicate verdict row, which is history rather than damage,
 * against a request that would otherwise be silently dropped.
 */
export async function clearReclassifyRequest(env: SupabaseEnv, id: string): Promise<number> {
  const rows = await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, 'comm_messages', { id: `eq.${id}` }),
    { method: 'PATCH', body: JSON.stringify({ reclassify_requested_at: JSON_NULL }) },
    `PATCH comm_messages (${id})`,
  );
  return rows.length;
}

/**
 * Give up on a re-run request: empty it and stamp the failure in one write, and report whether a
 * row matched.
 *
 * Touches nothing else — the tier, verdict and ask the row already had are what stand, which is
 * the whole point of abandoning rather than parking.
 *
 * Matches only `requestedAt`, the request as it was READ. Scheduled invocations are not
 * serialized and the owner can ask again at any moment, so a blind write here could wipe out a
 * NEWER request the owner has just made; with the filter it matches nothing instead, and the
 * newer request is exactly what survives. The timestamp travels back verbatim, as the database
 * wrote it, since a re-formatted copy would never match.
 */
export async function abandonReclassifyRequest(
  env: SupabaseEnv,
  id: string,
  request: { requestedAt: string; failedAt: string },
): Promise<number> {
  const rows = await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, 'comm_messages', {
      id: `eq.${id}`,
      reclassify_requested_at: `eq.${request.requestedAt}`,
    }),
    {
      method: 'PATCH',
      body: JSON.stringify({
        reclassify_requested_at: JSON_NULL,
        reclassify_failed_at: request.failedAt,
      }),
    },
    `PATCH comm_messages (${id})`,
  );
  return rows.length;
}
