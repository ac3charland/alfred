'use client';

import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { ChangeTierInput, ClearMessageInput, PurgeInput } from '@/lib/api-client';
import { type QueueByTier, groupByTier, queueCount, shelved } from '@/lib/comms';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, capturedFields, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import { createClient } from '@/lib/supabase/client';
import type {
  CommAccount,
  CommClassifierHealth,
  CommMessage,
  CommVerdict,
  Item,
} from '@/lib/types';

/**
 * Comms store — the optimistic client cache of the mirrored messages, the accounts that carry
 * them, and the classifier's own health.
 *
 * Two writers reach these tables and neither is this browser: the ingestion Worker writes
 * messages and account health, and the classifier sweep writes verdicts and tiers. So unlike
 * the seed-once stores this one carries a Realtime subscription — a message arriving, a verdict
 * landing and a dot changing colour all have to show up without a reload.
 */

export interface CommsState {
  accounts: CommAccount[];
  /** Every inbound message inside the retention window; the queue and shelf derive from it. */
  messages: CommMessage[];
  /** The current verdict behind each judged message, keyed by verdict id. */
  verdictsById: Record<string, CommVerdict>;
  /** The classifier's singleton health row; absent until the sweep has ever run. */
  health: CommClassifierHealth | undefined;
}

export interface CommsActions {
  /**
   * Apply a message change in this tab only, with no server write — the seam for a change the
   * server has already made (a realtime payload the caller has its own rule for) or one that
   * exists purely to move a row out of view.
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
   * the server says they left the database.
   */
  purge: (input: PurgeInput) => Promise<{ purged: number }>;
}

/**
 * The verdict-store move an incoming `comm_verdicts` change makes: `upsert` adds/replaces
 * entries by verdict id, `remove` evicts them.
 */
type VerdictStreamAction =
  | { type: 'upsert'; verdicts: CommVerdict[] }
  | { type: 'remove'; ids: string[] };

type CommsAction =
  | { type: 'messages'; action: SimpleAction<CommMessage> }
  | { type: 'accounts'; action: SimpleAction<CommAccount> }
  | { type: 'verdicts'; action: VerdictStreamAction }
  | { type: 'health'; health: CommClassifierHealth | undefined };

/**
 * Pure reducer. The two row lists delegate to the shared flat-list reducer, so the race rule
 * (a patch for an id the store no longer holds is a no-op) holds here for free.
 */
export function commsReducer(state: CommsState, action: CommsAction): CommsState {
  switch (action.type) {
    case 'messages': {
      return { ...state, messages: simpleReducer(state.messages, action.action, 'comms message') };
    }
    case 'accounts': {
      return { ...state, accounts: simpleReducer(state.accounts, action.action, 'comms account') };
    }
    case 'verdicts': {
      if (action.action.type === 'upsert') {
        const verdictsById = { ...state.verdictsById };
        for (const verdict of action.action.verdicts) verdictsById[verdict.id] = verdict;
        return { ...state, verdictsById };
      }
      // Object.fromEntries + filter, not `delete`, so this stays clear of
      // @typescript-eslint/no-dynamic-delete.
      const removed = new Set(action.action.ids);
      const verdictsById = Object.fromEntries(
        Object.entries(state.verdictsById).filter(([id]) => !removed.has(id)),
      );
      return { ...state, verdictsById };
    }
    case 'health': {
      return { ...state, health: action.health };
    }
    default: {
      return assertNever(action, 'comms action');
    }
  }
}

/**
 * Which store move an incoming `comm_messages` change is — `null` to ignore it.
 *
 * The stream carries every write to the table, so the "may this payload touch the store?" rule
 * lives here as a pure function rather than in branches inside the subscription callback. An
 * INSERT upserts (an echo of a row already held re-applies identical values, so it is
 * idempotent); an UPDATE patches, which the flat-list reducer skips for an id it no longer
 * holds; a DELETE removes. Outbound rows are dropped on arrival — they are mirrored only as
 * the reply-detection signal and are never rendered.
 */
export function messageStreamAction(
  payload: RealtimePostgresChangesPayload<CommMessage>,
): SimpleAction<CommMessage> | null {
  switch (payload.eventType) {
    case 'INSERT': {
      return payload.new.direction === 'inbound' ? { type: 'upsert', items: [payload.new] } : null;
    }
    case 'UPDATE': {
      return { type: 'patch', ids: [payload.new.id], patch: payload.new };
    }
    case 'DELETE': {
      const { id } = payload.old;
      // A DELETE payload carries only the replica identity — without the id there is no row to
      // remove, and removing nothing is safer than guessing.
      return id === undefined ? null : { type: 'remove', ids: [id] };
    }
  }
}

/** The account analogue of {@link messageStreamAction} — accounts self-register, so INSERT counts. */
export function accountStreamAction(
  payload: RealtimePostgresChangesPayload<CommAccount>,
): SimpleAction<CommAccount> | null {
  switch (payload.eventType) {
    case 'INSERT': {
      return { type: 'upsert', items: [payload.new] };
    }
    case 'UPDATE': {
      return { type: 'patch', ids: [payload.new.id], patch: payload.new };
    }
    case 'DELETE': {
      const { id } = payload.old;
      return id === undefined ? null : { type: 'remove', ids: [id] };
    }
  }
}

/**
 * The classifier-health row after an incoming change: the new row, or `undefined` once it is
 * deleted. A singleton, so there is no id to match — the latest payload simply wins.
 */
export function healthStreamValue(
  payload: RealtimePostgresChangesPayload<CommClassifierHealth>,
): CommClassifierHealth | undefined {
  return payload.eventType === 'DELETE' ? undefined : payload.new;
}

