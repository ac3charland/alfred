'use client';

import * as React from 'react';

import * as api from '@/lib/api-client';
import type { ChangeTierInput, ClearMessageInput, PurgeInput } from '@/lib/api-client';
import {
  COMMS_POLL_MS,
  type QueueByTier,
  SHELF_LIMIT_MAX,
  SHELF_PAGE_SIZE,
  groupByTier,
  queueCount,
  shelved,
} from '@/lib/comms';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, capturedFields, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import type {
  CommAccount,
  CommClassifierHealth,
  CommMessage,
  CommVerdict,
  CommsSeed,
  Item,
} from '@/lib/types';

/**
 * Comms store — the optimistic client cache of the mirrored messages, the accounts that carry
 * them, and the classifier's own health.
 *
 * Two writers reach these tables and neither is this browser: the ingestion Worker writes
 * messages and account health, and the classifier sweep writes verdicts and tiers. Every source
 * is minutes-granular (the Gmail poll every 3 minutes, the classifier sweep every 2, the Mac
 * daemon roughly once a minute), so rather than a Realtime subscription this store POLLS the
 * snapshot on a timer — see {@link CommsProvider} and `lib/comms/live.ts`.
 */

export interface CommsState {
  accounts: CommAccount[];
  /**
   * Everything above FYI inside the retention window (the queue, and the rows not judged yet), in
   * full, plus the shelf pages loaded so far. The queue and the shelf derive from it.
   */
  messages: CommMessage[];
  /** The current verdict behind each judged message, keyed by verdict id. */
  verdictsById: Record<string, CommVerdict>;
  /** The classifier's singleton health row; absent until the sweep has ever run. */
  health: CommClassifierHealth | undefined;
  /** Every row on the shelf — `messages` holds only the pages loaded so far. */
  shelfCount: number;
  /** Shelf-eligible newsletters the Reader claimed; counted, never held. */
  readerClaimedCount: number;
  /** The newest verdict across the whole window, as of the last snapshot. */
  lastClassifiedAt: string | null;
  /** Whether any read has landed — `false` only while the shell's failed read has no successor. */
  loaded: boolean;
  /**
   * The client clock's own time when the last successful read STARTED — never the server's
   * `readAt`. `null` only while `loaded` is false. `lib/comms/live.ts`'s `isCommsLive` is what
   * turns this into "is the view live right now"; the store itself tracks no such flag.
   */
  lastReadAt: string | null;
}

export interface CommsActions {
  /**
   * Apply a message change in this tab only, with no server write — the seam for a change that
   * exists purely to move a row out of view ahead of the server confirming it.
   */
  patchMessageLocally: (id: string, patch: Partial<CommMessage>) => void;
  /**
   * The optimistic write every row verb shares, so each verb is a one-liner over it: patch the
   * row now, call the API, reconcile with the row the server returns — or restore the fields
   * that were captured, toast, and re-throw.
   *
   * The rollback is SELECTIVE (only the fields the patch names), so a stale failure can't
   * clobber an unrelated change that landed on the row meanwhile — the same strategy the code
   * store's field edits use.
   */
  writeMessage: (
    id: string,
    patch: Partial<CommMessage>,
    apiCall: () => Promise<CommMessage>,
    errorMessage: string,
  ) => Promise<CommMessage>;
  /**
   * The manual exit from the queue, in its two halves — which are two verbs precisely because
   * only one of them is a correction. `nothing_to_answer` says the row should never have been
   * queued and re-tiers it to the shelf as it clears; `not_replying` says the verdict was right
   * and the owner is declining, and teaches nothing.
   */
  clearMessage: (id: string, exit: ClearMessageInput['exit']) => Promise<CommMessage>;
  /**
   * Move a row between tiers. Always a correction — including the promotion out of `fyi`, which
   * is the only way back from a message the classifier wrongly shelved, and which re-opens the
   * row by clearing whatever exit it left by.
   */
  changeTier: (id: string, tier: ChangeTierInput['tier']) => Promise<CommMessage>;
  /**
   * Spin the obligation into an Inbox item, which clears the comms row at that moment — the
   * third exit. Returns both rows; the Inbox item is the durable tracker from here.
   */
  makeInboxItem: (id: string) => Promise<{ message: CommMessage; item: Item }>;
  /** Ask for one row to be judged again. Nothing is ever re-judged without being asked. */
  requestReclassify: (id: string) => Promise<CommMessage>;
  /**
   * The deliberate "I want this gone" — one message, one account, or everything before a date.
   * Destructive and irreversible, so it is NOT optimistic: the rows leave the client only once
   * the server says they left the database, and a re-read follows to pick up whatever an
   * account or date-range purge matched that this tab has no id list for.
   */
  purge: (input: PurgeInput) => Promise<{ purged: number }>;
  /** Load the next page of the shelf — the same re-read as recovery, asked for more rows. */
  showMoreShelf: () => void;
}

