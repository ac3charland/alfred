'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import { byReceivedDescending, isActive } from '@/lib/reader/list';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, capturedFields, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ReaderPostListItem } from '@/lib/types';

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

export interface ReaderState {
  posts: ReaderPostListItem[];
}

export interface ReaderActions {
  /**
   * Archive a post: optimistic `archived_at`, reconciled with the server row, rolled back (and
   * toasted) on failure. The only action here that can fail loudly — it removes the row from
   * the list the owner is looking at, so a failure has to be visible.
   */
  archive: (id: string) => Promise<ReaderPostListItem>;
  /**
   * Stamp `opened_at` the instant "Open" is clicked. Fire-and-forget: the owner is already on
   * their way to the post, so a failed write neither rolls back the stamp nor toasts — the next
   * `refresh()` corrects the row if the server never saw it.
   */
  markOpened: (id: string) => void;
  /**
   * Re-read the active list and replace it wholesale. A failed read changes nothing and says
   * nothing — the stale list it would have replaced is still better than a blanked one, and the
   * next trigger tries again (mirrors Comms' `reconcileHealth`).
   */
  refresh: () => void;
}

type ReaderAction =
  | { type: 'posts'; action: SimpleAction<ReaderPostListItem> }
  | { type: 'replaceAll'; posts: ReaderPostListItem[] };

/** Pure reducer. The single row list delegates to the shared flat-list reducer. */
export function readerReducer(state: ReaderState, action: ReaderAction): ReaderState {
  switch (action.type) {
    case 'posts': {
      return { posts: simpleReducer(state.posts, action.action, 'reader post') };
    }
    case 'replaceAll': {
      return { posts: action.posts };
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
  children,
}: {
  initialPosts: ReaderPostListItem[];
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(readerReducer, { posts: initialPosts });

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
  const refresh = React.useCallback(() => {
    if (refreshingRef.current || document.hidden) return;
    refreshingRef.current = true;
    void api
      .fetchReaderPosts({ scope: 'active' })
      .then((posts) => {
        dispatch({ type: 'replaceAll', posts });
      })
      .catch(() => {
        // Deliberately silent — see the doc comment above.
      })
      .finally(() => {
        refreshingRef.current = false;
      });
  }, []);

  // The tab returning to the foreground is the one signal this story wires — no realtime
  // channel exists yet to also catch a rejoin (see the module doc comment).
  React.useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) refresh();
    };

    document.addEventListener('visibilitychange', onReturn);
    globalThis.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      globalThis.removeEventListener('focus', onReturn);
    };
  }, [refresh]);

  const actions = React.useMemo<ReaderActions>(
    () => ({
      async archive(id) {
        const current = stateRef.current.posts.find((post) => post.id === id);
        const patch: Partial<ReaderPostListItem> = { archived_at: new Date().toISOString() };
        // Selective-field capture: only the key this write touches, so a rollback can't clobber
        // a field `refresh()` moved meanwhile.
        const captured = current === undefined ? {} : capturedFields(current, patch);
        return runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch } });
          },
          apiCall: () => api.patchReaderPost(id, { archived: true }),
          reconcile: (saved) => {
            dispatch({ type: 'posts', action: { type: 'replace', id, item: saved } });
          },
          rollback: () => {
            dispatch({ type: 'posts', action: { type: 'patch', ids: [id], patch: captured } });
          },
          onError: () => {
            showToastRef.current("Couldn't archive that post");
          },
        });
      },
      markOpened(id) {
        dispatch({
          type: 'posts',
          action: { type: 'patch', ids: [id], patch: { opened_at: new Date().toISOString() } },
        });
        void api.patchReaderPost(id, { opened: true }).then(
          (saved) => {
            dispatch({ type: 'posts', action: { type: 'replace', id, item: saved } });
          },
          () => {
            // Deliberately silent — see the doc comment above.
          },
        );
      },
      refresh,
    }),
    [refresh],
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

/** How many posts are unarchived, whatever their summary state — the heading and nav badge. */
export function useActiveCount(): number {
  const { posts } = useStateValue('useActiveCount');
  return React.useMemo(() => posts.filter(isActive).length, [posts]);
}

/** The Reader mutation actions. Throws outside a ReaderProvider. */
export function useReaderActions(): ReaderActions {
  return useActions('useReaderActions');
}
