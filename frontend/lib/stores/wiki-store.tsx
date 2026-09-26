'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { createContextPair } from '@/lib/stores/create-context-pair';
import type { WikiClientConfig, WikiPageIndexRow, WikiSearchHit, WikiSync } from '@/lib/types';
import { WikiBodyCache, type WikiBodyEntry, wikiBodyKey } from '@/lib/wiki/body-cache';
import { type WikiSection, sortWikiPages } from '@/lib/wiki/sections';

/**
 * Wiki store — the client's copy of the knowledge repo's page snapshot.
 *
 * It breaks the house "fetch everything at the shell" default the way the weekly-plan store
 * does: the shell seeds the INDEX (every page's path, section, title, summary, tags, dates and
 * outbound links) and never a body. A body is fetched when its page opens and cached by
 * `path@blob_oid`, so a refresh that reports a changed blob drops the stale copy and the next
 * open fetches afresh.
 *
 * Nothing in the app writes a page — the Worker writes the snapshot and only git writes the
 * wiki — so there is no optimistic machinery: seeded data, a coalesced re-read on navigation
 * and on the tab returning, and a read-through body cache. No Realtime: the snapshot changes a
 * few times a day, and the re-read is small.
 *
 * `config` is what the shell knows about the repo: its `owner/name` (for GitHub links to raw
 * citations) and whether this deployment can write into it. Every send affordance — the
 * Reader's checklist, the Inbox's Classify as → Knowledge — reads `writable` from here, which is
 * why this provider mounts outside every other store.
 */

export interface WikiState {
  pages: WikiPageIndexRow[];
  /** `null` before the first sync ever wrote a row. */
  sync: WikiSync | null;
  config: WikiClientConfig;
}

export interface WikiActions {
  /**
   * Re-read the index and the sync row and replace both wholesale. Concurrent calls coalesce
   * into one request; a call while the tab is hidden is skipped (nobody is looking). Cached
   * bodies whose blob changed are dropped. Silent on failure: this is recovery, not a user
   * action, and the snapshot it would have replaced beats a blanked one.
   */
  refresh: () => void;
  /** The read-through body cache — read it through {@link useWikiPageBody}, never directly. */
  bodyCache: WikiBodyCache;
  /**
   * Full-text search over page bodies, straight through to `GET /api/wiki/search`. A pass-through:
   * the hits are per keystroke, never seeded and never shared, so the store holds none of them —
   * it only keeps components off the API client.
   */
  searchBodies: (query: string) => Promise<WikiSearchHit[]>;
}

/** The body search, a module-level function so the actions object never rebuilds for it. */
function searchBodies(query: string): Promise<WikiSearchHit[]> {
  return api.searchWikiBodies(query);
}

/** What {@link useWikiPageBody} answers: the body once it is in hand, or where it is. */
export type WikiBodyState =
  | { status: 'loading'; retry: () => void }
  | { status: 'ready'; body: string; retry: () => void }
  | { status: 'error'; retry: () => void };

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  WikiState,
  WikiActions
>('a WikiProvider');