type CommsAction =
  | { type: 'messages'; action: SimpleAction<CommMessage> }
  /**
   * Replace the view with a server snapshot — except the rows in `keep`, which have a write in
   * flight: the snapshot may predate it, and the write reconciles them itself when it lands.
   */
  | { type: 'snapshot'; seed: CommsSeed; keep: ReadonlySet<string> }
  /** A read that started at `startedAt` landed successfully. */
  | { type: 'read'; startedAt: string };

/** The store's state for a seed, before any change arrives — nothing loaded if its read failed. */
export function stateFromSeed(seed: CommsSeed, failed = false): CommsState {
  return {
    accounts: seed.accounts,
    messages: seed.messages,
    verdictsById: Object.fromEntries(seed.verdicts.map((verdict) => [verdict.id, verdict])),
    health: seed.health,
    shelfCount: seed.shelfCount,
    readerClaimedCount: seed.readerClaimedCount,
    lastClassifiedAt: seed.lastClassifiedAt,
    loaded: !failed,
    // The client's own clock, not the server's `readAt` — the window this dates is measured
    // against the client's later reads, so it has to share their clock.
    lastReadAt: failed ? null : new Date().toISOString(),
  };
}

/** {@link CommsAction}'s snapshot move: the seed wins, but a row with a write in flight holds. */
function applySnapshot(state: CommsState, seed: CommsSeed, keep: ReadonlySet<string>): CommsState {
  // Loadedness and the read clock are this tab's own bookkeeping, not something a server read
  // carries — only the `read` action that follows a snapshot moves them.
  const next = { ...stateFromSeed(seed), loaded: state.loaded, lastReadAt: state.lastReadAt };
  const held = state.messages.filter((message) => keep.has(message.id));
  if (held.length === 0) return next;
  const heldIds = new Set(held.map((message) => message.id));
  const verdictsById = { ...next.verdictsById };
  for (const message of held) {
    const verdict =
      message.verdict_id === null ? undefined : state.verdictsById[message.verdict_id];
    if (verdict !== undefined) verdictsById[verdict.id] = verdict;
  }
  return {
    ...next,
    messages: [...next.messages.filter((message) => !heldIds.has(message.id)), ...held],
    verdictsById,
  };
}

/**
 * Pure reducer. The message list delegates to the shared flat-list reducer, so the race rule
 * (a patch for an id the store no longer holds is a no-op) holds here for free.
 */
