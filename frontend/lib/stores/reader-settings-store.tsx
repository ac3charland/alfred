'use client';

import * as React from 'react';

import { ApiError, createReaderPublication, updateReaderPublication } from '@/lib/api-client';
import { copyToClipboard } from '@/lib/clipboard';
import { gmailFilterQuery } from '@/lib/reader/gmail-filter';
import { stableSorted } from '@/lib/sort';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import {
  type SimpleAction,
  capturedFields,
  keyedReducer,
  simpleReducer,
} from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ReaderCandidate, ReaderPublication, ReaderPublicationListItem } from '@/lib/types';

/**
 * Reader settings store — the roster the owner keeps, and the bulk senders that could join it.
 *
 * Kept apart from the reading-list store for the reason Comms keeps its two apart: posts move
 * every few minutes and are re-read whenever the tab comes back, while the roster changes only
 * when a human edits it. So this store is seeded once and written optimistically, with no
 * refetch loop of its own.
 *
 * The candidates list is keyed on `handle`, not on an id: it is read from an aggregate view that
 * groups the mirror by sender, so there is no row with a primary key behind it.
 */

export interface ReaderSettingsState {
  /** The roster, ordered by name, each row carrying its newest post's arrival. */
  publications: ReaderPublicationListItem[];
  /** Off-roster bulk senders, in the view's rank: volume, then recency. */
  candidates: ReaderCandidate[];
}

/** The roster's verbs. */
export interface ReaderSettingsActions {
  /** Pause or resume a publication. A paused one keeps its posts; it stops gaining new ones. */
  setEnabled: (id: string, enabled: boolean) => Promise<ReaderPublicationListItem>;
  /** Rename a publication — the display name only; the handle it matches on never changes. */
  rename: (id: string, name: string) => Promise<ReaderPublicationListItem>;
  /** Set or clear the owner's note on a publication. */
  setNotes: (id: string, notes: string | null) => Promise<ReaderPublicationListItem>;
  /**
   * Promote a candidate sender to the roster. Not optimistic once it is real: the server assigns
   * the publication's id, so the caller awaits the stored row rather than inventing one.
   */
  addCandidate: (handle: string) => Promise<ReaderPublicationListItem>;
  /** Put the Gmail filter query that matches the roster on the clipboard. */
  copyFilterQuery: () => Promise<void>;
}

type ReaderSettingsAction =
  | { type: 'publications'; action: SimpleAction<ReaderPublicationListItem> }
  /** Keyed on the candidate's handle — see the module comment. */
  | { type: 'candidates'; action: SimpleAction<ReaderCandidate> };

/**
 * Pure reducer. Both lists delegate to the shared flat-list reducer, so a patch naming a row the
 * store no longer holds is a no-op — the race rule, for free.
 */
