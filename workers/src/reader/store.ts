/**
 * Every database access the Reader tick makes, in one place — the same arrangement, and for the
 * same reason, as `comms/store.ts`: the loop in `scheduled.ts` should be about ordering and
 * outcomes, not about building a URL or knowing a column name.
 *
 * It is built on `supabase.ts`'s plumbing, so a rejected reader write reads in the log exactly
 * like a rejected comms one. Three things that plumbing cannot express live here instead:
 *
 * A COUNT. `fetchJson` reads a body; the ceiling wants a number the body does not carry.
 * PostgREST answers a `Prefer: count=exact` request with the total in `Content-Range`, so the
 * count helper below sends its own headers — replacing, not adding to, the `return=representation`
 * that `headers(env)` sets — and reads the header rather than the rows.
 *
 * A CONFLICT THAT IS NOT AN ERROR. The insert IS the claim, so a 409 on
 * `(account_key, gmail_message_id)` means another tick got there first. That is a value the loop
 * switches on, not a throw: the comms row still needs stamping, and the post is somebody else's.
 *
 * A COMPARE-AND-SET. Cloudflare does not serialise scheduled invocations and a tick may run ten
 * minutes against a five-minute cron, so every write that could be racing narrows its filter
 * until the loser matches zero rows: the lease takes the row only while it is unclaimed or stale,
 * and the attempt increment takes it only while the count is still what this tick read.
 */
import { type SupabaseEnv, fetchJson, headers, restQueryUrl } from '../supabase';
import { leaseFreeFilter } from './worklist';

/**
 * A JSON `null`, which is how PostgREST spells "clear this column".
 *
 * The package bans the literal (`unicorn/no-null`), and `undefined` is not an alternative in a
 * PATCH body: `JSON.stringify` drops an undefined key entirely, which leaves the column UNCHANGED
 * rather than clearing it. Every lease release needs the difference.
 */
export const JSON_NULL: unknown = JSON.parse('null');

/** `Content-Range: 0-0/29` — and `*\/0` for an empty table. The total is what the ceiling wants. */
const CONTENT_RANGE_TOTAL = /\/(\d+)$/;

/**
 * The columns a fresh post is inserted with. Everything else takes its column default: the row is
 * the FLOOR — title and link — written before any model call, so a tick that dies leaves a
 * pending post the next tick picks up rather than a half-written summary.
 */
export interface ReaderPostInsert {
  publication_id: string;
  comm_message_id?: string | undefined;
  account_key: string;
  gmail_message_id: string;
  rfc822_message_id?: string | undefined;
  title: string;
  author?: string | undefined;
  canonical_url?: string | undefined;
  received_at: string;
  text: string;
  word_count: number;
  html_extracted: boolean;
  summary_state: 'pending';
  /** The lease: `now` claims the row for this tick, a JSON null leaves it for tomorrow. */
  summarizing_since: unknown;
}

/** What an insert did. A conflict is a value rather than a throw — another tick owns the post. */
export type InsertPostResult = { inserted: true; id: string } | { inserted: false; conflict: true };

/**
 * How many rows of `table` match `filters`, without reading any of them.
 *
 * `Prefer: count=exact` REPLACES the `return=representation` that `headers(env)` sets rather than
 * joining it: the two are alternatives, and asking for both hands back every matching row —
 * which, for the ceiling's query over a day of posts, is the whole body this call exists to
 * avoid. `Range: 0-0` asks for a single row on top of that, so the response is one row and a
 * header whatever the total is.
 *
 * Throws when the header is missing or unreadable. A count is the money guard's input, and
 * the one failure it must not have is quietly reading as zero — which is "unlimited" by another
 * name.
 */
