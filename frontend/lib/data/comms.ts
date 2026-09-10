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
 * TRUNCATES SILENTLY when it does, so the message read is paged rather than asked for in one go.
 */
export const COMMS_PAGE_SIZE = 1000;

/**
 * How many pages one message read may take before it is called a failure. At ~45 messages a day
 * the 60-day mirror holds a few thousand rows, so fifty pages is orders of magnitude of
 * headroom; exhausting it means a backend that never returns a short page, and truncating there
 * would silently shrink the queue.
 */
export const COMMS_MAX_PAGES = 50;

function pagingError(): PostgrestError {
  const error = {
    name: 'PostgrestError',
    message: `Comms message read did not terminate within ${String(COMMS_MAX_PAGES)} pages`,
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

/** Every inbound message inside the retention window, walked a page at a time. */
async function readMessages(
  supabase: SupabaseClient<Database>,
  since: string,
): Promise<{ messages: CommMessage[]; error: PostgrestError | null }> {
  const messages: CommMessage[] = [];
  for (let page = 0; page < COMMS_MAX_PAGES; page += 1) {
    const offset = page * COMMS_PAGE_SIZE;
    const { data, error } = await supabase
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
      .range(offset, offset + COMMS_PAGE_SIZE - 1);

    if (error) return { messages: [], error };
    messages.push(...data);
    if (data.length < COMMS_PAGE_SIZE) return { messages, error: null };
  }
  return { messages: [], error: pagingError() };
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
 * The client takes it from here: the queue, the shelf and the badge count are all derived from
 * this one list (the app's fetch-all, filter-client-side default).
 */
export async function getCommsSeed(client?: SupabaseClient<Database>): Promise<CommsSeed> {
  const supabase = client ?? (await createClient());
  const empty: CommsSeed = { accounts: [], messages: [], verdicts: [], health: undefined };

  const { data: accounts } = await supabase
    .from('comm_accounts')
    .select('*')
    .order('created_at', { ascending: true });

  const { messages, error } = await readMessages(supabase, retentionCutoff(new Date()));
  if (error) return { ...empty, accounts: accounts ?? [] };

  const verdictIds = [
    ...new Set(messages.flatMap((m) => (m.verdict_id === null ? [] : [m.verdict_id]))),
  ];
  // An empty `in.()` is a query with no answer worth asking for.
  const { data: verdicts } =
    verdictIds.length === 0
      ? { data: [] as CommVerdict[] }
      : await supabase.from('comm_verdicts').select('*').in('id', verdictIds);

  const { data: health } = await supabase
    .from('comm_classifier_health')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  return {
    accounts: accounts ?? [],
    messages,
    verdicts: verdicts ?? [],
    health: health ?? undefined,
  };
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
 * All three are small, bounded and edited by hand, so they are read whole — the rubric history
 * in particular has to be complete for a verdict's stamped version to stay resolvable.
 */
export async function getCommsSettingsSeed(
  client?: SupabaseClient<Database>,
): Promise<CommsSettingsSeed> {
  const supabase = client ?? (await createClient());

  const { data: people } = await supabase
    .from('comm_people')
    .select('*,comm_handles(*)')
    .order('name', { ascending: true })
    .overrideTypes<CommPersonWithHandles[]>();

  const { data: rubrics } = await supabase
    .from('comm_rubrics')
    .select('*')
    .order('version', { ascending: false });

  const { data: corrections } = await supabase
    .from('comm_corrections')
    .select('*')
    .order('created_at', { ascending: false });

  return {
    people: people ?? [],
    rubrics: rubrics ?? [],
    corrections: corrections ?? [],
  };
}
