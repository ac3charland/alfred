/**
 * Every database access the wiki sync makes: one read and three writes, each a single request.
 *
 * Built on `supabase.ts`'s plumbing — the same service-role headers, the same URL builder and the
 * same `Supabase <context> failed: <status> <detail>` throw — but through the sync's own `fetch`,
 * so a run's subrequests can be counted end to end, and with its own `Prefer`, since an upsert's
 * conflict resolution travels only in that header (which `fetchJson` sends verbatim).
 */
import { type SupabaseEnv, headers, restQueryUrl } from '../supabase';
import type { WikiFetch } from './graphql';
import type { ParsedPage } from './page';

/**
 * A JSON `null`, produced rather than written because this package bans the literal. A bulk
 * upsert's rows must all carry the same keys (`PGRST102`), and `JSON.stringify` drops an
 * `undefined` key — so an absent date or a cleared `parse_error` must go as an explicit null.
 */
const JSON_NULL: unknown = JSON.parse('null');

/** A parsed page plus the three columns the sync stamps. */
export interface WikiPageRow extends ParsedPage {
  blob_oid: string;
  commit_oid: string;
  synced_at: string;
}

/** What the sync reads back to diff against: each stored page's blob oid. */
export interface StoredPage {
  path: string;
  blob_oid: string;
}

/** One request, throwing the shared shape on a non-2xx. Returns the response for a read. */
async function send(
  env: SupabaseEnv,
  doFetch: WikiFetch,
  url: string,
  init: RequestInit & { prefer?: string },
  context: string,
): Promise<Response> {
  const { prefer, ...rest } = init;
  const response = await doFetch(url, {
    ...rest,
    headers: { ...headers(env), ...(prefer === undefined ? {} : { Prefer: prefer }) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase ${context} failed: ${String(response.status)} ${detail}`);
  }
  return response;
}

/**
 * Every stored page's path and blob oid, in path order. Unpaged on purpose: each page would cost
 * a subrequest, and the wiki is hundreds of pages against PostgREST's `max_rows` ceiling (1000 on
 * Supabase by default). Past that ceiling the read is silently truncated — never a deletion, since
 * an unread row only ever looks CHANGED — but those rows are then re-fetched and re-written every
 * run, and because changes are taken in path order they can starve later-sorting edits of the
 * page cap. If the wiki approaches 1000 pages, raise `max_rows` or page this read.
 */
export async function fetchStoredPages(
  env: SupabaseEnv,
  doFetch: WikiFetch,
): Promise<StoredPage[]> {
  const url = restQueryUrl(env, 'wiki_pages', { select: 'path,blob_oid', order: 'path.asc' });
  const response = await send(env, doFetch, url, {}, 'GET wiki_pages');
  return response.json<StoredPage[]>();
}

/** A row with every optional column present on the wire, so the batch has one shape. */
function toWire(row: WikiPageRow): Record<string, unknown> {
  return {
    ...row,
    created: row.created ?? JSON_NULL,
    updated: row.updated ?? JSON_NULL,
    parse_error: row.parse_error ?? JSON_NULL,
  };
}

/** Upsert every parsed row in ONE request, keyed on `path`. */
export async function upsertPages(
  env: SupabaseEnv,
  doFetch: WikiFetch,
  rows: WikiPageRow[],
): Promise<void> {
  await send(
    env,
    doFetch,
    restQueryUrl(env, 'wiki_pages', { on_conflict: 'path' }),
    {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(rows.map((row) => toWire(row))),
    },
    'upsert wiki_pages',
  );
}

/**
 * Escape one path for a PostgREST quoted list element: backslashes doubled FIRST, then quotes, so
 * the quote's own escape is not re-consumed (the same rule as `comms/gmail-store.ts`).
 */
function quoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', String.raw`\"`)}"`;
}

/** Delete every path in `paths` in ONE request. */
export async function deletePages(
  env: SupabaseEnv,
  doFetch: WikiFetch,
  paths: string[],
): Promise<void> {
  const url = restQueryUrl(env, 'wiki_pages', {
    path: `in.(${paths.map((path) => quoted(path)).join(',')})`,
  });
  await send(
    env,
    doFetch,
    url,
    { method: 'DELETE', prefer: 'return=minimal' },
    'DELETE wiki_pages',
  );
}

/** The singleton's columns a run writes: the success fields, or the failure pair. */
export type WikiSyncState =
  | { commit_oid: string; synced_at: string; pending: number; last_error: undefined }
  | { last_error: string; last_error_at: string };

/**
 * Upsert `wiki_sync` row 1. Only the columns named are written, so a failure leaves the last good
 * `commit_oid`/`synced_at` standing and a success leaves `last_error_at` as history — the module
 * reads "the last sync failed" as `last_error_at` newer than `synced_at`.
 */
export async function writeSyncState(
  env: SupabaseEnv,
  doFetch: WikiFetch,
  state: WikiSyncState,
): Promise<void> {
  const body = { id: 1, ...state, last_error: state.last_error ?? JSON_NULL };
  await send(
    env,
    doFetch,
    restQueryUrl(env, 'wiki_sync', { on_conflict: 'id' }),
    {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: JSON.stringify(body),
    },
    'upsert wiki_sync',
  );
}