export async function countRows(
  env: SupabaseEnv,
  table: string,
  filters: Record<string, string>,
): Promise<number> {
  const url = restQueryUrl(env, table, { select: 'id', ...filters });
  const response = await fetch(url, {
    headers: { ...headers(env), Prefer: 'count=exact', Range: '0-0' },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase COUNT ${table} failed: ${String(response.status)} ${detail}`);
  }

  const range = response.headers.get('Content-Range');
  const total = CONTENT_RANGE_TOTAL.exec(range ?? '')?.[1];
  if (total === undefined) {
    throw new Error(
      `Supabase COUNT ${table} returned no usable Content-Range: ${range ?? '(absent)'}`,
    );
  }
  return Number.parseInt(total, 10);
}

/**
 * Insert one post, or report that it already exists.
 *
 * The unique key is `(account_key, gmail_message_id)` — the dedupe key, never a cursor — so a
 * 409 means exactly one thing: another tick, or a re-mirrored comms row, already wrote this post.
 * The caller still has a comms row to stamp, so a conflict is a result and not an error; every
 * other non-2xx throws, as every write in `supabase.ts` does.
 */
export async function insertPost(
  env: SupabaseEnv,
  row: ReaderPostInsert,
): Promise<InsertPostResult> {
  const response = await fetch(restQueryUrl(env, 'reader_posts', {}), {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(row),
  });

  if (response.status === 409) {
    // Drain the body so the connection is not left half-read, and discard it: PostgREST's
    // conflict detail names the constraint, which is the one thing already known here.
    await response.text();
    return { inserted: false, conflict: true };
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase POST reader_posts failed: ${String(response.status)} ${detail}`);
  }

  const rows = await response.json<{ id: string }[]>();
  const [first] = rows;
  if (first === undefined) throw new Error('Supabase POST reader_posts returned no row');
  return { inserted: true, id: first.id };
}

/**
 * Stamp `comm_messages.reader_claimed_at`, which is what takes a newsletter off the Comms FYI
 * shelf and out of `v_reader_worklist` at the same moment. Returns the rows matched —
 * zero means the comms row was purged by retention between the worklist read and here.
 */
export function claimCommMessage(
  env: SupabaseEnv,
  commMessageId: string,
  now: Date,
): Promise<number> {
  return patchRows(
    env,
    'comm_messages',
    { id: `eq.${commMessageId}` },
    { reader_claimed_at: now.toISOString() },
  );
}

/**
 * Take the lease on a pending post this tick means to retry.
 *
 * The filter is the whole mechanism: still pending, and either never claimed or claimed longer
 * ago than the runtime's own fifteen-minute ceiling. Zero rows back is not a failure — it means
 * an overlapping tick holds the row — so the caller skips rather than retries.
 */
export function leasePost(env: SupabaseEnv, id: string, now: Date): Promise<number> {
  return patchRows(
    env,
    'reader_posts',
    { id: `eq.${id}`, summary_state: 'eq.pending', or: leaseFreeFilter(now) },
    { summarizing_since: now.toISOString() },
  );
}

/**
 * The terminal patch: whatever one model attempt decided, plus the lease release that every row
 * of the outcome table carries.
 *
 * `ifAttemptsEquals` is the counted-failure row's compare-and-set, and it is there for the reason
 * `comms/sweep.ts`'s `countAttempt` has it: two overlapping ticks can both read
 * `summarize_attempts: n`, both fail, and both PATCH `n + 1`, so one real billed failure goes
 * uncounted and the ceiling takes twice as many calls to fire. With the filter, a write whose
 * base has moved matches nothing — a no-op, because the count is already right.
 */
export function patchPost(
  env: SupabaseEnv,
  id: string,
  updates: Record<string, unknown>,
  options: { ifAttemptsEquals?: number } = {},
): Promise<number> {
  const filters: Record<string, string> = { id: `eq.${id}` };
  if (options.ifAttemptsEquals !== undefined) {
    filters['summarize_attempts'] = `eq.${String(options.ifAttemptsEquals)}`;
  }
  return patchRows(env, 'reader_posts', filters, updates);
}

/** One filtered PATCH, returning the rows it matched. Throws on a non-2xx, as every write does. */
async function patchRows(
  env: SupabaseEnv,
  table: string,
  filters: Record<string, string>,
  updates: Record<string, unknown>,
): Promise<number> {
  const rows = await fetchJson<unknown[]>(
    env,
    restQueryUrl(env, table, filters),
    { method: 'PATCH', body: JSON.stringify(updates) },
    `PATCH ${table}`,
  );
  return rows.length;
}