export function commsReducer(state: CommsState, action: CommsAction): CommsState {
  switch (action.type) {
    case 'messages': {
      return { ...state, messages: simpleReducer(state.messages, action.action, 'comms message') };
    }
    case 'snapshot': {
      return applySnapshot(state, action.seed, action.keep);
    }
    case 'read': {
      return { ...state, loaded: true, lastReadAt: action.startedAt };
    }
    default: {
      return assertNever(action, 'comms action');
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  CommsState,
  CommsActions
>('a CommsProvider');

export function CommsProvider({
  initialSeed,
  initialFailed = false,
  children,
}: {
  initialSeed: CommsSeed;
  /** The shell's read failed, so the seed is empty and nothing has loaded until a read lands. */
  initialFailed?: boolean;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(commsReducer, initialSeed, (seed) =>
    stateFromSeed(seed, initialFailed),
  );

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
   * The view has to be a true reflection of the server however the tab got here (ALF-258): it
   * polls the whole view ({@link api.fetchCommsSnapshot}) and replaces what it holds, rather than
   * trusting a push it might have missed.
   *
   * Two things keep a re-read from being wrong itself:
   * - a change dispatched locally WHILE it is in flight is recorded and replayed over the
   *   snapshot, which may predate it (a written-but-not-yet-reconciled optimistic patch);
   * - a row with a write in flight keeps its optimistic value (see the `snapshot` action) — and
   *   a trigger that lands mid-read runs one more read after it, rather than being dropped.
   *
   * A hidden tab doesn't re-read — coming back to the front does. Whether the view is LIVE is
   * derived from `lastReadAt`'s age, not tracked here at all — see `lib/comms/live.ts`.
   */
  const recordingRef = React.useRef<CommsAction[] | null>(null);
  const apply = React.useCallback((action: CommsAction) => {
    dispatch(action);
    recordingRef.current?.push(action);
  }, []);

  const writesInFlightRef = React.useRef(new Map<string, number>());
  const shelfLimitRef = React.useRef(SHELF_PAGE_SIZE);
  const syncRef = React.useRef({ running: false, again: false });

  const reconcile = React.useCallback(() => {
    const sync = syncRef.current;
    if (document.hidden) return;
    if (sync.running) {
      sync.again = true;
      return;
    }
    sync.running = true;
    void (async () => {
      do {
        sync.again = false;
        recordingRef.current = [];
        const keep = new Set(writesInFlightRef.current.keys());
        // What the read can vouch for is decided as it starts, on this tab's clock.
        const startedAt = new Date().toISOString();
        try {
          const seed = await api.fetchCommsSnapshot(shelfLimitRef.current);
          for (const id of writesInFlightRef.current.keys()) keep.add(id);
          dispatch({ type: 'snapshot', seed, keep });
          for (const action of recordingRef.current) dispatch(action);
          dispatch({ type: 'read', startedAt });
        } catch {
          // Nothing to toast or record — there is nothing for the owner to do. The header's
          // "Not live" line is driven by `lastReadAt`'s own age, so a failed read simply lets
          // that age grow until the next poll or trigger tries again.
        }
        recordingRef.current = null;
        // Read through the ref: a trigger may have set it while the read was awaited.
      } while (syncRef.current.again && !document.hidden);
      sync.running = false;
    })();
  }, []);

  // A shell whose read failed doesn't wait for the next poll.
  React.useEffect(() => {
    if (initialFailed) reconcile();
  }, [initialFailed, reconcile]);

  // The poll, for the provider's whole lifetime. `reconcile` itself no-ops while the tab is
  // hidden, so this is inert in the background rather than needing to be paused and resumed.
  React.useEffect(() => {
    const id = setInterval(reconcile, COMMS_POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [reconcile]);

  // The ways a tab learns it may have missed something sooner than the next poll: coming back to
  // the front, being restored from the back/forward cache, and coming back online. A window that
  // merely lost focus stayed visible and missed nothing.
  React.useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) reconcile();
    };

    document.addEventListener('visibilitychange', reconcile);
    globalThis.addEventListener('pageshow', onPageShow);
    globalThis.addEventListener('online', reconcile);
    return () => {
      document.removeEventListener('visibilitychange', reconcile);
      globalThis.removeEventListener('pageshow', onPageShow);
      globalThis.removeEventListener('online', reconcile);
    };
  }, [reconcile]);

  const actions = React.useMemo<CommsActions>(() => {
    /**
     * The one optimistic write every row verb runs through, generic over what the endpoint
     * hands back: most return the message itself, but making an Inbox item returns the item
     * beside it, and both reconcile from the same server-canonical row.
     */
    async function writeAndReconcile<R>(
      id: string,
      patch: Partial<CommMessage>,
      apiCall: () => Promise<R>,
      toMessage: (result: R) => CommMessage,
      errorMessage: string,
    ): Promise<R> {
      const current = stateRef.current.messages.find((message) => message.id === id);
      // Selective-field capture: only the keys this write touches, so a rollback restores
      // exactly what it changed and can't clobber a change a re-read brought in on another field.
      const captured = current === undefined ? {} : capturedFields(current, patch);
      // Held while in flight, so a re-read landing meanwhile doesn't revert the optimistic row.
      const inFlight = writesInFlightRef.current;
      inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
      const release = () => {
        const left = (inFlight.get(id) ?? 1) - 1;
        if (left === 0) inFlight.delete(id);
        else inFlight.set(id, left);
      };
      try {
        const result = await runOptimisticMutation({
          optimistic: () => {
            apply({ type: 'messages', action: { type: 'patch', ids: [id], patch } });
          },
          apiCall,
          reconcile: (saved) => {
            const patchFromServer = toMessage(saved);
            apply({
              type: 'messages',
              action: { type: 'patch', ids: [id], patch: patchFromServer },
            });
          },
          rollback: () => {
            apply({ type: 'messages', action: { type: 'patch', ids: [id], patch: captured } });
          },
          onError: () => {
            showToastRef.current(errorMessage);
          },
        });
        release();
        return result;
      } catch (error) {
        release();
        // The rollback restores what the row was before the write, but a read that landed
        // meanwhile held the row back — so whatever the server changed on it is still missing.
        reconcile();
        throw error;
      }
    }

    /** The row leaves the queue the instant the verb is pressed; the clock is the server's. */
    const identity = (message: CommMessage): CommMessage => message;

    return {
      patchMessageLocally(id, patch) {
        apply({ type: 'messages', action: { type: 'patch', ids: [id], patch } });
      },
      async writeMessage(id, patch, apiCall, errorMessage) {
        return writeAndReconcile(id, patch, apiCall, identity, errorMessage);
      },
      async clearMessage(id, exit) {
        const patch: Partial<CommMessage> = {
          cleared_at: new Date().toISOString(),
          cleared_by: exit,
        };
        // "Nothing to answer" is also a re-judgment: the owner has just said this belongs on
        // the shelf, so the row shows the tier they chose rather than the one they rejected.
        if (exit === 'nothing_to_answer') {
          patch.tier = 'fyi';
          patch.judged_by = 'owner';
        }
        return writeAndReconcile(
          id,
          patch,
          () => api.clearCommMessage(id, exit),
          identity,
          "Couldn't clear that message",
        );
      },
      async changeTier(id, tier) {
        const patch: Partial<CommMessage> = { tier, judged_by: 'owner' };
        // A promotion out of the shelf is also a re-opening — otherwise the correction lands
        // and the row stays exactly as invisible as it was.
        if (tier !== 'fyi') {
          patch.cleared_at = null;
          patch.cleared_by = null;
        }
        return writeAndReconcile(
          id,
          patch,
          () => api.changeCommTier(id, tier),
          identity,
          "Couldn't change that tier",
        );
      },
      async makeInboxItem(id) {
        const result = await writeAndReconcile(
          id,
          { cleared_at: new Date().toISOString(), cleared_by: 'inbox_item' },
          () => api.makeInboxItemFromMessage(id),
          (saved) => saved.message,
          "Couldn't add that to the Inbox",
        );
        // Said out loud because the obligation moved MODULES: the row is gone from Comms and
        // the only thing still tracking it is an item the owner is not currently looking at.
        showToastRef.current('Added to Inbox');
        return result;
      },
      async requestReclassify(id) {
        return writeAndReconcile(
          id,
          { reclassify_requested_at: new Date().toISOString(), classify_attempts: 0 },
          () => api.requestReclassify(id),
          identity,
          "Couldn't ask for a re-run",
        );
      },
      async purge(input) {
        try {
          const result = await api.purgeComms(input);
          // A single-message purge is removed locally too, ahead of the reconcile below: the id
          // is right here, unlike an account-wide or date-range purge (which has no id list to
          // remove without a client re-implementation of the server's own predicate), and the
          // row was very likely the one the owner was just looking at.
          if (input.message_id !== undefined) {
            apply({
              type: 'messages',
              action: { type: 'remove', ids: [input.message_id] },
            });
          }
          // Every selector reconciles: this is what brings an account-wide or date-range purge
          // into view, and it costs the single-message case nothing since the removal above
          // already applied.
          reconcile();
          return result;
        } catch (error) {
          showToastRef.current("Couldn't purge those messages");
          throw error;
        }
      },
      showMoreShelf() {
        const { messages, shelfCount } = stateRef.current;
        if (shelved(messages).length >= shelfCount) return;
        // Never past the shelf's own last page, nor past what the snapshot route will serve.
        const lastPage = Math.ceil(shelfCount / SHELF_PAGE_SIZE) * SHELF_PAGE_SIZE;
        shelfLimitRef.current = Math.min(
          shelfLimitRef.current + SHELF_PAGE_SIZE,
          lastPage,
          SHELF_LIMIT_MAX,
        );
        reconcile();
      },
    };
  }, [apply, reconcile]);

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </ActionsContext.Provider>
  );
}

/** Every account, in the order they registered — the header's indicator row. */
export function useCommsAccounts(): CommAccount[] {
  return useStateValue('useCommsAccounts').accounts;
}

/** Every mirrored inbound message the client holds. Prefer a narrower selector where one fits. */
export function useCommsMessages(): CommMessage[] {
  return useStateValue('useCommsMessages').messages;
}

/** The response queue, split into its three counted tiers, each newest first. */
export function useQueuedByTier(): QueueByTier {
  const { messages } = useStateValue('useQueuedByTier');
  return React.useMemo(() => groupByTier(messages), [messages]);
}

/**
 * How many messages are waiting for an answer — the sidebar badge's number. Zero while nothing
 * has loaded yet, so the badge stays hidden rather than counting a shell's empty seed as "all
 * clear".
 */
export function useQueueCount(): number {
  const { messages, loaded } = useStateValue('useQueueCount');
  return React.useMemo(() => (loaded ? queueCount(messages) : 0), [loaded, messages]);
}

/**
 * The shelf rows held so far — the pages loaded, not the whole shelf (see {@link useShelfCounts}
 * for its size) — newest first. Deliberately uncounted.
 */
export function useShelf(): CommMessage[] {
  const { messages } = useStateValue('useShelf');
  return React.useMemo(() => shelved(messages), [messages]);
}

/** The shelf's size and the Reader's share of it — the server's counts, not the held rows. */
export function useShelfCounts(): { shelfCount: number; readerClaimedCount: number } {
  const { shelfCount, readerClaimedCount } = useStateValue('useShelfCounts');
  return React.useMemo(
    () => ({ shelfCount, readerClaimedCount }),
    [shelfCount, readerClaimedCount],
  );
}

/**
 * Whether anything has loaded, when the last successful read started, and the newest verdict the
 * server knows of. What the header (and `lib/comms/live.ts`'s `isCommsLive`) need to say whether
 * the page can be trusted right now — the view computes liveness itself, against its own clock.
 */
export function useCommsSync(): {
  loaded: boolean;
  lastReadAt: string | null;
  lastClassifiedAt: string | null;
} {
  const { loaded, lastReadAt, lastClassifiedAt } = useStateValue('useCommsSync');
  return React.useMemo(
    () => ({ loaded, lastReadAt, lastClassifiedAt }),
    [loaded, lastReadAt, lastClassifiedAt],
  );
}

/** The current verdict behind each judged message, keyed by verdict id. */
export function useCommsVerdicts(): Record<string, CommVerdict> {
  return useStateValue('useCommsVerdicts').verdictsById;
}

/** The classifier's health row, or `undefined` when the sweep has never run. */
export function useCommsHealth(): CommClassifierHealth | undefined {
  return useStateValue('useCommsHealth').health;
}

/** The Comms mutation actions. Throws outside a CommsProvider. */
export function useCommsActions(): CommsActions {
  return useActions('useCommsActions');
}
