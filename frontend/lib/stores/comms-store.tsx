'use client';

import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import * as React from 'react';

import * as api from '@/lib/api-client';
import type { ChangeTierInput, ClearMessageInput, PurgeInput } from '@/lib/api-client';
import { type QueueByTier, SHELF_PAGE_SIZE, groupByTier, queueCount, shelved } from '@/lib/comms';
import { assertNever } from '@/lib/stores/assert-never';
import { createContextPair } from '@/lib/stores/create-context-pair';
import { runOptimisticMutation } from '@/lib/stores/optimistic-mutation';
import { type SimpleAction, capturedFields, simpleReducer } from '@/lib/stores/reducer-actions';
import { useToastActions } from '@/lib/stores/toast-store';
import { createClient } from '@/lib/supabase/client';
import { joinWhenAuthenticated } from '@/lib/supabase/realtime';
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
  /** Every row on the shelf — `messages` holds only the pages loaded so far. */
  shelfCount: number;
  /** Shelf-eligible newsletters the Reader claimed; counted, never held. */
  readerClaimedCount: number;
  /** The newest verdict across the whole window, as of the last snapshot. */
  lastClassifiedAt: string | null;
  /** When the last snapshot was read. */
  readAt: string;
  /**
   * Whether this view is a live reflection of the server: every channel joined, the last re-read
   * succeeded, and the browser online. When it is not, the header says so.
   */
  live: boolean;
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
  /** Load the next page of the shelf — the same re-read as recovery, asked for more rows. */
  showMoreShelf: () => void;
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
  | { type: 'health'; health: CommClassifierHealth | undefined }
  /**
   * Replace the view with a server snapshot — except the rows in `keep`, which have a write in
   * flight: the snapshot may predate it, and the write reconciles them itself when it lands.
   */
  | { type: 'snapshot'; seed: CommsSeed; keep: ReadonlySet<string> }
  | { type: 'live'; live: boolean };

/** The store's state for a seed, before any change arrives. */
export function stateFromSeed(seed: CommsSeed): CommsState {
  return {
    accounts: seed.accounts,
    messages: seed.messages,
    verdictsById: Object.fromEntries(seed.verdicts.map((verdict) => [verdict.id, verdict])),
    health: seed.health,
    shelfCount: seed.shelfCount,
    readerClaimedCount: seed.readerClaimedCount,
    lastClassifiedAt: seed.lastClassifiedAt,
    readAt: seed.readAt,
    live: true,
  };
}

/** {@link CommsAction}'s snapshot move: the seed wins, but a row with a write in flight holds. */
function applySnapshot(state: CommsState, seed: CommsSeed, keep: ReadonlySet<string>): CommsState {
  const next = stateFromSeed(seed);
  const held = state.messages.filter((message) => keep.has(message.id));
  if (held.length === 0) return { ...next, live: state.live };
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
    live: state.live,
  };
}

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
    case 'snapshot': {
      return applySnapshot(state, action.seed, action.keep);
    }
    case 'live': {
      return state.live === action.live ? state : { ...state, live: action.live };
    }
    default: {
      return assertNever(action, 'comms action');
    }
  }
}

/**
 * Every column an UPDATE actually writes to `comm_messages` — the whole of what
 * {@link messageStreamAction} may patch onto a row from a live UPDATE. Checked against every
 * writer: the owner's three row-verb routes (tier / clear / reclassify), the
 * `comm_create_inbox_item` RPC, and the ingestion Worker's newsletter filter and classifier
 * sweep (`gmail.ts`/`ingest.ts`'s `shelveNewsletters`, `sweep.ts`'s `file`/`countAttempt`/
 * `writeVerdict`, `sweep-store.ts`'s `clearReclassifyRequest`), and the Reader intake's claim
 * stamp (`workers/src/reader/`, `reader_claimed_at`). None of them ever touches `body`,
 * `subject`, `participants`, or any other ingest-only column — see {@link messageUpdatePatch}.
 */
type MessageUpdateColumns = Pick<
  CommMessage,
  | 'tier'
  | 'judged_by'
  | 'ask'
  | 'verdict_id'
  | 'classified_at'
  | 'cleared_at'
  | 'cleared_by'
  | 'inbox_item_id'
  | 'filtered_reason'
  | 'classify_attempts'
  | 'reclassify_requested_at'
  | 'reader_claimed_at'
>;