export function readerSettingsReducer(
  state: ReaderSettingsState,
  action: ReaderSettingsAction,
): ReaderSettingsState {
  switch (action.type) {
    case 'publications': {
      return {
        ...state,
        publications: simpleReducer(state.publications, action.action, 'reader publication'),
      };
    }
    case 'candidates': {
      return {
        ...state,
        candidates: keyedReducer(
          state.candidates,
          action.action,
          'reader candidate',
          (candidate) => candidate.handle,
        ),
      };
    }
    default: {
      return assertNever(action, 'reader settings action');
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  ReaderSettingsState,
  ReaderSettingsActions
>('a ReaderSettingsProvider');

export function ReaderSettingsProvider({
  initialPublications,
  initialCandidates,
  children,
}: {
  /** Ordered by name — the seed read already orders them that way. */
  initialPublications: ReaderPublicationListItem[];
  /** In the view's rank — the seed read leaves the ordering to the view. */
  initialCandidates: ReaderCandidate[];
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(readerSettingsReducer, {
    publications: initialPublications,
    candidates: initialCandidates,
  });

  // Latest state, readable inside the stable action closures without going stale — the same
  // pattern the other optimistic stores use, and what a rollback captures from.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const { showToast } = useToastActions();
  const showToastRef = React.useRef(showToast);
  React.useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const actions = React.useMemo<ReaderSettingsActions>(() => {
    /**
     * The optimistic write every roster edit shares: patch the row now, call the API, reconcile
     * with the stored TABLE row the server returns — or restore the captured fields, toast,
     * re-throw. The server's row carries no `last_post_at` (it is the view's own derived column,
     * never written), so reconciling with it as a shallow PATCH — never a replace — is what
     * keeps that field from being overwritten with `undefined`.
     */
    const writePublication = async (
      id: string,
      patch: Partial<ReaderPublicationListItem>,
      apiCall: () => Promise<ReaderPublication>,
      errorMessage: string,
    ): Promise<ReaderPublicationListItem> => {
      const current = stateRef.current.publications.find((row) => row.id === id);
      if (current === undefined) {
        throw new Error(`No publication ${id} in the roster`);
      }
      const captured = capturedFields(current, patch);

      const saved = await runOptimisticMutation({
        optimistic: () => {
          dispatch({ type: 'publications', action: { type: 'patch', ids: [id], patch } });
        },
        apiCall,
        reconcile: (row) => {
          dispatch({ type: 'publications', action: { type: 'patch', ids: [id], patch: row } });
        },
        rollback: () => {
          dispatch({ type: 'publications', action: { type: 'patch', ids: [id], patch: captured } });
        },
        onError: () => {
          showToastRef.current(errorMessage);
        },
      });

      return { ...current, ...patch, ...saved };
    };

    return {
      setEnabled(id, enabled) {
        return writePublication(
          id,
          { enabled },
          () => updateReaderPublication(id, { enabled }),
          "Couldn't update that publication",
        );
      },
      rename(id, name) {
        return writePublication(
          id,
          { name },
          () => updateReaderPublication(id, { name }),
          "Couldn't save that publication",
        );
      },
      setNotes(id, notes) {
        return writePublication(
          id,
          { notes },
          () => updateReaderPublication(id, { notes }),
          "Couldn't save that publication",
        );
      },
      async addCandidate(handle) {
        const candidate = stateRef.current.candidates.find((row) => row.handle === handle);
        if (candidate === undefined) {
          throw new Error(`No candidate ${handle} to promote`);
        }

        // Deliberately NOT optimistic: the server assigns the publication's id on insert, so
        // there is nothing to render until the row that identity belongs to actually exists.
        let saved: ReaderPublication;
        try {
          // The display name the candidate row showed is sent along when the sender has ever
          // set one, so the card the promotion produces reads the same as the row it came from
          // — without it the route falls back to the handle's local part and "Ben's Bites"
          // would land on the roster as "hello".
          saved = await createReaderPublication({
            handle,
            ...(candidate.name === null ? {} : { name: candidate.name }),
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            showToastRef.current('That sender is already a publication');
            // The server just said this handle is already on the roster — the local candidates
            // list is stale (some other tab, or a prior request that actually landed, promoted
            // it), so drop it here too rather than leaving a row whose own Add will 409 forever.
            dispatch({ type: 'candidates', action: { type: 'remove', ids: [handle] } });
          } else {
            showToastRef.current("Couldn't add that publication");
          }
          throw error;
        }

        const publication: ReaderPublicationListItem = { ...saved, last_post_at: null };
        dispatch({ type: 'publications', action: { type: 'insert', item: publication } });
        dispatch({ type: 'candidates', action: { type: 'remove', ids: [handle] } });
        return publication;
      },
      async copyFilterQuery() {
        const query = gmailFilterQuery(stateRef.current.publications);
        // Nothing to copy — the button that reaches this is disabled in that state anyway.
        if (query === null) return;

        const copied = await copyToClipboard(query);
        showToastRef.current(
          copied ? 'Gmail filter query copied' : "Couldn't copy — clipboard unavailable",
        );
      },
    };
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
  }, []);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/**
 * The roster, ordered by name. Sorted here rather than trusted to the seed's order, because a
 * promotion appends and a rename moves a card — both of which would otherwise leave the list in
 * an order the server's next read disagrees with.
 */
export function useReaderPublications(): ReaderPublicationListItem[] {
  const { publications } = useStateValue('useReaderPublications');
  return React.useMemo(
    () => stableSorted(publications, (a, b) => a.name.localeCompare(b.name)),
    [publications],
  );
}

/** Off-roster bulk senders, in the view's rank. Throws outside a ReaderSettingsProvider. */
export function useReaderCandidates(): ReaderCandidate[] {
  return useStateValue('useReaderCandidates').candidates;
}

/** The roster's mutation actions. Throws outside a ReaderSettingsProvider. */
export function useReaderSettingsActions(): ReaderSettingsActions {
  return useActions('useReaderSettingsActions');
}
