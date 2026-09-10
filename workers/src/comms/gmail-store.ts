/**
 * The one database read the Gmail poller needs that the shared store does not already offer:
 * turning the source ids it just wrote back into the row ids it has to patch.
 *
 * It lives beside `store.ts` rather than in it because the need is specific to a source whose
 * filter runs AFTER the insert. `ingestMessages` reports counts, not rows — deliberately, since
 * every other caller only wants to know how many landed — so a poller that must then mark a
 * subset of them has to look them up by the identity it does know. Built on the same `supabase.ts`
 * plumbing as the shared store, so a rejected read reads identically in the log.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';

/**
 * Map each of `sourceIds` that exists on this account to its row id.
 *
 * The list is always short in practice — it carries only the messages the header filter shelved
 * in this one poll — so it goes as a single `in.(…)` rather than paged. A source id that is not
 * in the result was simply never stored, which the caller reads as "nothing to patch".
 */
export async function fetchMessageIdsBySourceIds(
  env: SupabaseEnv,
  accountId: string,
  sourceIds: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (sourceIds.length === 0) return found;

  const url = restQueryUrl(env, 'comm_messages', {
    select: 'id,source_id',
    account_id: `eq.${accountId}`,
    source_id: `in.(${sourceIds.map((id) => `"${id}"`).join(',')})`,
  });
  const rows = await fetchJson<{ id: string; source_id: string }[]>(
    env,
    url,
    {},
    'GET comm_messages',
  );

  for (const row of rows) found.set(row.source_id, row.id);
  return found;
}