/**
 * Narrow a `comm_messages` UPDATE's new row to the columns an UPDATE can actually touch.
 *
 * `comm_messages` carries no `REPLICA IDENTITY FULL`, and `body` — a full email body — is a
 * TOASTed column every write here leaves untouched. Postgres logical replication does not
 * reliably carry an unchanged TOASTed column's true value in an UPDATE's new row, so Realtime's
 * decoder can (and does) substitute `null` for it — while the column's TypeScript type still
 * claims `string`. Spreading the whole payload would carry that lie straight onto the stored
 * row, and the next render would crash: `message-detail.tsx` and `markers.ts` both call
 * `message.body.trim()` unconditionally. Whitelisting the columns an UPDATE can actually write
 * (verified against every writer above) sidesteps the trap entirely rather than special-casing
 * `body` — the same pattern `classifierVerdictPatch` (`lib/tasks/classification.ts`) uses for
 * the `items` stream.
 *
 * TRADEOFF: a column a future writer adds to one of those UPDATEs won't stream into an open tab
 * until this list is updated too — a silently-stale field rather than a crash. That is the
 * right default for this store: every column above is metadata the row already shows optimistically
 * to the tab that wrote it, so a missed addition here degrades to "reload to see it," while the
 * status quo (spread the whole row) is a null crash on `body` on effectively every UPDATE this
 * module issues. The alternative — `REPLICA IDENTITY FULL` on `comm_messages` — would let the
 * store go back to spreading the row safely (the decoder would carry `body`'s real value), but
 * that is a migration and this module does not own the schema; flagging it here for whoever
 * does, not applying it.
 */
function messageUpdatePatch(row: CommMessage): MessageUpdateColumns {
  return {
    tier: row.tier,
    judged_by: row.judged_by,
    ask: row.ask,
    verdict_id: row.verdict_id,
    classified_at: row.classified_at,
    cleared_at: row.cleared_at,
    cleared_by: row.cleared_by,
    inbox_item_id: row.inbox_item_id,
    filtered_reason: row.filtered_reason,
    classify_attempts: row.classify_attempts,
    reclassify_requested_at: row.reclassify_requested_at,
    // The Reader's claim, so a newsletter leaves the shelf in an open tab the moment the Worker
    // stamps it — the shelf count beneath it would otherwise be wrong for the life of the tab.
    reader_claimed_at: row.reader_claimed_at,
  };
}

/**
 * Every column an UPDATE actually writes to `comm_accounts` — the account analogue of
 * {@link MessageUpdateColumns}. Checked against every writer in `workers/src/comms/store.ts`:
 * `upsertAccount` (self-registration, which merges via `on_conflict: 'key'` and so counts as an
 * UPDATE on every re-register — `key`/`kind`/`label`/`home`, plus `owner_handles` and
 * `expected_interval_seconds` when the caller sends them) and `patchAccount`'s two callers,
 * `recordPollSuccess` (`last_seen_at`, and `cursor` when the poll produced one) and
 * `recordPollError` (`last_error`/`last_error_at`). None of them ever touches `enabled` or
 * `created_at` — see {@link accountUpdatePatch}.
 *
 * `comm_accounts` carries no column large enough to be TOASTed today, so unlike
 * {@link messageUpdatePatch} this whitelist isn't fixing a currently-exploitable bug. It exists
 * so the two sibling stream handlers derive from the SAME rule instead of disagreeing with each
 * other in this file — which is exactly how the `comm_messages` gap went unnoticed for as long as
 * it did. The same TRADEOFF applies: a column a future writer adds to `comm_accounts` (an
 * `enabled` toggle, say) won't stream into an open tab until this list is updated too.
 */
type AccountUpdateColumns = Pick<
  CommAccount,
  | 'key'
  | 'kind'
  | 'label'
  | 'home'
  | 'owner_handles'
  | 'expected_interval_seconds'
  | 'cursor'
  | 'last_seen_at'
  | 'last_error'
  | 'last_error_at'
>;

/** Narrow a `comm_accounts` UPDATE's new row to the columns an UPDATE can actually touch. */
function accountUpdatePatch(row: CommAccount): AccountUpdateColumns {
  return {
    key: row.key,
    kind: row.kind,
    label: row.label,
    home: row.home,
    owner_handles: row.owner_handles,
    expected_interval_seconds: row.expected_interval_seconds,
    cursor: row.cursor,
    last_seen_at: row.last_seen_at,
    last_error: row.last_error,
    last_error_at: row.last_error_at,
  };
}

/**
 * Which store move an incoming `comm_messages` change is — `null` to ignore it.
 *
 * The stream carries every write to the table, so the "may this payload touch the store?" rule
 * lives here as a pure function rather than in branches inside the subscription callback. An
 * INSERT upserts (an echo of a row already held re-applies identical values, so it is
 * idempotent); an UPDATE patches ONLY the columns an UPDATE can touch (see
 * {@link messageUpdatePatch}), which the flat-list reducer skips for an id it no longer holds; a
 * DELETE removes. Outbound rows are dropped on arrival — they are mirrored only as the
 * reply-detection signal and are never rendered.
 */
