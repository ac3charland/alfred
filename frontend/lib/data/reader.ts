import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import type { PatchReaderPostInput, ReaderPostsQuery } from '@/lib/api/reader-schemas';
import type { Database, Json } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type { ReaderHealthSnapshot, ReaderPostListItem, ReaderPostUpdate } from '@/lib/types';
import type { ReaderPostForWiki } from '@/lib/wiki/writer/envelope';

/**
 * Server-only read/write layer for the Reader module's list — the shell's seed, the route that
 * serves a focus refetch, and the row verbs' single write.
 *
 * `READER_POST_LIST_COLUMNS` is the one thing every entry point here shares: `reader_posts.text`
 * and `reader_posts.html` are the post's body twice over (tens to hundreds of KB), and the list
 * never renders either — the owner reads a post in Instapaper, and the Send verb's route reads
 * the body server-side itself. Naming every OTHER column explicitly, once, is what keeps the seed, the
 * route and the patch from drifting into three different ideas of "the list shape" — and what
 * makes a migration that adds a column fail loudly (the pinning test below) instead of silently
 * shipping a row missing its newest field.
 */

/**
 * Every `reader_posts` column except `text` and `html`, as the explicit `.select()` list every read below
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
  'instapaper_bookmark_id',
  'instapaper_sent_at',
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
  'wiki_sent_ideas',
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
 * Re-summarising carries its "not already queued" rule in the WHERE clause as well as in the
 * route's pre-read. The pre-read can only describe the row a moment ago; the filter is what
 * makes the rule hold at the instant of the write, so a tick that leases the row in between
 * matches nothing here rather than having its lease cleared and its attempts reset mid-run.
 *
 * `.maybeSingle()`, not `.single()`: no row came back either because there is none (the route's
 * 404) or because that guard held (its 409), and neither is a 500 the shared error mapper has a
 * case for.
 */
export async function patchReaderPost(
  supabase: SupabaseClient<Database>,
  id: string,
  patch: PatchReaderPostInput,
  now: Date,
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  const write = supabase.from('reader_posts').update(readerPostUpdate(patch, now)).eq('id', id);
  const guarded = 'resummarize' in patch ? write.neq('summary_state', 'pending') : write;

  return guarded.select(READER_POST_LIST_COLUMNS).maybeSingle();
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
 * What the re-summarise verb has to know before it queues anything: whether the retention sweep
 * took the row's body, whether there was ever a body to take, and whether the tick is already
 * holding the row.
 *
 * Never selects `text`. The body is tens of KB and nothing here reads it — `word_count` is the
 * same presence signal the row's own verb is drawn from, so the route and the UI cannot disagree
 * about whether there is anything to summarise, and a stored empty string (which the sweep's
 * predicate treats as no body) counts as none on both sides. A row whose body was nulled by hand
 * while the count stayed positive is queued and then filed `failed` by the tick — the right end
 * for a state nothing writes. `.maybeSingle()`, so a missing row is the route's 404 rather than a
 * 500 the shared error mapper has no case for.
 */
export async function getReaderPostResummarizeState(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{
  data: { text_swept_at: string | null; word_count: number; summary_state: string } | null;
  error: PostgrestError | null;
}> {
  return supabase
    .from('reader_posts')
    .select('text_swept_at,word_count,summary_state')
    .eq('id', id)
    .maybeSingle();
}

/**
 * One row through the shared list columns — what a route answers with when it has nothing to
 * write (a wiki send whose every bullet was already sent). `.maybeSingle()`, so a row deleted in
 * between is the route's 404 rather than a 500.
 */
export async function getReaderPostListItem(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  return supabase
    .from('reader_posts')
    .select(READER_POST_LIST_COLUMNS)
    .eq('id', id)
    .maybeSingle<ReaderPostListItem>();
}

/** What a wiki send reads: the envelope's fields, plus the bullets it may send and has sent. */
export interface ReaderPostWikiRow extends ReaderPostForWiki {
  /** The structured take, whose `novel_ideas` bound what a send may name. */
  overview: Json | null;
  /** The exact text of every bullet already sent. */
  wiki_sent_ideas: string[];
}

/**
 * The one read of a post's body outside the Worker: a wiki send writes the text into the
 * envelope's `source.md`. Nothing else here selects `text`, and this read goes nowhere near a
 * response — the send route answers through the list columns. `.maybeSingle()`, so a missing
 * row is the route's 404.
 */
export async function getReaderPostForWiki(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: ReaderPostWikiRow | null; error: PostgrestError | null }> {
  return supabase
    .from('reader_posts')
    .select('id,title,author,canonical_url,received_at,text,overview,wiki_sent_ideas')
    .eq('id', id)
    .maybeSingle();
}

/**
 * Record bullets as sent, through the `append_wiki_sent_ideas` RPC: one atomic update that adds
 * only the strings not already present. A read-modify-write here would let two tabs sending from
 * the same post race, and the later send would erase the earlier one's marks. The row comes back
 * through the shared list columns, so the body never rides along.
 */
export async function appendWikiSentIdeas(
  supabase: SupabaseClient<Database>,
  id: string,
  ideas: readonly string[],
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  return supabase
    .rpc('append_wiki_sent_ideas', { p_post: id, p_ideas: [...ideas] })
    .select(READER_POST_LIST_COLUMNS)
    .single<ReaderPostListItem>();
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

/** What a send reads: the bodies and the fields the bookmark is built from, plus the archive stamp. */
export interface ReaderPostForSend {
  title: string;
  canonical_url: string | null;
  gist: string | null;
  html: string | null;
  text: string | null;
  archived_at: string | null;
}

/**
 * The one frontend read of a post's bodies, for the Instapaper send. Its result never leaves the
 * route: the body goes to Instapaper and the answer the browser gets back is the list row.
 * `archived_at` rides along so the stamp that follows can keep an archive date the post already
 * has. `.maybeSingle()`, so a missing row is the route's 404 rather than a 500.
 */
export async function getReaderPostForSend(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<{ data: ReaderPostForSend | null; error: PostgrestError | null }> {
  return supabase
    .from('reader_posts')
    .select('title,canonical_url,gist,html,text,archived_at')
    .eq('id', id)
    .maybeSingle();
}

/**
 * Record a send Instapaper confirmed: when, Instapaper's id for the bookmark, and — because once a
 * post is in Instapaper that is where it lives — the archive stamp, kept as it was when the post
 * was already archived. Written only after the save, so a refused or failed send leaves the row
 * exactly as it was. Reads back through the shared list columns, like every other write here.
 */
export async function markReaderPostSent(
  supabase: SupabaseClient<Database>,
  id: string,
  bookmarkId: number,
  now: Date,
  alreadyArchivedAt: string | null,
): Promise<{ data: ReaderPostListItem | null; error: PostgrestError | null }> {
  const sentAt = now.toISOString();
  return supabase
    .from('reader_posts')
    .update({
      instapaper_sent_at: sentAt,
      instapaper_bookmark_id: bookmarkId,
      archived_at: alreadyArchivedAt ?? sentAt,
    })
    .eq('id', id)
    .select(READER_POST_LIST_COLUMNS)
    .maybeSingle();
}
