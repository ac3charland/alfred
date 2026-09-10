import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import 'server-only';

import { RETENTION_DAYS } from '@/lib/comms';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import type {
  CommAccount,
  CommClassifierHealth,
  CommCorrection,
  CommMessage,
  CommPersonWithHandles,
  CommRubric,
  CommVerdict,
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
 * day the 60-day mirror holds a few thousand rows — the largest of the four paged tables here —
 * so fifty pages is orders of magnitude of headroom for all of them; exhausting it means a
 * backend that never returns a short page, and truncating there would silently shrink whichever
 * list it was.
 */
export const COMMS_MAX_PAGES = 50;

/**
 * How many verdict ids one `in.()` request may carry.
 *
 * `getCommsSeed` asks for the CURRENT verdict behind every judged message in the retention
 * window — this file's own sizing note above says that's routinely a few thousand ids. An
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
 * `readMessages` needed this first, but PostgREST's row cap doesn't care whether a table is
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

/** Every inbound message inside the retention window, walked a page at a time. */
async function readMessages(
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
      // A total order across pages is what makes paging safe: without it two requests can
      // return the same row twice and never return another.
      .order('received_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + COMMS_PAGE_SIZE - 1),
  );
  return { messages: rows, error };
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

/** What the queue needs: the accounts, their messages, the verdicts behind them, and health. */
export interface CommsSeed {
  accounts: CommAccount[];
  messages: CommMessage[];
  verdicts: CommVerdict[];
  /** The singleton health row; absent until the classifier sweep has run at least once. */
  health: CommClassifierHealth | undefined;
}

/**
 * The Comms queue seed: every account, every inbound message inside the 60-day retention
 * window, the verdicts those messages point at, and the classifier's own health.
 *
 * Verdicts are read by `id` from the messages' `verdict_id` — the CURRENT verdict for each
 * message, not the whole audit trail. A re-classification writes a new verdict row and moves
 * the message's pointer, so the superseded rows are history the queue never renders; fetching
 * them all would grow without bound while showing nothing extra.
 *
 * The four reads are sequenced, each one checked for `error` before the next runs, and a failure
 * returns whatever already succeeded plus empty defaults for the rest — never a fallback (`??
 * []`) that would let a failed read masquerade as "there's nothing here." An account read that
 * fails, for instance, stops the seed cold rather than going on to read messages against a roster
 * it doesn't actually have.
 *
 * The client takes it from here: the queue, the shelf and the badge count are all derived from
 * this one list (the app's fetch-all, filter-client-side default).
 */
export async function getCommsSeed(client?: SupabaseClient<Database>): Promise<CommsSeed> {
  const supabase = client ?? (await createClient());
  const empty: CommsSeed = { accounts: [], messages: [], verdicts: [], health: undefined };

  const { data: accounts, error: accountsError } = await supabase
    .from('comm_accounts')
    .select('*')
    .order('created_at', { ascending: true });
  if (accountsError) return empty;

  const { messages, error: messagesError } = await readMessages(
    supabase,
    retentionCutoff(new Date()),
  );
  if (messagesError) return { ...empty, accounts };

  const verdictIds = [
    ...new Set(messages.flatMap((m) => (m.verdict_id === null ? [] : [m.verdict_id]))),
  ];
  const { verdicts, error: verdictsError } = await readVerdicts(supabase, verdictIds);
  if (verdictsError) return { ...empty, accounts, messages };

  const { data: healthData, error: healthError } = await supabase
    .from('comm_classifier_health')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (healthError) return { accounts, messages, verdicts, health: undefined };

  return { accounts, messages, verdicts, health: healthData ?? undefined };
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
 * `readMessages` uses, including its bounded-pages failure mode: the rubric history in
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
