import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import { RETENTION_DAYS, SHELF_ELIGIBLE_FILTER, SHELF_PAGE_SIZE } from '@/lib/comms';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type {
  CommCorrection,
  CommMessage,
  CommPersonWithHandles,
  CommRubric,
  CommVerdict,
  CommsSeed,
} from '@/lib/types';

/**
 * Server-only read layer for the Comms module — two seeds, split by the surface that needs
 * them: the queue's live data, and the settings pages' roster / rubric / example set.
 *
 * They are separate reads rather than one because they change on completely different clocks:
 * messages and account health move every few minutes and carry a realtime subscription, while
 * the roster and the rubric change when the owner edits them. Splitting them keeps the two
 * stores independent, which is what lets the settings pages be built without touching the queue.
 *
 * Both degrade in layers rather than to a blank shell: a failed read hands back an empty slice,
 * so a broken table takes out one panel and not the whole app.
 */

/**
 * Rows per request. PostgREST caps a response at the project's `Max rows` (1000 by default) and
 * TRUNCATES SILENTLY when it does, so every read in this module is paged rather than asked for
 * in one go.
 */
export const COMMS_PAGE_SIZE = 1000;

/**
 * How many pages a single paged read may take before it is called a failure. At ~45 messages a
 * day the 60-day mirror holds a few thousand rows — the most any paged read here could reach —
 * so fifty pages is orders of magnitude of headroom for all of them; exhausting it means a
 * backend that never returns a short page, and truncating there would silently shrink whichever
 * list it was.
 */
export const COMMS_MAX_PAGES = 50;

/**
 * How many verdict ids one `in.()` request may carry.
 *
 * The snapshot asks for the CURRENT verdict behind every message it returns — during a classifier
 * outage or a long unjudged backlog that can still run to thousands of ids. An
 * `in.(…)` list that size builds a request URL of ~100KB, which a typical PostgREST-fronting
 * proxy rejects outright, well before the row cap above would even come into play. 200 ids at a
 * 36-character UUID apiece keeps one chunk's `in.()` clause under ~8KB — comfortably inside the
 * request-line/header limits common proxies enforce.
 */
export const COMMS_VERDICT_CHUNK_SIZE = 200;

function pagingError(): PostgrestError {
  const error = {
    name: 'PostgrestError',
    message: `Comms read did not terminate within ${String(COMMS_MAX_PAGES)} pages`,
    details: '',
    hint: '',
    code: 'PGRST_PAGING',
  };
  return { ...error, toJSON: () => error };
}

/** The ISO instant the retention sweep's window starts at — nothing older survives anyway. */
function retentionCutoff(now: Date): string {
  return new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Walk one table a page at a time and hand back every row, or a bounded-pages failure.
 *
 * The message read needed this first, but PostgREST's row cap doesn't care whether a table is
 * "small and edited by hand" — it truncates any unbounded `.select()` the same way regardless of
 * why the table grew past it. So this is the one loop every paged Comms read shares: the caller
 * supplies the query up to `.range()` (which needs the `offset` this passes in), and this owns
 * the accumulation, the total-order-across-pages contract, and the `pagingError()` when a read
 * never shortens.
 */
async function readAllPages<T>(
  fetchPage: (offset: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<{ rows: T[]; error: PostgrestError | null }> {
  const rows: T[] = [];
  for (let page = 0; page < COMMS_MAX_PAGES; page += 1) {
    const offset = page * COMMS_PAGE_SIZE;
    const { data, error } = await fetchPage(offset);
    if (error) return { rows: [], error };
    const pageRows = data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < COMMS_PAGE_SIZE) return { rows, error: null };
  }
  return { rows: [], error: pagingError() };
}

/**
 * Everything above FYI inside the retention window, walked a page at a time: every uncleared row
 * that is queued or not judged yet. Both are complete sets the client derives from — the queue
 * and the badge count from the first, the classifier-stall signal from the second — and both
 * are small by design, so neither is paged in the UI.
 */
async function readActiveMessages(
  supabase: SupabaseClient<Database>,
  since: string,
): Promise<{ messages: CommMessage[]; error: PostgrestError | null }> {
  const { rows, error } = await readAllPages<CommMessage>((offset) =>
    supabase
      .from('comm_messages')
      .select('*')
      // Outbound rows are mirrored only as the reply-detection signal — they are never queued,
      // never shelved and never rendered, so the client has no use for them.
      .eq('direction', 'inbound')
      .gte('received_at', since)
      .is('cleared_at', null)
      // `neq` alone would drop the unjudged rows: a null tier is not "not fyi" to SQL.
      .or('tier.is.null,tier.neq.fyi')
      // A total order across pages is what makes paging safe: without it two requests can
      // return the same row twice and never return another.
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + COMMS_PAGE_SIZE - 1),
  );
  return { messages: rows, error };
}

/**
 * The newest `limit` shelf rows, and how many are on the shelf in all — walked a page at a time,
 * since a tab that has pressed "Show more" enough asks for more than the row cap. The first
 * request carries the count; the walk stops once it holds `limit` rows or a page comes up short.
 */
async function readShelfPage(
  supabase: SupabaseClient<Database>,
  since: string,
  limit: number,
): Promise<{ messages: CommMessage[]; count: number; error: PostgrestError | null }> {
  const messages: CommMessage[] = [];
  let count = 0;
  for (let offset = 0; offset < limit; offset += COMMS_PAGE_SIZE) {
    const size = Math.min(COMMS_PAGE_SIZE, limit - offset);
    const {
      data,
      count: total,
      error,
    } = await supabase
      .from('comm_messages')
      .select('*', offset === 0 ? { count: 'exact' } : undefined)
      .eq('direction', 'inbound')
      .gte('received_at', since)
      .or(SHELF_ELIGIBLE_FILTER)
      // A claimed newsletter lives in the reading list; the shelf only counts it (below).
      .is('reader_claimed_at', null)
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + size - 1);
    if (error) return { messages: [], count: 0, error };
    if (offset === 0) count = total ?? 0;
    messages.push(...data);
    if (data.length < size) break;
  }
  return { messages, count, error: null };
}