export function messageStreamAction(
  payload: RealtimePostgresChangesPayload<CommMessage>,
): SimpleAction<CommMessage> | null {
  switch (payload.eventType) {
    case 'INSERT': {
      return payload.new.direction === 'inbound' ? { type: 'upsert', items: [payload.new] } : null;
    }
    case 'UPDATE': {
      return { type: 'patch', ids: [payload.new.id], patch: messageUpdatePatch(payload.new) };
    }
    case 'DELETE': {
      const { id } = payload.old;
      // A DELETE payload carries only the replica identity — without the id there is no row to
      // remove, and removing nothing is safer than guessing.
      return id === undefined ? null : { type: 'remove', ids: [id] };
    }
  }
}

/**
 * The account analogue of {@link messageStreamAction} — accounts self-register, so INSERT
 * counts. An UPDATE patches only the columns an UPDATE can touch (see {@link accountUpdatePatch}),
 * mirroring {@link messageStreamAction}'s own UPDATE case.
 */
export function accountStreamAction(
  payload: RealtimePostgresChangesPayload<CommAccount>,
): SimpleAction<CommAccount> | null {
  switch (payload.eventType) {
    case 'INSERT': {
      return { type: 'upsert', items: [payload.new] };
    }
    case 'UPDATE': {
      return { type: 'patch', ids: [payload.new.id], patch: accountUpdatePatch(payload.new) };
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

/** How long a burst of message changes settles before the counts are re-read. */
const COUNTS_SETTLE_MS = 1000;

/** The four tables the view streams, each on its own channel. */
const CHANNELS = ['comm_messages', 'comm_accounts', 'comm_classifier_health', 'comm_verdicts'];

export function CommsProvider({
  initialSeed,
  children,
}: {
  initialSeed: CommsSeed;
  children: React.ReactNode;
}) {
  const [state, dispatch] = React.useReducer(commsReducer, initialSeed, stateFromSeed);

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
   * The view has to be a true reflection of the server however the tab got here (ALF-258), and
   * Realtime alone can't promise that: it is fire-and-forget, so a socket that lapses — a
   * backgrounded tab, a machine asleep, a phone that suspended the app — drops every change made
   * in the gap and replays none of them, and so does the gap between the shell's server read and
   * the channels joining. So whenever the tab may have missed something it re-reads the whole
   * view ({@link api.fetchCommsSnapshot}) and replaces what it holds.
   *
   * Three things keep a re-read from being wrong itself:
   * - a change that streams in WHILE it is in flight is recorded and replayed over the snapshot,
   *   which may predate it;
   * - a row with a write in flight keeps its optimistic value (see the `snapshot` action);
   * - a trigger that lands mid-read runs one more read after it, rather than being dropped.
   *
   * A hidden tab doesn't re-read — coming back to the front does.
   */
  const recordingRef = React.useRef<CommsAction[] | null>(null);
  const apply = React.useCallback((action: CommsAction) => {
    dispatch(action);
    recordingRef.current?.push(action);
  }, []);

  const writesInFlightRef = React.useRef(new Map<string, number>());
  const shelfLimitRef = React.useRef(SHELF_PAGE_SIZE);
  const syncRef = React.useRef({ running: false, again: false, failed: false });
  const channelStatusRef = React.useRef<Partial<Record<string, REALTIME_SUBSCRIBE_STATES>>>({});

  /** Live = every channel joined (or still joining for the first time), last read ok, online. */
  const updateLive = React.useCallback(() => {
    const joined = CHANNELS.every((table) => {
      const status = channelStatusRef.current[table];
      return status === undefined || status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED;
    });
    dispatch({ type: 'live', live: joined && !syncRef.current.failed && navigator.onLine });
  }, []);

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
        try {
          const seed = await api.fetchCommsSnapshot(shelfLimitRef.current);
          for (const id of writesInFlightRef.current.keys()) keep.add(id);
          dispatch({ type: 'snapshot', seed, keep });
          for (const action of recordingRef.current) dispatch(action);
          sync.failed = false;
        } catch {
          // Nothing to toast — there is nothing for the owner to do. The header's "Not live" line
          // says the view may be behind, and the next trigger tries again.
          sync.failed = true;
        }
        recordingRef.current = null;
        updateLive();
        // Read through the ref: a trigger may have set it while the read was awaited.
      } while (syncRef.current.again && !document.hidden);
      sync.running = false;
    })();
  }, [updateLive]);

  // The ways a tab learns it may have missed something without the socket saying so: coming back
  // to the front (including from the back/forward cache) and coming back online.
  React.useEffect(() => {
    const onReturn = () => {
      if (!document.hidden) reconcile();
    };

    document.addEventListener('visibilitychange', onReturn);
    globalThis.addEventListener('focus', onReturn);
    globalThis.addEventListener('pageshow', onReturn);
    globalThis.addEventListener('online', reconcile);
    globalThis.addEventListener('offline', updateLive);
    return () => {
      document.removeEventListener('visibilitychange', onReturn);
      globalThis.removeEventListener('focus', onReturn);
      globalThis.removeEventListener('pageshow', onReturn);
      globalThis.removeEventListener('online', reconcile);
      globalThis.removeEventListener('offline', updateLive);
    };
  }, [reconcile, updateLive]);

  // The push channel. All four tables are written out of band — the poller inserts messages
  // and stamps account health, the classifier sweep writes a verdict and (via a separate write
  // to comm_messages) fills in the message's tier — so a browser that only ever read its seed
  // would show a stale queue, a green dot over a dead account, and no "Why:" explanation.
  React.useEffect(() => {
    const supabase = createClient();
    let settleCounts: ReturnType<typeof setTimeout> | undefined;

    const channel = supabase
      .channel('comm_messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_messages' },
        (payload: RealtimePostgresChangesPayload<CommMessage>) => {
          const action = messageStreamAction(payload);
          if (action !== null) apply({ type: 'messages', action });
          // The row moves at once; the shelf's and the Reader's counts are the server's, so a
          // change that may have moved one is followed by a re-read once the burst settles.
          clearTimeout(settleCounts);
          settleCounts = setTimeout(reconcile, COUNTS_SETTLE_MS);
        },
      );

    const accountsChannel = supabase
      .channel('comm_accounts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_accounts' },
        (payload: RealtimePostgresChangesPayload<CommAccount>) => {
          const action = accountStreamAction(payload);
          if (action !== null) apply({ type: 'accounts', action });
        },
      );

    const healthChannel = supabase
      .channel('comm_classifier_health')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_classifier_health' },
        (payload: RealtimePostgresChangesPayload<CommClassifierHealth>) => {
          apply({ type: 'health', health: healthStreamValue(payload) });
        },
      );

    const verdictsChannel = supabase
      .channel('comm_verdicts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comm_verdicts' },
        (payload: RealtimePostgresChangesPayload<CommVerdict>) => {
          const action = verdictStreamAction(payload);
          if (action !== null) apply({ type: 'verdicts', action });
        },
      );

    // Every channel reports its state. The moment all four are joined — the first time, closing
    // the gap since the shell's read, or again after the socket dropped — is when to re-read.
    const track = (table: string) => (status: REALTIME_SUBSCRIBE_STATES) => {
      channelStatusRef.current[table] = status;
      updateLive();
      if (
        status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED &&
        CHANNELS.every(
          (name) => channelStatusRef.current[name] === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED,
        )
      ) {
        reconcile();
      }
    };

    const cancelJoin = joinWhenAuthenticated(supabase.realtime, () => {
      channel.subscribe(track('comm_messages'));
      accountsChannel.subscribe(track('comm_accounts'));
      healthChannel.subscribe(track('comm_classifier_health'));
      verdictsChannel.subscribe(track('comm_verdicts'));
    });

    return () => {
      cancelJoin();
      clearTimeout(settleCounts);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(accountsChannel);
      void supabase.removeChannel(healthChannel);
      void supabase.removeChannel(verdictsChannel);
    };
  }, [apply, reconcile, updateLive]);

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
      // exactly what it changed and can't clobber a realtime change to another field.
      const captured = current === undefined ? {} : capturedFields(current, patch);
      // Held while in flight, so a re-read landing meanwhile doesn't revert the optimistic row.
      const inFlight = writesInFlightRef.current;
      inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
      try {
        return await runOptimisticMutation({
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
      } finally {
        const left = (inFlight.get(id) ?? 1) - 1;
        if (left === 0) inFlight.delete(id);
        else inFlight.set(id, left);
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
          // Only a single-message purge can be reflected locally: an account-wide or
          // date-range purge has no id list to remove, and guessing which rows the RPC
          // matched would be a client re-implementation of the server's own predicate.
          if (input.message_id !== undefined) {
            apply({
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
      showMoreShelf() {
        shelfLimitRef.current += SHELF_PAGE_SIZE;
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

/** How many messages are waiting for an answer — the sidebar badge's number. */
export function useQueueCount(): number {
  const { messages } = useStateValue('useQueueCount');
  return React.useMemo(() => queueCount(messages), [messages]);
}

/** The FYI shelf: everything judged that owes no reply, newest first. Deliberately uncounted. */
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
 * Whether the view is live, when it was last read, and the newest verdict the server knows of —
 * what the header needs to say whether anything on the page can be trusted right now.
 */
export function useCommsSync(): { live: boolean; readAt: string; lastClassifiedAt: string | null } {
  const { live, readAt, lastClassifiedAt } = useStateValue('useCommsSync');
  return React.useMemo(
    () => ({ live, readAt, lastClassifiedAt }),
    [live, readAt, lastClassifiedAt],
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
