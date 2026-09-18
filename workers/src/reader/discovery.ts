/**
 * Putting new Substack senders on the roster automatically — the only automated way onto the roster.
 *
 * `v_reader_discovery` does the finding: an inbound gmail-personal sender, with a list header,
 * on a `substack.com` address, seen in the last seven days, not already on the roster. What is
 * left here is the upsert — and two refusals the view already makes, made again.
 *
 * Refusing `no-reply@` / `noreply@` / `reaction@`, and any host that is not exactly
 * `substack.com`, is not redundant defensiveness for its own sake. Substack's own platform mail
 * and its like/reaction notifications both carry a list header on a substack.com subdomain, so
 * they satisfy every signal discovery leans on; the local part and the host are the only things
 * separating "a publication the owner subscribed to" from "the platform's weekly digest of
 * everything" and "somebody reacted to a post". A roster row is hard to notice and harder to
 * remove once the reading list has filled with digests, so the cost of the view and the code
 * disagreeing is paid by the owner. A few cheap string comparisons is a smaller price.
 */
import { type SupabaseEnv, fetchJson, headers, restQueryUrl } from '../supabase';

/** Local parts that are the platform talking, never a publication. */
const PLATFORM_LOCAL_PARTS = new Set(['no-reply', 'noreply', 'reaction']);

/** The only host a publication mails from. `mg1.substack.com` is the notifier, not a publication. */
const PUBLICATION_HOST = 'substack.com';

/** `v_reader_discovery` as PostgREST returns it. */
interface WireDiscoveryRow {
  handle: string;
  name: string | null;
  first_seen_at: string;
  message_count: number;
}

/** The local part of a handle, lower-cased — `mira` out of `mira@harborline.substack.com`. */
function localPart(handle: string): string {
  return (handle.split('@', 1)[0] ?? '').toLowerCase();
}

/** The host of a handle, lower-cased — `substack.com` out of `harborline@substack.com`. */
function host(handle: string): string {
  return (handle.split('@').at(-1) ?? '').toLowerCase();
}

/**
 * The publication's own local part, with any `+<section>` tag removed.
 *
 * One publication mails from several section handles — `harborline+the-ledger@substack.com` and
 * `harborline+the-rota@substack.com` are the same publication, two sections. The tag identifies
 * the section and never appears in the host.
 */
function publicationName(handle: string): string {
  return localPart(handle).split('+', 1)[0] ?? '';
}

/** A sender the roster may take: a publication's own address, not the platform's. */
function isPublicationSender(handle: string): boolean {
  return host(handle) === PUBLICATION_HOST && !PLATFORM_LOCAL_PARTS.has(publicationName(handle));
}

/**
 * Read the view and add whatever it found to the roster.
 *
 * `resolution=ignore-duplicates` rather than `merge-duplicates`: a handle already on the roster
 * carries the owner's own edits — a renamed publication, `enabled = false` after they paused it —
 * and a merge would quietly undo both on the next tick that saw one more message from it. The
 * view already excludes existing handles, so a duplicate here means an overlapping tick, and the
 * right answer to that is to do nothing.
 *
 * Returns how many rows the upsert actually stored, which is what the tick reports.
 *
 * `_now` is unused: the tick threads its instant through every unit for uniformity, but a roster
 * row's `first_seen_at` is a column default rather than something this call decides.
 */
export async function discoverPublications(env: SupabaseEnv, _now: Date): Promise<number> {
  const found = await fetchJson<WireDiscoveryRow[]>(
    env,
    restQueryUrl(env, 'v_reader_discovery', {}),
    {},
    'GET v_reader_discovery',
  );

  const rows = found
    .filter((row) => isPublicationSender(row.handle))
    .map((row) => toPublicationInsert(row));

  // No POST at all when there is nothing to add — an empty upsert is a subrequest spent to learn
  // what the read already said, and the per-tick budget counts it either way.
  if (rows.length === 0) return 0;

  const response = await fetch(
    restQueryUrl(env, 'reader_publications', { on_conflict: 'handle' }),
    {
      method: 'POST',
      headers: {
        ...headers(env),
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    },
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Supabase POST reader_publications failed: ${String(response.status)} ${detail}`,
    );
  }

  const stored = await response.json<unknown[]>();
  return stored.length;
}

/**
 * One roster row from one discovered sender.
 *
 * The name falls back to the local part because `sender_name` is whatever comms parsed out of
 * `From`, and a publication that mails from a bare address has none — `mira` on the row reads
 * better than an empty publication in the list, and the owner can rename it in SQL.
 *
 * The domain is derived rather than read: Substack's sending handle is `<publication>.substack.com`
 * for every publication on the platform, and a publications view wants somewhere to send
 * the owner. A custom-domain publication added by hand sets its own. The `+<section>` tag is
 * dropped on the way — it names a section of the publication and is not part of any host.
 *
 * The HANDLE keeps its tag: matching a message to a roster row is on the handle, so two sections
 * of one publication are two roster rows that happen to share a domain.
 */
function toPublicationInsert(row: WireDiscoveryRow): Record<string, unknown> {
  const local = localPart(row.handle);
  const name = (row.name ?? '').trim();
  return {
    handle: row.handle,
    name: name === '' ? local : name,
    domain: `${publicationName(row.handle)}.substack.com`,
    source: 'auto',
    enabled: true,
  };
}
