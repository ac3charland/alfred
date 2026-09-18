'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { byReceivedDescending, isActive, isArchived } from '@/lib/reader/list';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, capturedFields, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ReaderHealthSnapshot, ReaderPostListItem } from '@/lib/types';

/**
 * Reader store — the optimistic client cache of the reading list.
 *
 * Unlike Comms, nothing pushes into this browser out of band yet: no realtime channel, because
 * no surface needs one so far. The one writer besides
 * this tab is the Worker's tick, landing a summary or a health stamp on a row this tab already
 * holds — so `refresh()` re-reads the list on the same two signals Comms' `reconcileHealth` uses
 * (a tab returning to the foreground, a socket-equivalent "might have missed something" moment
 * here being simply "some time has passed"), rather than a subscription.
 */

/**
 * The sentence a refusal wrote for the owner, when it has one. A 409 from the re-summarise verb
 * explains why the post cannot be queued (its body was swept, it never had one) — a case where
 * retrying genuinely cannot work, so the route's own words beat a generic apology. Any other
 * failure is a fault the owner can do nothing about and gets the store's line instead.
 */
function refusal(error: unknown): string | undefined {
  return error instanceof api.ApiError && error.status === 409 ? error.detail : undefined;
}

/**
 * How many archived posts the archive read asks for. The archive is unbounded — every post ever
 * skimmed — while the app's fetch-everything default assumes a bounded table, so this is a
 * deliberate ceiling rather than a page size: the view says so out loud when it hits it, and a
 * "load more" waits until the owner asks for one.
 */
export const ARCHIVE_READ_LIMIT = 200;

export interface ReaderState {
  posts: ReaderPostListItem[];
  /**
   * What the module's health surface is derived from — the tick's row and the mailbox's account.
   * Seeded by the shell and replaced wholesale; nothing merges into it, because half a snapshot
   * describes a state that never existed.
   */
  health: ReaderHealthSnapshot;
  /** Whether the archive's own read has landed — what the archive's empty state waits for. */
  archiveLoaded: boolean;
  /** Whether that read came back at its ceiling, so the archive says it is showing a slice. */
  archiveFull: boolean;
}

export interface ReaderActions {
  /**
   * Archive a post: optimistic `archived_at`, reconciled with the server row, rolled back (and
   * toasted) on failure. The only action here that can fail loudly — it removes the row from
   * the list the owner is looking at, so a failure has to be visible.
   */
  archive: (id: string) => Promise<ReaderPostListItem>;
  /**
   * Put an archived post back on the reading list: the same optimistic patch to `archived_at` as
   * {@link ReaderActions.archive}, in the other direction, rolled back and toasted on failure —
   * one row moving between two views of the same list, never a second copy of it.
   */
  unarchive: (id: string) => Promise<ReaderPostListItem>;
  /**
   * Read the archived scope once and fold it into the one post list. Idempotent: the archive is
   * browsed rather than watched, so a second visit re-renders what is already held instead of
   * re-reading it, and a read already in the air is never doubled. Silent on failure, like
   * `refresh()` — the next visit tries again.
   */
  loadArchive: () => void;
  /**
   * Stamp `opened_at` the instant "Open" is clicked. Fire-and-forget: the owner is already on
   * their way to the post, so a failed write neither rolls back the stamp nor toasts — the next
   * `refresh()` corrects the row if the server never saw it.
   */
  markOpened: (id: string) => void;
  /**
   * Put a post back on the tick's worklist, keeping the summary it already has: optimistic
   * `pending` with the attempts reset, reconciled with the server row, rolled back and toasted
   * on failure. A refusal the route wrote for the owner to read (a swept body, a post that never
   * had one) is toasted in the route's own words — retrying cannot work, so a generic "try
   * again" would be a lie.
   */
  resummarize: (id: string) => Promise<ReaderPostListItem>;
  /**
   * Re-read the health snapshot and replace it whole. Runs beside `refresh()` on the same
   * return-to-the-foreground signals: the surface is derived against a ticking clock, so a seed
   * frozen at first paint decays into a stall that has since ended — or hides one that started
   * while the tab was away. Silent on failure, like `refresh()`: this is recovery, not a user
   * action, and the stale reading it would have replaced beats a blanked one.
   */
  reconcileHealth: () => void;
  /**
   * Re-read the active list and replace it wholesale, EXCEPT for every write not completed
   * before the read was ISSUED — the read left the server before that write arrived, whether it
   * was still pending at that instant or had not even started, so its answer is stale for exactly
   * those rows and would put a just-archived post back on screen. Whether the write has since
   * answered is beside the point: what decides is which of the two left first. A failed read
   * changes nothing and says nothing — the stale list it would have replaced is still better than
   * a blanked one, and the next trigger tries again (mirrors Comms' `reconcileHealth`).
   */
  refresh: () => void;
}