/**
 * The verdict-store move an incoming `comm_verdicts` change makes — `null` to ignore it.
 *
 * `comm_verdicts` is append-only from the classifier's side (a re-classification writes a new
 * row rather than revising an old one, per the 0034 migration), so an UPDATE never lands and is
 * ignored. But the table is NOT append-only end to end: `comm_verdicts.message_id references
 * comm_messages (id) on delete cascade` (0034_comms.sql), and both the 60-day retention sweep
 * and a manual purge delete `comm_messages` rows — each cascading a DELETE onto every verdict
 * that judged them. Miss that and `verdictsById` leaks forever: an entry pointing at a message
 * that no longer exists. Mirrors {@link messageStreamAction}: a DELETE payload carries only the
 * replica identity, so a payload with no id removes nothing rather than guessing.
 */
export function verdictStreamAction(
  payload: RealtimePostgresChangesPayload<CommVerdict>,
): VerdictStreamAction | null {
  switch (payload.eventType) {
    case 'INSERT': {
      return { type: 'upsert', verdicts: [payload.new] };
    }
    case 'UPDATE': {
      return null;
    }
    case 'DELETE': {
      const { id } = payload.old;
      return id === undefined ? null : { type: 'remove', ids: [id] };
    }
  }
}

const { StateContext, ActionsContext, useStateValue, useActions } = createContextPair<
  CommsState,
  CommsActions
>('a CommsProvider');

export function CommsProvider({
  initialAccounts,
  initialMessages,
  initialVerdicts,
  initialHealth,
  children,
}: {
  initialAccounts: CommAccount[];
  initialMessages: CommMessage[];
  initialVerdicts: CommVerdict[];
  initialHealth?: CommClassifierHealth | undefined;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(commsReducer, {
    accounts: initialAccounts,
    messages: initialMessages,
    verdictsById: Object.fromEntries(initialVerdicts.map((verdict) => [verdict.id, verdict])),
    health: initialHealth,
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

  // The push channel. All four tables are written out of band — the poller inserts messages
  // and stamps account health, the classifier sweep writes a verdict and (via a separate write
  // to comm_messages) fills in the message's tier — so a browser that only ever read its seed
  // would show a stale queue, a green dot over a dead account, and no "Why:" explanation until
  // a hard reload.
  React.useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel('comm_messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_messages' },
        (payload: RealtimePostgresChangesPayload<CommMessage>) => {
          const action = messageStreamAction(payload);
          if (action !== null) dispatch({ type: 'messages', action });
        },
      )
      .subscribe();

    const accountsChannel = supabase
      .channel('comm_accounts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_accounts' },
        (payload: RealtimePostgresChangesPayload<CommAccount>) => {
          const action = accountStreamAction(payload);
          if (action !== null) dispatch({ type: 'accounts', action });
        },
      )
      .subscribe();

    const healthChannel = supabase
      .channel('comm_classifier_health')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_classifier_health' },
        (payload: RealtimePostgresChangesPayload<CommClassifierHealth>) => {
          dispatch({ type: 'health', health: healthStreamValue(payload) });
        },
      )
      .subscribe();

    const verdictsChannel = supabase
      .channel('comm_verdicts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_verdicts' },
        (payload: RealtimePostgresChangesPayload<CommVerdict>) => {
          const action = verdictStreamAction(payload);
          if (action !== null) dispatch({ type: 'verdicts', action });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      void supabase.removeChannel(accountsChannel);
      void supabase.removeChannel(healthChannel);
      void supabase.removeChannel(verdictsChannel);
    };
  }, []);

  const actions = React.useMemo<CommsActions>(
    () => {
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
        // exactly what it changed and can't clobber a realtime change to another field.
        const captured = current === undefined ? {} : capturedFields(current, patch);
        return runOptimisticMutation({
          optimistic: () => {
            dispatch({ type: 'messages', action: { type: 'patch', ids: [id], patch } });
          },
          apiCall,
          reconcile: (saved) => {
            const patchFromServer = toMessage(saved);
            dispatch({
              type: 'messages',
              action: { type: 'patch', ids: [id], patch: patchFromServer },
            });
          },
          rollback: () => {
            dispatch({ type: 'messages', action: { type: 'patch', ids: [id], patch: captured } });
          },
          onError: () => {
            showToastRef.current(errorMessage);
          },
        });
      }

      /** The row leaves the queue the instant the verb is pressed; the clock is the server's. */
      const identity = (message: CommMessage): CommMessage => message;

      return {
        patchMessageLocally(id, patch) {
          dispatch({ type: 'messages', action: { type: 'patch', ids: [id], patch } });
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
            // Only a single-message purge can be reflected locally: an account-wide or
            // date-range purge has no id list to remove, and guessing which rows the RPC
            // matched would be a client re-implementation of the server's own predicate.
            if (input.message_id !== undefined) {
              dispatch({
                type: 'messages',
                action: { type: 'remove', ids: [input.message_id] },
              });
            }
            return result;
          } catch (error) {
            showToastRef.current("Couldn't purge those messages");
            throw error;
          }
        },
      };
    },
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — a non-empty literal dep array holds a constant string that is Object.is-equal every render, so React never recomputes this memo; identical to [].
    [],
  );

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
  const state = useStateValue('useQueuedByTier');
  return React.useMemo(() => groupByTier(state.messages), [state]);
}

/** How many messages are waiting for an answer — the sidebar badge's number. */
export function useQueueCount(): number {
  const state = useStateValue('useQueueCount');
  return React.useMemo(() => queueCount(state.messages), [state]);
}

/** The FYI shelf: everything judged that owes no reply, newest first. Deliberately uncounted. */
export function useShelf(): CommMessage[] {
  const state = useStateValue('useShelf');
  return React.useMemo(() => shelved(state.messages), [state]);
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