export function WikiProvider({
  initialPages,
  initialSync,
  config,
  children,
}: {
  initialPages: WikiPageIndexRow[];
  initialSync: WikiSync | null;
  config: WikiClientConfig;
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState<WikiState>({
    pages: initialPages,
    sync: initialSync,
    config,
  });

  // One cache for the provider's whole life. Created lazily so a re-render never rebuilds it.
  const [bodyCache] = React.useState(() => new WikiBodyCache());

  const refreshingRef = React.useRef(false);
  const refresh = React.useCallback(() => {
    if (refreshingRef.current || document.hidden) return;
    refreshingRef.current = true;
    void api
      .fetchWikiPages()
      .then(({ pages, sync }) => {
        setState((current) => ({ ...current, pages, sync }));
        // Keep only the bodies whose page is still at the same blob: a changed page refetches.
        bodyCache.retain(new Set(pages.map((page) => wikiBodyKey(page.path, page.blob_oid))));
      })
      .catch(() => {
        // Deliberately silent — see the doc comment above.
      })
      .finally(() => {
        refreshingRef.current = false;
      });
  }, [bodyCache]);

  // The tab coming back is the one out-of-band trigger: `visibilitychange` for a hidden tab
  // returning, `pageshow` for a bfcache restore. In-app navigation is the view-router's job,
  // keyed on its pathname (the navigation-refetch pattern).
  React.useEffect(() => {
    const onReturn = () => {
      if (document.hidden) return;
      refresh();
    };
    document.addEventListener('visibilitychange', onReturn);
    globalThis.addEventListener('pageshow', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      globalThis.removeEventListener('pageshow', onReturn);
    };
  }, [refresh]);

  const actions = React.useMemo<WikiActions>(
    () => ({ refresh, bodyCache, searchBodies }),
    [refresh, bodyCache],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Every page, in the wiki's own index order. Throws outside a WikiProvider. */
export function useWikiPages(): WikiPageIndexRow[] {
  const { pages } = useStateValue('useWikiPages');
  return React.useMemo(() => sortWikiPages(pages), [pages]);
}

/** How many pages each section holds — the nav's counts. */
export function useWikiCounts(): Record<WikiSection, number> & { all: number } {
  const { pages } = useStateValue('useWikiCounts');
  return React.useMemo(() => {
    const counts = { all: pages.length, concepts: 0, entities: 0, sources: 0, questions: 0 };
    for (const page of pages) {
      if (page.section in counts) counts[page.section as WikiSection] += 1;
    }
    return counts;
  }, [pages]);
}

/** The sync row, or `null` before the first sync. */
export function useWikiSync(): WikiSync | null {
  return useStateValue('useWikiSync').sync;
}

/** The repo and whether this deployment can write into it. */
export function useWikiConfig(): WikiClientConfig {
  return useStateValue('useWikiConfig').config;
}

/** The wiki actions. Throws outside a WikiProvider. */
export function useWikiActions(): WikiActions {
  return useActions('useWikiActions');
}

/** The server snapshot: no body is ever in hand during SSR, so a page always renders loading first. */
const NO_ENTRY: WikiBodyEntry | undefined = undefined;

/**
 * A body fetch that goes through the API client, so the cache never touches the network itself.
 * Rejects when the route answers a different blob than `blobOid` names — a refresh can change
 * the page's blob while this fetch is in flight, and caching that answer under the STALE key
 * would mislabel a real body as belonging to a version it never was. The cache's own `.catch`
 * turns this into `status: 'error'` rather than a wrongly-labelled `ready`. A mismatch also means
 * the INDEX this hook read `blobOid` from is itself stale — the snapshot moved after the index
 * was seeded/refreshed but before this fetch landed — so `onStale` triggers the store's own
 * `refresh()` too, so the index catches up on its own rather than waiting for the next
 * navigation or tab-return; the next render then re-keys the body under the page's new blob id
 * and fetches the true current version fresh.
 */
function fetchBody(path: string, blobOid: string, onStale: () => void): Promise<string> {
  return api.fetchWikiPageBody(path).then((page) => {
    if (page.blob_oid !== blobOid) {
      onStale();
      throw new Error(`wiki: ${path} answered blob ${page.blob_oid}, expected ${blobOid}`);
    }
    return page.body;
  });
}

/**
 * One page's body, read through the cache: `loading` until the first fetch answers, `ready` with
 * the body, or `error` with a `retry`. Keyed by the page's current blob id, so a refresh that
 * reports a new version of the page fetches it again. A path not in the index is `error` — the
 * view shows its not-found state before ever asking for a body.
 */
export function useWikiPageBody(path: string): WikiBodyState {
  const { pages } = useStateValue('useWikiPageBody');
  const { bodyCache, refresh } = useActions('useWikiPageBody');
  const page = pages.find((candidate) => candidate.path === path);
  const key = page === undefined ? undefined : wikiBodyKey(page.path, page.blob_oid);

  const entry = React.useSyncExternalStore<WikiBodyEntry | undefined>(
    bodyCache.subscribe,
    () => (key === undefined ? NO_ENTRY : bodyCache.get(key)),
    () => NO_ENTRY,
  );

  React.useEffect(() => {
    if (key === undefined || page === undefined || bodyCache.get(key) !== undefined) return;
    void bodyCache.load(key, () => fetchBody(path, page.blob_oid, refresh));
  }, [key, path, page, bodyCache, refresh]);

  const retry = React.useCallback(() => {
    if (key === undefined || page === undefined) return;
    void bodyCache.load(key, () => fetchBody(path, page.blob_oid, refresh));
  }, [key, path, page, bodyCache, refresh]);

  if (key === undefined || entry?.status === 'error') return { status: 'error', retry };
  if (entry?.status === 'ready') return { status: 'ready', body: entry.body, retry };
  return { status: 'loading', retry };
}
