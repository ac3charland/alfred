/**
 * One wiki snapshot run: reconcile `wiki_pages` to the tree at the tip of the wiki repo's `main`,
 * then record how it went in `wiki_sync`.
 *
 *   select stored oids → GraphQL #1 (tree + commit) → diff → GraphQL #2 (changed blobs, by oid)
 *   → parse → upsert (one request) → delete (one request) → wiki_sync row 1.
 *
 * The select comes BEFORE the tree read. Runs can overlap (a push while the daily run is in
 * flight), and a run that read an older tree and only then read the rows could see a newer
 * run's rows, diff its stale tree against them, and re-upsert the older pages over the newer
 * ones. Reading the rows first means a run's rows are never newer than its tree, so the worst
 * such overlap re-writes pages with the content they already have. (A newer push landing between
 * a run's tree read and its upsert can still be overwritten; its own run, or the next, repairs it.)
 *
 * A tree diff rather than the push payload's file lists: those can be truncated, and a diff is
 * self-healing — a missed webhook, or a run that hit the page cap, is repaired by the next push
 * or by the daily safety-net run on the retention cron, with nothing to replay.
 *
 * Triggered two ways (`../index.ts`): a push to the wiki repo's main, in the background of the
 * webhook's 202, and the daily retention cron after its two sweeps.
 */
import type { SupabaseEnv } from '../supabase';
import { type WikiFetch, type WikiGithubEnv, fetchWikiBlobs, fetchWikiTree } from './graphql';
import { parsePage, sortedBy, unreadablePage } from './page';
import {
  type WikiPageRow,
  deletePages,
  fetchStoredPages,
  upsertPages,
  writeSyncState,
} from './store';

export type WikiSyncEnv = WikiGithubEnv & SupabaseEnv;

/**
 * How many changed pages one run takes, and separately how many removed pages it deletes; the
 * rest of both are counted into `pending` and converge on the next trigger.
 *
 * The CPU ceiling, not the subrequest one, sets this for changes. Subrequests are fixed per run
 * whatever the size of the change (see `WIKI_SYNC_SUBREQUEST_CEILING`), but every taken page is
 * parsed in this invocation: a few-hundred-byte YAML block plus a link scan is roughly 0.1ms of
 * CPU a page, so 60 pages is about 6ms — inside the Free plan's 10ms per invocation, with headroom
 * for JSON encoding the one upsert body. That estimate assumes ordinary page sizes: GraphQL #2's
 * JSON parse, the code-masking regex and the upsert's stringify all scale with BODY bytes, not
 * with the YAML block, so a batch of unusually long pages spends more. (Awaiting GitHub and
 * Supabase is wall time and costs no CPU.) An ingest merge touches 10–30 pages, so a normal push
 * finishes in one run; a bulk import drains over a few pushes or daily runs, and the Wiki header
 * shows the `pending` count meanwhile.
 *
 * Removals are capped for a different limit: they go as ONE `DELETE …?path=in.(…)`, and a
 * restructure that removes hundreds of pages would build a URL past the ~16KB a request line can
 * carry. Sixty quoted paths stay far inside it.
 */
export const WIKI_SYNC_PAGE_CAP = 60;

/**
 * The most subrequests a run can spend: the select, GraphQL #1, GraphQL #2, the upsert, the
 * delete, and one `wiki_sync` write — six of the Free plan's 50, whatever the size of the change.
 * A failure replaces the remaining steps with its single failure write, so it never adds one; and
 * a failed SUCCESS write is not followed by a failure write, which would be a seventh.
 */
export const WIKI_SYNC_SUBREQUEST_CEILING = 6;

/** What a run did, for the one log line the caller prints. */
export type WikiSyncSummary =
  | { ok: true; commitOid: string; changed: number; removed: number; pending: number }
  | { ok: false; error: string };

export interface WikiSyncOptions {
  /** The `fetch` every subrequest goes through; the global one by default. */
  fetch?: WikiFetch;
  /** The instant stamped as `synced_at` / `last_error_at`; the real clock by default. */
  now?: Date;
}

interface Reconciled {
  commitOid: string;
  changed: number;
  removed: number;
  pending: number;
}

/** Everything between the select and the state write — the part a failure is reported on. */
async function reconcile(
  env: WikiSyncEnv,
  doFetch: WikiFetch,
  syncedAt: string,
): Promise<Reconciled> {
  const stored = await fetchStoredPages(env, doFetch);
  const tree = await fetchWikiTree(env, doFetch);

  const storedOids = new Map(stored.map((row) => [row.path, row.blob_oid]));
  const inTree = new Set(tree.entries.map((entry) => entry.path));
  const changed = sortedBy(
    tree.entries.filter((entry) => storedOids.get(entry.path) !== entry.oid),
    (entry) => entry.path,
  );
  const removed = sortedBy(
    stored.filter((row) => !inTree.has(row.path)).map((row) => row.path),
    (path) => path,
  );
  const taken = changed.slice(0, WIKI_SYNC_PAGE_CAP);
  const deleted = removed.slice(0, WIKI_SYNC_PAGE_CAP);

  if (taken.length > 0) {
    const blobs = await fetchWikiBlobs(
      env,
      doFetch,
      taken.map((entry) => entry.oid),
    );
    const rows: WikiPageRow[] = taken.map((entry, index) => {
      const blob = blobs[index];
      let page;
      if (blob === undefined || blob.isBinary || blob.text === undefined) {
        page = unreadablePage(entry.path, 'binary blob: GitHub returned no text');
      } else if (blob.isTruncated) {
        page = unreadablePage(entry.path, 'truncated blob: GitHub cut the text short');
      } else {
        page = parsePage(entry.path, blob.text);
      }
      return { ...page, blob_oid: entry.oid, commit_oid: tree.commitOid, synced_at: syncedAt };
    });
    await upsertPages(env, doFetch, rows);
  }

  // Strictly after the upsert: a failed upsert throws before any removal is sent.
  if (deleted.length > 0) await deletePages(env, doFetch, deleted);

  return {
    commitOid: tree.commitOid,
    changed: taken.length,
    removed: deleted.length,
    pending: changed.length - taken.length + (removed.length - deleted.length),
  };
}

/**
 * Run one snapshot. Resolves with a summary on success AND on a recorded failure: any throw
 * while reconciling is written to `wiki_sync` as `{last_error, last_error_at}` — outside the
 * `try` it reports on, so a broken database cannot hide behind its own error handler. A failure
 * before the upsert leaves the pages exactly as they were. A failed delete after a successful
 * upsert leaves the new rows written and the removed ones still present; the next run's diff
 * sees the same removals and deletes them. Rejects only when a `wiki_sync` write itself fails.
 */
export async function syncWiki(
  env: WikiSyncEnv,
  options: WikiSyncOptions = {},
): Promise<WikiSyncSummary> {
  const doFetch: WikiFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const at = (options.now ?? new Date()).toISOString();

  let result: Reconciled | undefined;
  let failure: string | undefined;
  try {
    result = await reconcile(env, doFetch, at);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (result === undefined) {
    const error = failure ?? 'unknown failure';
    await writeSyncState(env, doFetch, { last_error: error, last_error_at: at });
    return { ok: false, error };
  }

  await writeSyncState(env, doFetch, {
    commit_oid: result.commitOid,
    synced_at: at,
    pending: result.pending,
    last_error: undefined,
  });
  return { ok: true, ...result };
}
