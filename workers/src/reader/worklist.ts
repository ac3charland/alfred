/**
 * The two reads that decide what a tick works on: posts already stored that still need a summary,
 * and mail that has no post yet.
 *
 * Retries come FIRST in the tick's list, which is why they are a separate read rather than
 * one query: a busy morning of fresh mail would otherwise starve a post that failed once, and a
 * post nobody ever retries is a permanently pending row in the reading list.
 *
 * The fresh side is a VIEW rather than a query, because the thing that makes a message eligible —
 * "there is no post for it yet" — is an anti-join, and PostgREST cannot express one. The view
 * also carries the seven-day horizon and the claimed-row exclusion, so nothing here re-states
 * them and nothing here can get them subtly different from the migration.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';
import type { WorklistRow } from './types';

/**
 * How long a lease is honoured before another tick may take the row.
 *
 * Fifteen minutes is the Cloudflare scheduled invocation's own wall-clock ceiling, so a tick that
 * died mid-call cannot still be running when its rows are released — and a tick that is merely
 * slow (the tick budgets eight minutes) is still comfortably inside it.
 */
export const READER_LEASE_STALE_MS = 15 * 60_000;

/** The columns a retry needs: enough to build the model's input and to CAS the attempt count. */
const RETRY_COLUMNS =
  'id,publication_id,title,author,canonical_url,received_at,text,word_count,summarize_attempts';

/** A pending post as PostgREST returns it — JSON nulls, not `undefined`. */
interface WireRetryRow {
  id: string;
  publication_id: string;
  title: string;
  author: string | null;
  canonical_url: string | null;
  received_at: string;
  text: string | null;
  word_count: number;
  summarize_attempts: number;
}

/** A pending post this tick may retry, nulls already mapped away. */
export interface RetryRow {
  id: string;
  publication_id: string;
  title: string;
  author?: string | undefined;
  canonical_url?: string | undefined;
  received_at: string;
  /** Absent once a retention sweep has nulled it; the tick treats that as nothing to summarise. */
  text?: string | undefined;
  word_count: number;
  /** The count as READ, which is what the terminal patch compare-and-sets against. */
  summarize_attempts: number;
}

/**
 * The `or=(…)` value that means "this row's lease is free": never claimed, or claimed longer ago
 * than the staleness bound. Shared by the retry READ and the lease WRITE (`store.leasePost`) on
 * purpose — the two must describe the same set of rows, and one string is how that stays true.
 *
 * PostgREST takes the whole disjunction as a single query-parameter VALUE, so `URLSearchParams`
 * percent-encoding the parentheses and commas is correct and expected; the server decodes them
 * before parsing.
 */
export function leaseFreeFilter(now: Date): string {
  const stale = new Date(now.getTime() - READER_LEASE_STALE_MS).toISOString();
  return `(summarizing_since.is.null,summarizing_since.lt.${stale})`;
}

/**
 * Posts that are still pending, still under the attempt ceiling, and not leased by a live tick.
 * Oldest first, so a backlog drains in the order it arrived rather than newest-wins.
 *
 * This read is skipped entirely on a capped day: it exists only to feed model calls, and on
 * a capped day there are none to feed.
 */
export async function fetchRetries(
  env: SupabaseEnv,
  now: Date,
  limit: number,
): Promise<RetryRow[]> {
  const url = restQueryUrl(env, 'reader_posts', {
    select: RETRY_COLUMNS,
    summary_state: 'eq.pending',
    summarize_attempts: 'lt.3',
    or: leaseFreeFilter(now),
    order: 'created_at.asc',
    limit: String(limit),
  });

  const rows = await fetchJson<WireRetryRow[]>(env, url, {}, 'GET reader_posts');
  return rows.map((row) => ({
    id: row.id,
    publication_id: row.publication_id,
    title: row.title,
    author: row.author ?? undefined,
    canonical_url: row.canonical_url ?? undefined,
    received_at: row.received_at,
    text: row.text ?? undefined,
    word_count: row.word_count,
    summarize_attempts: row.summarize_attempts,
  }));
}

/** Mail from an enabled publication with no post yet. Oldest first, for the same reason. */
export async function fetchFresh(env: SupabaseEnv, limit: number): Promise<WorklistRow[]> {
  const url = restQueryUrl(env, 'v_reader_worklist', {
    order: 'received_at.asc',
    limit: String(limit),
  });

  const rows = await fetchJson<WireWorklistRow[]>(env, url, {}, 'GET v_reader_worklist');
  return rows.map((row) => ({
    comm_message_id: row.comm_message_id,
    gmail_message_id: row.gmail_message_id,
    account_key: row.account_key,
    publication_id: row.publication_id,
    sender_handle: row.sender_handle,
    sender_name: row.sender_name ?? undefined,
    subject: row.subject ?? undefined,
    rfc822_message_id: row.rfc822_message_id ?? undefined,
    received_at: row.received_at,
  }));
}

/** `v_reader_worklist` as PostgREST returns it. */
interface WireWorklistRow {
  comm_message_id: string;
  gmail_message_id: string;
  account_key: string;
  publication_id: string;
  sender_handle: string;
  sender_name: string | null;
  subject: string | null;
  rfc822_message_id: string | null;
  received_at: string;
}
