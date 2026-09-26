import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type {
  WikiPageBody,
  WikiPageIndexRow,
  WikiSearchHit,
  WikiSeed,
  WikiSync,
} from '@/lib/types';

/**
 * Server-only read layer for the wiki snapshot: the shell's seed, the route that serves a
 * navigation or tab-return refresh, the on-demand body read, and body search.
 *
 * The index never selects `body`: a page body is markdown of any length and the module lists
 * hundreds of pages it will never open, so the seed carries the index columns only and a body is
 * fetched when its page opens (the weekly-plans precedent). `WIKI_PAGE_INDEX_COLUMNS` is that
 * one column list, hand-maintained against the generated `Row` type and pinned by `wiki.test.ts`
 * so a migration that adds a column fails loudly rather than shipping a row missing it.
 */

/** Every `wiki_pages` column except `body` and the generated `search` vector. */
export const WIKI_PAGE_INDEX_COLUMNS = [
  'blob_oid',
  'commit_oid',
  'created',
  'links',
  'parse_error',
  'path',
  'section',
  'sources',
  'summary',
  'synced_at',
  'tags',
  'title',
  'updated',
].join(',');

/** The index — every page, no bodies. Order is applied client-side (the wiki's own index order). */
export async function getWikiPages(
  supabase: SupabaseClient<Database>,
): Promise<{ data: WikiPageIndexRow[] | null; error: PostgrestError | null }> {
  return supabase
    .from('wiki_pages')
    .select(WIKI_PAGE_INDEX_COLUMNS)
    .overrideTypes<WikiPageIndexRow[]>();
}

/** The singleton sync row, or `null` before the first sync ever wrote one. */
export async function getWikiSyncState(
  supabase: SupabaseClient<Database>,
): Promise<{ data: WikiSync | null; error: PostgrestError | null }> {
  return supabase.from('wiki_sync').select('*').eq('id', 1).maybeSingle();
}

/**
 * Both reads together — what the seed and the refresh route return. The first error
 * short-circuits: an index with no sync row would read as "never synced" over real pages.
 */
export async function getWikiSnapshot(
  supabase: SupabaseClient<Database>,
): Promise<{ data: WikiSeed; error: null } | { data: null; error: PostgrestError }> {
  const { data: pages, error: pagesError } = await getWikiPages(supabase);
  if (pagesError) return { data: null, error: pagesError };
  const { data: sync, error: syncError } = await getWikiSyncState(supabase);
  if (syncError) return { data: null, error: syncError };
  return { data: { pages: pages ?? [], sync }, error: null };
}

/**
 * The shell's wiki seed. Swallows a Supabase error and hands back an empty snapshot — like the
 * other module seeds, a broken read takes out one panel (an empty Wiki that says nothing has
 * synced) rather than white-screening the whole shell.
 */
export async function getWikiSeed(client?: SupabaseClient<Database>): Promise<WikiSeed> {
  const supabase = client ?? (await createClient());
  const { data, error } = await getWikiSnapshot(supabase);
  if (error !== null) {
    console.error('wiki seed: could not read the snapshot', error);
    return { pages: [], sync: null };
  }
  return data;
}

/**
 * One page's body, pinned to the blob it was parsed from so the client can cache it by version.
 * `.maybeSingle()`: a path not in the snapshot is the route's 404, not a 500.
 */
export async function getWikiPageBody(
  supabase: SupabaseClient<Database>,
  path: string,
): Promise<{ data: WikiPageBody | null; error: PostgrestError | null }> {
  return supabase.from('wiki_pages').select('path,blob_oid,body').eq('path', path).maybeSingle();
}

/** Ranked body hits with control-character-delimited snippets — see `search_wiki_pages`. */
export async function searchWikiBodies(
  supabase: SupabaseClient<Database>,
  query: string,
  limit: number,
): Promise<{ data: WikiSearchHit[] | null; error: PostgrestError | null }> {
  return supabase.rpc('search_wiki_pages', { p_query: query, p_limit: limit });
}
