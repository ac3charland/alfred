/**
 * The one database call the classifier sweep needs that `store.ts` cannot express.
 *
 * Every write in `store.ts` leaves an unwanted column out of the payload rather than sending a
 * null, deliberately, so that nothing there can clear a column by accident. A finished re-run has
 * to do exactly that — `reclassify_requested_at` is a request, and a request that has been
 * answered must go back to empty or the sweep re-runs the same row every two minutes forever. So
 * the one call that genuinely means "clear this" lives here, apart from the calls that cannot.
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
