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
 * Escape one source id for embedding inside a PostgREST quoted list-literal element
 * (`in.("…","…")`). PostgREST's escape for a quoted element is a leading backslash, so a
 * backslash must be doubled FIRST — otherwise a `"` from the id's own escaping step would be
 * re-consumed by the backslash rule and come out wrong.
 *
 * The realistic trigger isn't an attacker: a WorkMail `Message-ID` containing a bare `"` is
 * malformed per RFC 5322 but shows up in the wild, and without this the built filter either
 * 400s (breaking the whole ingest batch) or splits into an extra list element that can match an
 * unintended row.
 */
function escapeListLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`);
}

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
    source_id: `in.(${sourceIds.map((id) => `"${escapeListLiteral(id)}"`).join(',')})`,
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
