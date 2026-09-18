import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { PatchReaderPostInput, ReaderPostsQuery } from '@/lib/api/reader-schemas';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type { ReaderHealthSnapshot, ReaderPostListItem, ReaderPostUpdate } from '@/lib/types';

/**
 * Server-only read/write layer for the Reader module's list — the shell's seed, the route that
 * serves a focus refetch, and the row verbs' single write.
 *
 * `READER_POST_LIST_COLUMNS` is the one thing every entry point here shares: `reader_posts.text`
 * is a full post body (tens of KB), and the list never renders it — the "Open" verb sends the
 * owner to the original. Naming every OTHER column explicitly, once, is what keeps the seed, the
 * route and the patch from drifting into three different ideas of "the list shape" — and what
 * makes a migration that adds a column fail loudly (the pinning test below) instead of silently
 * shipping a row missing its newest field.
 */

/**
 * Every `reader_posts` column except `text`, as the explicit `.select()` list every read below
 * shares. Hand-maintained against the generated `Row` type — `reader.test.ts` pins it against a
 * fixture's own keys, so a migration that adds or renames a column fails that test until this
 * list is updated to match.
 */
export const READER_POST_LIST_COLUMNS = [
  'account_key',
  'archived_at',
  'author',
  'canonical_url',
  'comm_message_id',
  'created_at',
  'gist',
  'gmail_message_id',
  'headline',
  'html_extracted',
  'id',
  'last_error',
  'model',
  'model_called_at',
  'opened_at',
  'overview',
  'prompt_version',
  'publication_id',
  'received_at',
  'rfc822_message_id',
  'summarize_attempts',
  'summarized_at',
  'summarizing_since',
  'summary_state',
  'text_swept_at',
  'title',
  'word_count',
].join(',');

/**
 * The shell's reading-list seed: the active posts, newest-received first, up to the list's
 * default page (200). Swallows a Supabase error and hands back an empty list — like the other
 * module seeds, a broken read takes out one panel (an empty Reader list, still navigable) rather
 * than white-screening the whole shell.
 */
export async function getReaderSeed(
  client?: SupabaseClient<Database>,
): Promise<{ posts: ReaderPostListItem[] }> {
  const supabase = client ?? (await createClient());
  const { data, error } = await getReaderPosts(supabase, { scope: 'active', limit: 200 });
  if (error) {
    console.error('reader seed: could not read posts', error);
    return { posts: [] };
  }
  return { posts: data ?? [] };
}

/**
 * The reading list, either side: `active` (not archived — the default view) or `archived` (the
 * archive view, still to be built). Ordered newest-received first, the same order the list
 * renders in.
 *
 * Supabase-js types a string column list (rather than a generated `select('*')` overload)
 * loosely — the result comes back as a row shaped by the wildcard `Row` type minus nothing, not
 * narrowed to the columns actually named. `.overrideTypes<ReaderPostListItem[]>()` is the one
 * place in this file that tells the client what its own explicit column list already promises.
 */
export async function getReaderPosts(
  supabase: SupabaseClient<Database>,
  query: ReaderPostsQuery,
): Promise<{ data: ReaderPostListItem[] | null; error: PostgrestError | null }> {
  const base = supabase.from('reader_posts').select(READER_POST_LIST_COLUMNS);

  const scoped =
    query.scope === 'active' ? base.is('archived_at', null) : base.not('archived_at', 'is', null);

  return scoped
    .order('received_at', { ascending: false })
    .limit(query.limit)
    .overrideTypes<ReaderPostListItem[]>();
}

/**
 * The row's verbs, applied to one row: `{ archived: boolean }` stamps or clears `archived_at`,
 * `{ opened: true }` stamps `opened_at`, and `{ resummarize: true }` puts the row back on the
 * tick's worklist. `now` is a parameter rather than read from the clock in here, so a route's
 * test can pin the timestamp it asserts on without faking `Date` globally.
 *
 * `.maybeSingle()`, not `.single()`: a missing row is the route's 404, not a 500 the shared
 * error mapper has no case for.
 */
export async function patchReaderPost(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: PatchReaderPostInput,
  now: Date,
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  return supabase
    .from('reader_posts')
    .update(readerPostUpdate(patch, now))
    .eq('id', id)
    .select(READER_POST_LIST_COLUMNS)
    .maybeSingle();
}

/**
 * The columns each verb writes. Re-summarising puts the row back on the tick's worklist and
 * nothing more: the state, the spent attempts and the recorded error are reset, and the lease is
 * cleared so a tick that died mid-summary cannot keep the row to itself. The existing headline,
 * gist, overview, model and prompt version are deliberately left alone — blanking them would
 * show a judgment that has not happened yet, and the list keeps the previous summary visible
 * under the pending marker until the tick overwrites it.
 */
function readerPostUpdate(patch: PatchReaderPostInput, now: Date): ReaderPostUpdate {
  if ('archived' in patch) {
    return { archived_at: patch.archived ? now.toISOString() : null };
  }
  if ('opened' in patch) {
    return { opened_at: now.toISOString() };
  }
  return {
    summary_state: 'pending',
    summarize_attempts: 0,
    last_error: null,
    summarizing_since: null,
  };
}

/**
 * What the re-summarise verb has to know before it queues anything: whether the row still holds
 * the text the tick would summarise, and whether the retention sweep is why it doesn't.
 *
 * Its own read rather than a column on the list payload, because `text` is a whole post body and
 * the list is explicitly built never to carry one. `.maybeSingle()`, so a missing row is the
 * route's 404 rather than a 500 the shared error mapper has no case for.
 */
export async function getReaderPostText(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{
  data: { text: string | null; text_swept_at: string | null } | null;
  error: PostgrestError | null;
}> {
  return supabase.from('reader_posts').select('text,text_swept_at').eq('id', id).maybeSingle();
}

/**
 * Everything the health surface is derived from: the tick's singleton row and the Gmail account
 * its mail arrives on.
 *
 * Two sequenced reads, the first error short-circuiting the second — a snapshot missing half of
 * itself is worse than none, because a surface that renders "all clear" off a broken read is the
 * failure this module exists to prevent. Both use `.maybeSingle()`: a health row before the
 * first tick and an unprovisioned account are ordinary states, not 404s and not errors, and they
 * come back `undefined` rather than null so the caller's "is there one" reads as a presence
 * check rather than a null dance.
 */
export async function getReaderHealthSnapshot(
  supabase: SupabaseClient<Database>,
): Promise<{ data: ReaderHealthSnapshot; error: null } | { data: null; error: PostgrestError }> {
  const { data: health, error: healthError } = await supabase
    .from('reader_health')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (healthError) return { data: null, error: healthError };

  const { data: account, error: accountError } = await supabase
    .from('comm_accounts')
    .select('*')
    .eq('key', 'gmail-personal')
    .maybeSingle();
  if (accountError) return { data: null, error: accountError };

  return { data: { health: health ?? undefined, account: account ?? undefined }, error: null };
}

/**
 * The shell's health seed. Degrades to an empty snapshot — which reads as "the tick has never
 * run", the most conservative thing a broken read can claim, and never as "everything is fine".
 */
export async function getReaderHealthSeed(
  client?: SupabaseClient<Database>,
): Promise<ReaderHealthSnapshot> {
  const supabase = client ?? (await createClient());
  const { data, error } = await getReaderHealthSnapshot(supabase);
  if (error !== null) {
    console.error('reader seed: could not read health', error);
    return { health: undefined, account: undefined };
  }
  return data;
}
