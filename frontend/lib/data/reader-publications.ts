import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type {
  CreateReaderPublicationInput,
  UpdateReaderPublicationInput,
} from '@/lib/api/reader-schemas';
import { toUpdatePayload } from '@/lib/api/updates';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type {
  ReaderCandidate,
  ReaderPublication,
  ReaderPublicationListItem,
  ReaderPublicationUpdate,
} from '@/lib/types';

/**
 * Server-only read layer for the Reader's roster surface — the publications the owner keeps and
 * the bulk senders not on it yet.
 *
 * Its own file rather than a section of `reader.ts`: the reading list moves every few minutes
 * and is re-read on every focus, while the roster changes only when a human edits it. They are
 * two surfaces seeded into two stores, and keeping the reads apart is what lets each be built
 * and tested without the other.
 */

/** What the publications surface needs: the roster, and the senders it could grow by. */
export interface ReaderSettingsSeed {
  publications: ReaderPublicationListItem[];
  candidates: ReaderCandidate[];
}

/**
 * The roster with each publication's newest post, ordered by name — the view's own order,
 * restated here so the read does not depend on a view's ORDER BY surviving PostgREST.
 *
 * Read in ONE request rather than paged as the Comms reads are: the roster is the set of
 * newsletters one person subscribes to, which is tens of rows and cannot plausibly approach
 * PostgREST's row cap. The same holds for the candidates read below — a month of bulk senders on
 * one mailbox is the same order of magnitude.
 *
 * `.overrideTypes<ReaderPublicationListItem[]>()` because a Postgres view carries no NOT NULL
 * metadata, so every generated view column is nullable even where the underlying table columns
 * are not.
 */
export async function getReaderPublications(
  supabase: SupabaseClient<Database>,
): Promise<{ data: ReaderPublicationListItem[] | null; error: PostgrestError | null }> {
  return supabase
    .from('v_reader_publications')
    .select('*')
    .order('name', { ascending: true })
    .overrideTypes<ReaderPublicationListItem[]>();
}

/**
 * Bulk senders not on the roster, ranked by volume then recency. Restated here rather than left
 * to the view's own `ORDER BY`, because PostgREST gives no ordering guarantee for a request that
 * doesn't ask for one — a view's own sort is not part of the wire contract, so the client has to
 * ask for the order it wants.
 */
export async function getReaderCandidates(
  supabase: SupabaseClient<Database>,
): Promise<{ data: ReaderCandidate[] | null; error: PostgrestError | null }> {
  return supabase
    .from('v_reader_candidates')
    .select('*')
    .order('message_count', { ascending: false })
    .order('last_seen_at', { ascending: false })
    .overrideTypes<ReaderCandidate[]>();
}

/**
 * The publications seed: two independent reads, run concurrently with `Promise.all` (neither
 * query depends on the other's result), each still degrading to an empty slice on its OWN
 * failure. The candidates read still resolves even when the roster read fails (and vice versa) —
 * a broken roster must not also blank the candidates panel it has nothing to do with — exactly
 * as the Comms settings seed treats its slices independently.
 */
export async function getReaderSettingsSeed(
  client?: SupabaseClient<Database>,
): Promise<ReaderSettingsSeed> {
  const supabase = client ?? (await createClient());

  const [
    { data: publications, error: publicationsError },
    { data: candidates, error: candidatesError },
  ] = await Promise.all([getReaderPublications(supabase), getReaderCandidates(supabase)]);

  if (publicationsError) {
    console.error('reader settings seed: could not read the roster', publicationsError);
  }
  if (candidatesError) {
    console.error('reader settings seed: could not read the candidates', candidatesError);
  }

  return {
    publications: publicationsError ? [] : (publications ?? []),
    candidates: candidatesError ? [] : (candidates ?? []),
  };
}

/**
 * Put a sender on the roster by hand — typed in, or promoted from the candidates list. The
 * handle is normalised HERE, trimmed and lower-cased, because it is the roster's join key: every
 * post is matched against it, so two callers spelling the same sender differently must land on
 * the same row. The display name falls back to the handle's local part (before the `@`) rather
 * than demanding one of the caller, and the domain is simply everything after the `@` — the
 * handle's mail host, e.g. `bensbites.beehiiv.com` for `hello@bensbites.beehiiv.com`. That is
 * NOT how discovery derives a domain for an auto row (`workers/src/reader/discovery.ts` builds a
 * Substack-specific `<publication>.substack.com`, stripping any `+section` tag first) — the two
 * derivations differ on purpose, since a hand-typed handle carries no such convention to parse.
 * Always `source: 'owner'`: this route is never how an auto row is created.
 */
export async function createReaderPublication(
  supabase: SupabaseClient<Database>,
  input: CreateReaderPublicationInput,
): Promise<{ data: ReaderPublication | null; error: PostgrestError | null }> {
  const handle = input.handle.trim().toLowerCase();
  const atIndex = handle.indexOf('@');
  const localPart = atIndex === -1 ? handle : handle.slice(0, atIndex);
  const domain = atIndex === -1 ? null : handle.slice(atIndex + 1);

  return supabase
    .from('reader_publications')
    .insert({
      handle,
      name: input.name ?? localPart,
      domain,
      source: 'owner',
      enabled: true,
    })
    .select()
    .single();
}

/**
 * Pause, resume, rename or annotate a publication. The handle is never a field here — it is what
 * every post is matched against, so changing it would orphan a publication's history rather than
 * rename it.
 *
 * `.maybeSingle()`, not `.single()`: the shared error mapper has no PGRST116 case, so an id that
 * matches nothing would surface as a 500 rather than the 404 it is.
 */
export async function updateReaderPublication(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: UpdateReaderPublicationInput,
): Promise<{ data: ReaderPublication | null; error: PostgrestError | null }> {
  const updates = toUpdatePayload<ReaderPublicationUpdate>(patch, ['enabled', 'name', 'notes']);

  return supabase.from('reader_publications').update(updates).eq('id', id).select().maybeSingle();
}