type ReaderAction =
  | { type: 'posts'; action: SimpleAction<ReaderPostListItem> }
  /** `keep` names the ids whose LOCAL row wins: a row this tab wrote the read cannot know of. */
  | { type: 'replaceAll'; posts: ReaderPostListItem[]; keep: string[] }
  /** A freshly read snapshot, replacing the held one whole. */
  | { type: 'health'; snapshot: ReaderHealthSnapshot }
  /** The archive read's answer, folded into the one post list. */
  | { type: 'archiveRead'; posts: ReaderPostListItem[]; full: boolean };

/** Pure reducer. The single row list delegates to the shared flat-list reducer. */
export function readerReducer(state: ReaderState, action: ReaderAction): ReaderState {
  switch (action.type) {
    case 'posts': {
      return { ...state, posts: simpleReducer(state.posts, action.action, 'reader post') };
    }
    case 'health': {
      return { ...state, health: action.snapshot };
    }
    case 'replaceAll': {
      const keep = new Set(action.keep);
      const named = new Set(action.posts.map((post) => post.id));
      const local = new Map(state.posts.map((post) => [post.id, post] as const));
      // Every server row, with this tab's own copy winning wherever the read is too old to speak
      // for it.
      const answered = action.posts.map((post) =>
        keep.has(post.id) ? (local.get(post.id) ?? post) : post,
      );
      // The read covers ONE scope, so a row it does not name is not necessarily gone. Two kinds
      // survive: an archived row (the active read cannot see it, whether it came from the archive
      // read or was archived here a moment ago), and a row this tab wrote that the read left
      // before — an unarchive still in flight, say. Anything else missing from the read really is
      // gone, archived on another tab, and is dropped.
      const unanswered = state.posts.filter(
        (post) => !named.has(post.id) && (isArchived(post) || keep.has(post.id)),
      );
      return { ...state, posts: [...answered, ...unanswered] };
    }
    case 'archiveRead': {
      return {
        ...state,
        posts: simpleReducer(state.posts, { type: 'upsert', items: action.posts }, 'reader post'),
        archiveLoaded: true,
        archiveFull: action.full,
      };
    }
    default: {
      return assertNever(action, 'reader action');
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  ReaderState,
  ReaderActions
>('a ReaderProvider');

export function ReaderProvider({
  initialPosts,
  initialHealth,
  children,
}: {
  initialPosts: ReaderPostListItem[];
  initialHealth: ReaderHealthSnapshot;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(readerReducer, {
    posts: initialPosts,
    health: initialHealth,
    archiveLoaded: false,
    archiveFull: false,
  });

  // Latest state, readable inside the stable action closures so they can capture pre-mutation
  // values for rollback without going stale. Synced via an effect, like the other stores.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  /**
   * Re-read the active list and replace it wholesale. `refreshingRef` collapses concurrent
   * triggers (a focus and a visibilitychange landing together) into one request; a read while
   * the tab is hidden is skipped outright — there is no owner looking at the result.
   */
  const refreshingRef = React.useRef(false);
  /**
   * Ids with a write still in flight. A write that started BEFORE the in-progress read was issued
   * and has not answered yet is still unknown to the server's copy, so `replaceAll` keeps this
   * tab's own row for each one.
   */
  const mutatingRef = React.useRef(new Set<string>());
  /**
   * Ids of every write NOT COMPLETED before the in-progress read was ISSUED. Seeded at that
   * instant from `mutatingRef` (whatever was still pending right then) and then added to for
   * each write that starts while the read is in the air, so it is never pruned before the next
   * read goes out — a write that settles and reconciles while this read is still in flight stays
   * held back too, which `mutatingRef` alone would have forgotten by the time the read answers.
   */
  const mutatedSinceReadRef = React.useRef(new Set<string>());
  const refresh = React.useCallback(() => {
    if (refreshingRef.current || document.hidden) return;
    refreshingRef.current = true;
    // Seeded as the request is ISSUED, not cleared: a write already pending at this instant
    // (mutatingRef.current) is one this read left too early to know about, same as anything
    // written from here on.
    mutatedSinceReadRef.current = new Set(mutatingRef.current);
    void api
      .fetchReaderPosts({ scope: 'active' })
      .then((posts) => {
        dispatch({
          type: 'replaceAll',
          posts,
          keep: [...new Set([...mutatingRef.current, ...mutatedSinceReadRef.current])],
        });
      })
      .catch(() => {
        // Deliberately silent — see the doc comment above.
      })
      .finally(() => {
        refreshingRef.current = false;
      });
  }, []);

  /**
   * Re-read the health snapshot. Its own in-flight guard rather than `refreshingRef`'s, so a
   * slow list read cannot swallow the health read that should have gone out with it.
   */
  const reconcilingRef = React.useRef(false);
  const reconcileHealth = React.useCallback(() => {
    if (reconcilingRef.current || document.hidden) return;
    reconcilingRef.current = true;
    void api
      .fetchReaderHealth()
      .then((snapshot) => {
        // Replaced whole, never merged: the route refuses to answer with half a snapshot, so
        // what comes back describes one instant and merging would invent one that never was.
        dispatch({ type: 'health', snapshot });
      })
      .catch(() => {
        // Deliberately silent — see the doc comment above.
      })
      .finally(() => {
        reconcilingRef.current = false;
      });
  }, []);

  /**
   * The archive's own read, at most once per mount of the provider. One ref does both jobs: it
   * guards a second call while the first is in the air, and — once the read has landed — keeps
   * the archive from being re-read every time the segment is revisited. A failure releases it, so
   * the next visit can try again.
   */
  const archiveReadRef = React.useRef(false);
  const loadArchive = React.useCallback(() => {
    if (archiveReadRef.current) return;
    archiveReadRef.current = true;
    void api
      .fetchReaderPosts({ scope: 'archived', limit: ARCHIVE_READ_LIMIT })
      .then((posts) => {
        // Upserted into the ONE post list rather than kept beside it: a post archived in this
        // session and then named by this read is one row, so unarchiving it cannot leave a stale
        // second copy behind in the archive.
        dispatch({ type: 'archiveRead', posts, full: posts.length === ARCHIVE_READ_LIMIT });
      })
      .catch(() => {
        archiveReadRef.current = false;
      });
  }, []);

  // The tab returning to the foreground is the one signal this story wires — no realtime
  // channel exists yet to also catch a rejoin (see the module doc comment). Both surfaces are
  // re-read on it: the list and the health reading decay in the same gap, for the same reason.
  React.useEffect(() => {
    const onReturn = () => {
      if (document.hidden) return;
      refresh();
      reconcileHealth();
    };

    document.addEventListener('visibilitychange', onReturn);
    globalThis.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      globalThis.removeEventListener('focus', onReturn);
    };
  }, [refresh, reconcileHealth]);

  /**
   * Both directions of the archive verb, which differ only in which instant `archived_at` takes
   * and which sentence a failure says. Optimistic, reconciled with the server row, rolled back
   * and toasted if the write never lands — the row leaves the view the owner is looking at, so a
   * failure has to be visible in a way the fire-and-forget writes here don't need.
   */
  const setArchived = React.useCallback(
    async (id: string, archived: boolean): Promise<ReaderPostListItem> => {
      const current = stateRef.current.posts.find((post) => post.id === id);
      const patch: Partial<ReaderPostListItem> = {
        archived_at: archived ? new Date().toISOString() : null,
      };
      // Selective-field capture: only the key this write touches, so a rollback can't clobber
      // a field `refresh()` moved meanwhile.
      const captured = current === undefined ? {} : capturedFields(current, patch);
      mutatingRef.current.add(id);
      // Never removed here — only a NEWER read clears it, since that is the first read whose
      // answer can have this write in it.
      mutatedSinceReadRef.current.add(id);
      try {
        return await runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch } });
          },
          apiCall: () => api.patchReaderPost(id, { archived }),
          reconcile: (saved) => {
            dispatch({ type: 'posts', action: { type: 'replace', id, item: saved } });
          },
          rollback: () => {
            dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch: captured } });
          },
          onError: () => {
            showToastRef.current(
              archived ? "Couldn't archive that post" : "Couldn't unarchive that post",
            );
          },
        });
      } finally {
        mutatingRef.current.delete(id);
      }
    },
    [],
  );

  const actions = React.useMemo<ReaderActions>(
    () => ({
      archive(id) {
        return setArchived(id, true);
      },
      unarchive(id) {
        return setArchived(id, false);
      },
      loadArchive,
      async resummarize(id) {
        const current = stateRef.current.posts.find((post) => post.id === id);
        const patch: Partial<ReaderPostListItem> = {
          summary_state: 'pending',
          summarize_attempts: 0,
          last_error: null,
        };
        // Only the keys this write touches — the headline, gist and overview stay put, so the
        // row shows its previous summary under the pending marker instead of blanking.
        const captured = current === undefined ? {} : capturedFields(current, patch);
        mutatingRef.current.add(id);
        // Never removed here — only a NEWER read clears it, since that is the first read whose
        // answer can have this write in it. Without it a focus refetch already in the air would
        // hand back the row's old `done` state and undo the queueing.
        mutatedSinceReadRef.current.add(id);
        try {
          return await runOptimisticMutation({
            optimistic: () => {
              dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch } });
            },
            apiCall: () => api.patchReaderPost(id, { resummarize: true }),
            reconcile: (saved) => {
              dispatch({ type: 'posts', action: { type: 'replace', id, item: saved } });
            },
            rollback: () => {
              dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch: captured } });
            },
            onError: (error) => {
              showToastRef.current(refusal(error) ?? "Couldn't queue that summary");
            },
          });
        } finally {
          mutatingRef.current.delete(id);
        }
      },
      markOpened(id) {
        dispatch({
          type: 'posts',
          action: { type: 'patch', ids: [id], patch: { opened_at: new Date().toISOString() } },
        });
        void api.patchReaderPost(id, { opened: true }).then(
          (saved) => {
            // Only the column this write owns. The answer describes the row as it was when the
            // PATCH was served, so taking it whole would undo an archive sent a moment later.
            dispatch({
              type: 'posts',
              action: { type: 'patch', ids: [id], patch: { opened_at: saved.opened_at } },
            });
          },
          () => {
            // Deliberately silent — see the doc comment above.
          },
        );
      },
      refresh,
      reconcileHealth,
    }),
    [refresh, reconcileHealth, loadArchive, setArchived],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** The reading list: every unarchived post, newest arrival first. */