/** How many shelf-eligible newsletters the Reader claimed — a count, never the rows. */
async function countReaderClaimed(
  supabase: SupabaseClient<Database>,
  since: string,
): Promise<{ count: number; error: PostgrestError | null }> {
  const { count, error } = await supabase
    .from('comm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('direction', 'inbound')
    .gte('received_at', since)
    .or(SHELF_ELIGIBLE_FILTER)
    .not('reader_claimed_at', 'is', null);
  return { count: count ?? 0, error };
}

/** The newest verdict across the window — held rows alone can't say, once the shelf is paged. */
async function readLastClassifiedAt(
  supabase: SupabaseClient<Database>,
  since: string,
): Promise<{ at: string | null; error: PostgrestError | null }> {
  const { data, error } = await supabase
    .from('comm_messages')
    .select('classified_at')
    .eq('direction', 'inbound')
    .gte('received_at', since)
    .not('classified_at', 'is', null)
    .order('classified_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { at: data?.classified_at ?? null, error };
}

/**
 * The current verdict behind every id in `verdictIds`, walked a chunk at a time.
 *
 * Two independent limits are in play, and chunking only handles the first: an `in.(…)` list of a
 * few thousand ids builds a request URL too large for a typical PostgREST-fronting proxy to
 * accept at all, so this splits the ask into requests of at most `COMMS_VERDICT_CHUNK_SIZE` ids.
 * A chunk that small is never going to bump PostgREST's row cap on its own, but each chunk still
 * runs through `readAllPages` (with `.order('id')` for the total order paging needs) rather than
 * a bare `.in()` — the same paging guarantee every other read in this file carries, applied
 * uniformly instead of assumed safe because "this one's requests are small."
 *
 * An empty `verdictIds` makes no request at all — a query with no answer worth asking for.
 */
async function readVerdicts(
  supabase: SupabaseClient<Database>,
  verdictIds: string[],
): Promise<{ verdicts: CommVerdict[]; error: PostgrestError | null }> {
  const verdicts: CommVerdict[] = [];
  for (let start = 0; start < verdictIds.length; start += COMMS_VERDICT_CHUNK_SIZE) {
    const chunk = verdictIds.slice(start, start + COMMS_VERDICT_CHUNK_SIZE);
    const { rows, error } = await readAllPages<CommVerdict>((offset) =>
      supabase
        .from('comm_verdicts')
        .select('*')
        .in('id', chunk)
        .order('id', { ascending: true })
        .range(offset, offset + COMMS_PAGE_SIZE - 1),
    );
    if (error) return { verdicts: [], error };
    verdicts.push(...rows);
  }
  return { verdicts, error: null };
}

/**
 * The Comms queue's snapshot: every account, everything above FYI, the newest `shelfLimit` shelf
 * rows, the shelf's and the Reader's counts, the verdicts behind the rows returned, and the
 * classifier's own health. The shell seeds from it; `GET /api/comms/snapshot` re-reads it whenever
 * a tab may have missed something, and to load more of the shelf.
 *
 * Verdicts are read by `id` from the messages' `verdict_id` — the CURRENT verdict for each
 * message, not the whole audit trail.
 *
 * The reads are sequenced, each checked for `error` before the next runs. A failure returns what
 * already succeeded, with empty defaults for the rest, AND the error: the shell degrades in
 * layers rather than blanking, while the snapshot route refuses to hand a partial read to a
 * client that would replace its whole view with it.
 */
export async function readCommsSnapshot(
  supabase: SupabaseClient<Database>,
  shelfLimit: number = SHELF_PAGE_SIZE,
): Promise<{ seed: CommsSeed; error: PostgrestError | null }> {
  const now = new Date();
  const since = retentionCutoff(now);
  const seed: CommsSeed = {
    accounts: [],
    messages: [],
    verdicts: [],
    health: undefined,
    shelfCount: 0,
    readerClaimedCount: 0,
    lastClassifiedAt: null,
    readAt: now.toISOString(),
  };

  const { data: accounts, error: accountsError } = await supabase
    .from('comm_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (accountsError) return { seed, error: accountsError };
  seed.accounts = accounts;

  const active = await readActiveMessages(supabase, since);
  if (active.error) return { seed, error: active.error };
  const shelf = await readShelfPage(supabase, since, shelfLimit);
  if (shelf.error) return { seed, error: shelf.error };
  // Two reads, so a row cleared between them comes back from both; the shelf's copy is the later.
  const shelfIds = new Set(shelf.messages.map((message) => message.id));
  seed.messages = [
    ...active.messages.filter((message) => !shelfIds.has(message.id)),
    ...shelf.messages,
  ];
  seed.shelfCount = shelf.count;

  const claimed = await countReaderClaimed(supabase, since);
  if (claimed.error) return { seed, error: claimed.error };
  seed.readerClaimedCount = claimed.count;

  const lastClassified = await readLastClassifiedAt(supabase, since);
  if (lastClassified.error) return { seed, error: lastClassified.error };
  seed.lastClassifiedAt = lastClassified.at;

  const verdictIds = [
    ...new Set(seed.messages.flatMap((m) => (m.verdict_id === null ? [] : [m.verdict_id]))),
  ];
  const { verdicts, error: verdictsError } = await readVerdicts(supabase, verdictIds);
  if (verdictsError) return { seed, error: verdictsError };
  seed.verdicts = verdicts;

  const { data: health, error: healthError } = await supabase
    .from('comm_classifier_health')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (healthError) return { seed, error: healthError };
  seed.health = health ?? undefined;

  return { seed, error: null };
}

/** The shell's first read of the queue: {@link readCommsSnapshot}'s first shelf page. */
export async function getCommsSeed(client?: SupabaseClient<Database>): Promise<CommsSeed> {
  const { seed } = await readCommsSnapshot(client ?? (await createClient()));
  return seed;
}

/** What the settings pages need: the roster, every rubric version, and the example set. */
export interface CommsSettingsSeed {
  people: CommPersonWithHandles[];
  /** Every version, newest first — the current rubric is the head of the list. */
  rubrics: CommRubric[];
  /** Every recorded correction, newest first. */
  corrections: CommCorrection[];
}

/**
 * The Comms settings seed: the roster with each person's handles embedded, every rubric version
 * newest-first (so the current one is simply the head), and every correction newest-first.
 *
 * All three are edited by hand, but "edited by hand" says nothing about their row COUNT — the
 * roster and the correction set both grow with ordinary use, and PostgREST's `Max rows` cap
 * truncates an unbounded `.select()` on any of them exactly as silently as it would on the
 * message queue. So all three are walked page by page through the same `readAllPages` loop
 * the message read uses, including its bounded-pages failure mode: the rubric history in
 * particular has to stay COMPLETE for a verdict's stamped version to stay resolvable, and a
 * truncated tail would quietly break that.
 */
export async function getCommsSettingsSeed(
  client?: SupabaseClient<Database>,
): Promise<CommsSettingsSeed> {
  const supabase = client ?? (await createClient());

  const { rows: people } = await readAllPages<CommPersonWithHandles>((offset) =>
    supabase
      .from('comm_people')
      .select('*,comm_handles(*)')
      .order('name', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + COMMS_PAGE_SIZE - 1)
      .overrideTypes<CommPersonWithHandles[]>(),
  );

  const { rows: rubrics } = await readAllPages<CommRubric>((offset) =>
    supabase
      .from('comm_rubrics')
      .select('*')
      .order('version', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + COMMS_PAGE_SIZE - 1),
  );

  const { rows: corrections } = await readAllPages<CommCorrection>((offset) =>
    supabase
      .from('comm_corrections')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + COMMS_PAGE_SIZE - 1),
  );

  return { people, rubrics, corrections };
}