export function useReaderPosts(): ReaderPostListItem[] {
  const { posts } = useStateValue('useReaderPosts');
  return React.useMemo(() => byReceivedDescending(posts.filter(isActive)), [posts]);
}

/** The archive: every post the owner has put away, newest arrival first. */
export function useArchivedPosts(): ReaderPostListItem[] {
  const { posts } = useStateValue('useArchivedPosts');
  return React.useMemo(() => byReceivedDescending(posts.filter(isArchived)), [posts]);
}

/**
 * Where the archive's own read has got to: whether it has landed (so an empty archive is a fact
 * rather than a list that has not arrived yet) and whether it came back at its ceiling (so the
 * view can say it is showing a slice of a longer history).
 */
export function useArchiveStatus(): { loaded: boolean; full: boolean } {
  const { archiveLoaded, archiveFull } = useStateValue('useArchiveStatus');
  return React.useMemo(
    () => ({ loaded: archiveLoaded, full: archiveFull }),
    [archiveLoaded, archiveFull],
  );
}

/** How many posts are unarchived, whatever their summary state — the heading and nav badge. */
export function useActiveCount(): number {
  const { posts } = useStateValue('useActiveCount');
  return React.useMemo(() => posts.filter(isActive).length, [posts]);
}

/**
 * What the health surface reads: the tick's row (absent until it has ever run) and the Gmail
 * account the mail arrives on. Held rather than derived, because a surface that says "the
 * summariser is fine" has to be able to say when it last checked.
 */
export function useReaderHealth(): ReaderHealthSnapshot {
  return useStateValue('useReaderHealth').health;
}

/** The Reader mutation actions. Throws outside a ReaderProvider. */
export function useReaderActions(): ReaderActions {
  return useActions('useReaderActions');
}
