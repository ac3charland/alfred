import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { SHELF_LIMIT_MAX, SHELF_PAGE_SIZE } from '@/lib/comms';
import {
  makeCommAccount,
  makeCommHealth,
  makeCommMessage,
  makeCommVerdict,
  makeCommsSeed,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import { holdRealtimeAuth } from '@/lib/supabase/hold-realtime-auth';
import type {
  CommAccount,
  CommClassifierHealth,
  CommMessage,
  CommVerdict,
  CommsSeed,
  Item,
} from '@/lib/types';

import {
  COMMS_COUNTS_MAX_WAIT_MS,
  COMMS_COUNTS_SETTLE_MS,
  COMMS_READ_RETRY_MS,
  COMMS_REJOIN_MS,
  CommsProvider,
  accountStreamAction,
  commsReducer,
  healthStreamValue,
  messageStreamAction,
  stateFromSeed,
  useCommsAccounts,
  useCommsActions,
  useCommsHealth,
  useCommsMessages,
  useCommsSync,
  useCommsVerdicts,
  useQueueCount,
  useQueuedByTier,
  useShelf,
  useShelfCounts,
  verdictStreamAction,
} from './comms-store';

// The store opens a realtime channel on mount; stub the browser client so the subscription is
// inert and the tests drive the reducer directly. The provider subscribes one channel PER TABLE
// (comm_messages, comm_accounts, comm_classifier_health, comm_verdicts), so the stub keys each
// captured handler by the filter's table — capturing a single handler would let a later
// subscription silently overwrite an earlier one (see the supabase skill).
const mockRealtimeHandlers = new Map<string, (payload: never) => void>();
// The status callback each channel was subscribed with, keyed the same way — the seam a test
// uses to replay a rejoin after the socket dropped.
const mockSubscribeCallbacks = new Map<string, (status: string) => void>();
const mockRemoveChannel = jest.fn();
// The tables whose channel has actually been JOINED, in join order, and the realtime auth call
// that has to come first — the seam the ALF-258 tests use to hold the session token back.
const mockJoinedTables: string[] = [];
const mockSetAuth = jest.fn(() => Promise.resolve());
// Off, a subscribed channel waits for the test to report its join by hand.
let mockJoinOnSubscribe = true;
/** The double's channel, as `removeChannel` receives it: `report` is its status callback. */
interface MockChannel {
  report?: (status: string) => void;
}
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    realtime: { setAuth: mockSetAuth },
    channel: () => {
      let table: string | undefined;
      const chan = {
        report: undefined as ((status: string) => void) | undefined,
        on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
          if (filter.table !== undefined) {
            table = filter.table;
            mockRealtimeHandlers.set(filter.table, handler);
          }
          return chan;
        },
        subscribe: (callback?: (status: string) => void) => {
          if (table !== undefined) mockJoinedTables.push(table);
          if (callback !== undefined && table !== undefined) {
            mockSubscribeCallbacks.set(table, callback);
            chan.report = callback;
            // The real client reports the join through the same callback, so the double does
            // too — otherwise a replayed REJOIN would arrive as the channel's first join.
            if (mockJoinOnSubscribe) callback('SUBSCRIBED');
          }
          return chan;
        },
      };
      return chan;
    },
    removeChannel: mockRemoveChannel,
  }),
}));

// The row verbs each call one endpoint; stubbing the client module is what lets a test assert
// the optimistic patch separately from the reconcile (a call left pending never reconciles).
jest.mock('@/lib/api-client');
const mockApi = jest.mocked(api);

// Capture showToast so the rollback tests can assert the message a failed write surfaces.
// Mocking the hook short-circuits the context, so no ToastProvider wrapper is needed.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

const ACCOUNT = '00000000-0000-4000-8000-00000000000a';

/** One channel per streamed table. */
const CHANNEL_COUNT = 4;

beforeEach(() => {
  resetCommFixtureClock();
  jest.clearAllMocks();
  mockRealtimeHandlers.clear();
  mockSubscribeCallbacks.clear();
  mockJoinedTables.length = 0;
  mockJoinOnSubscribe = true;
  // A test may make teardown report CLOSED, as the real client does; don't let it leak.
  mockRemoveChannel.mockReset();
  // Every mount re-reads once its channels join; unless a test is about that read, it never lands.
  mockApi.fetchCommsSnapshot.mockReturnValue(new Promise(() => {}));
});

describe('commsReducer', () => {
  const empty = stateFromSeed(makeCommsSeed());

  it('upserts a message and patches it by id', () => {
    const message = makeCommMessage(ACCOUNT);
    const inserted = commsReducer(empty, {
      type: 'messages',
      action: { type: 'upsert', items: [message] },
    });
    const patched = commsReducer(inserted, {
      type: 'messages',
      action: { type: 'patch', ids: [message.id], patch: { tier: 'asap', judged_by: 'model' } },
    });

    expect(patched.messages[0]?.tier).toBe('asap');
  });

  it('is a no-op for a patch naming a message it no longer holds — the race rule', () => {
    const state = commsReducer(empty, {
      type: 'messages',
      action: { type: 'patch', ids: ['gone'], patch: { tier: 'asap' } },
    });

    expect(state.messages).toEqual([]);
  });

  it('upserts and removes accounts', () => {
    const account = makeCommAccount('personal');
    const withAccount = commsReducer(empty, {
      type: 'accounts',
      action: { type: 'upsert', items: [account] },
    });
    expect(withAccount.accounts).toHaveLength(1);

    const removed = commsReducer(withAccount, {
      type: 'accounts',
      action: { type: 'remove', ids: [account.id] },
    });
    expect(removed.accounts).toEqual([]);
  });

  it('merges verdicts into the by-id map', () => {
    const verdict = makeCommVerdict('m1');
    const state = commsReducer(empty, {
      type: 'verdicts',
      action: { type: 'upsert', verdicts: [verdict] },
    });
    expect(state.verdictsById[verdict.id]).toBe(verdict);
  });

  it('evicts a verdict from the by-id map on a remove action', () => {
    const verdict = makeCommVerdict('m1');
    const withVerdict = commsReducer(empty, {
      type: 'verdicts',
      action: { type: 'upsert', verdicts: [verdict] },
    });
    const state = commsReducer(withVerdict, {
      type: 'verdicts',
      action: { type: 'remove', ids: [verdict.id] },
    });
    expect(state.verdictsById[verdict.id]).toBeUndefined();
  });

  it('freezes "current as of" at the first stale moment, and no later one moves it', () => {
    const down = commsReducer(empty, { type: 'stale', at: '2026-09-09T12:05:00.000Z' });
    const stillDown = commsReducer(down, { type: 'stale', at: '2026-09-09T12:09:00.000Z' });
    const reread = commsReducer(stillDown, {
      type: 'snapshot',
      seed: makeCommsSeed(),
      keep: new Set(),
    });

    expect(empty).toMatchObject({ live: true, currentAsOf: null });
    expect(stillDown).toMatchObject({ live: false, currentAsOf: '2026-09-09T12:05:00.000Z' });
    // A re-read replaces the rows, not what the tab knows about its own connection.
    expect(reread).toMatchObject({ live: false, currentAsOf: '2026-09-09T12:05:00.000Z' });
  });

  it('moves "current as of" forward to a read that cannot vouch for the stream, never back', () => {
    const down = commsReducer(empty, { type: 'stale', at: '2026-09-09T12:05:00.000Z' });
    const later = commsReducer(down, {
      type: 'read',
      live: false,
      startedAt: '2026-09-09T12:08:00.000Z',
    });
    const earlier = commsReducer(later, {
      type: 'read',
      live: false,
      startedAt: '2026-09-09T12:06:00.000Z',
    });

    expect(later).toMatchObject({ live: false, currentAsOf: '2026-09-09T12:08:00.000Z' });
    expect(earlier).toMatchObject({ live: false, currentAsOf: '2026-09-09T12:08:00.000Z' });
    // Nothing had made a live view stale, so a read that can't vouch for the stream changes nothing.
    expect(
      commsReducer(empty, { type: 'read', live: false, startedAt: '2026-09-09T12:08:00.000Z' }),
    ).toBe(empty);
  });

  it('is live again only once a read that vouches for the stream lands', () => {
    const down = commsReducer(empty, { type: 'stale', at: '2026-09-09T12:05:00.000Z' });
    const up = commsReducer(down, {
      type: 'read',
      live: true,
      startedAt: '2026-09-09T12:08:00.000Z',
    });

    expect(up).toMatchObject({ live: true, currentAsOf: null });
  });

  it('starts a shell whose read failed unloaded, dated by nothing — least of all the server clock', () => {
    const seed = makeCommsSeed({ readAt: '2026-09-09T12:00:00.000Z' });
    const unloaded = stateFromSeed(seed, true);

    expect(unloaded).toMatchObject({ loaded: false, live: false, currentAsOf: null });
    expect(commsReducer(unloaded, { type: 'stale', at: '2026-09-09T12:05:00.000Z' })).toBe(
      unloaded,
    );
    expect(empty.loaded).toBe(true);
  });

  it('is loaded by the first read that lands, dated to it unless it can vouch for the stream', () => {
    const unloaded = stateFromSeed(makeCommsSeed(), true);
    const startedAt = '2026-09-09T12:08:00.000Z';

    expect(commsReducer(unloaded, { type: 'read', live: false, startedAt })).toMatchObject({
      loaded: true,
      live: false,
      currentAsOf: startedAt,
    });
    expect(commsReducer(unloaded, { type: 'read', live: true, startedAt })).toMatchObject({
      loaded: true,
      live: true,
      currentAsOf: null,
    });
    // A snapshot alone replaces the rows; it is the read landing that says anything is loaded.
    expect(
      commsReducer(unloaded, { type: 'snapshot', seed: makeCommsSeed(), keep: new Set() }).loaded,
    ).toBe(false);
  });

  it('replaces the classifier health row wholesale', () => {
    const health = makeCommHealth();
    expect(commsReducer(empty, { type: 'health', health }).health).toBe(health);
    expect(commsReducer(empty, { type: 'health', health: undefined }).health).toBeUndefined();
  });
});

// ── the realtime rules, as pure functions ───────────────────────────────────

/** A realtime payload of the given kind, carrying only the fields the rules read. */
function payload<T extends { id: string | number }>(
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  row: Partial<T>,
): RealtimePostgresChangesPayload<T> {
  const base = { schema: 'public', table: 't', commit_timestamp: '', errors: [] };
  const shaped =
    eventType === 'DELETE'
      ? { ...base, eventType, new: {}, old: row }
      : { ...base, eventType, new: row, old: {} };
  return shaped as unknown as RealtimePostgresChangesPayload<T>;
}

describe('messageStreamAction', () => {
  it('upserts an arriving inbound message', () => {
    const message = makeCommMessage(ACCOUNT);
    expect(messageStreamAction(payload<CommMessage>('INSERT', message))).toEqual({
      type: 'upsert',
      items: [message],
    });
  });

  it('ignores an arriving OUTBOUND message — it is the drain signal, never a row', () => {
    const sent = makeCommMessage(ACCOUNT, { direction: 'outbound' });
    expect(messageStreamAction(payload<CommMessage>('INSERT', sent))).toBeNull();
  });

  it('patches on an update, so a verdict landing never resurrects a removed row', () => {
    const judged = makeCommMessage(ACCOUNT, { tier: 'today', judged_by: 'model' });
    expect(messageStreamAction(payload<CommMessage>('UPDATE', judged))).toEqual({
      type: 'patch',
      ids: [judged.id],
      patch: {
        tier: judged.tier,
        judged_by: judged.judged_by,
        ask: judged.ask,
        verdict_id: judged.verdict_id,
        classified_at: judged.classified_at,
        cleared_at: judged.cleared_at,
        cleared_by: judged.cleared_by,
        inbox_item_id: judged.inbox_item_id,
        filtered_reason: judged.filtered_reason,
        classify_attempts: judged.classify_attempts,
        reclassify_requested_at: judged.reclassify_requested_at,
        reader_claimed_at: judged.reader_claimed_at,
      },
    });
  });

  it('carries the Reader claim stamp onto the patch, so a claimed newsletter leaves the shelf live', () => {
    const claimed = makeCommMessage(ACCOUNT, {
      tier: 'fyi',
      judged_by: 'filter',
      reader_claimed_at: '2026-09-16T10:05:00.000Z',
    });
    const action = messageStreamAction(payload<CommMessage>('UPDATE', claimed));
    expect(action && 'patch' in action ? action.patch : undefined).toMatchObject({
      reader_claimed_at: '2026-09-16T10:05:00.000Z',
    });
  });

  // BUG 3 (the realtime UPDATE handler spreading the whole row): `comm_messages` has no
  // REPLICA IDENTITY FULL, so an UPDATE that leaves `body` untouched can arrive over the wire
  // with `body: null` — Realtime's decoder substituting null for an unchanged TOASTed column it
  // cannot otherwise recover. Spreading `payload.new` would carry that straight onto the patch;
  // whitelisting the columns an UPDATE can touch must leave `body` out of the patch entirely.
  it('never carries body onto the patch, even when the wire payload carries a null one', () => {
    const wireRow = {
      ...makeCommMessage(ACCOUNT, { tier: 'today', judged_by: 'model' }),
      body: null,
    } as unknown as CommMessage;

    const action = messageStreamAction(payload<CommMessage>('UPDATE', wireRow));

    expect(action?.type).toBe('patch');
    expect(action && 'patch' in action ? action.patch : undefined).not.toHaveProperty('body');
  });

  it('removes on a delete, and ignores a delete payload carrying no id', () => {
    expect(messageStreamAction(payload<CommMessage>('DELETE', { id: 'm9' }))).toEqual({
      type: 'remove',
      ids: ['m9'],
    });
    expect(messageStreamAction(payload<CommMessage>('DELETE', {}))).toBeNull();
  });
});

describe('accountStreamAction', () => {
  it('upserts a self-registering account', () => {
    const account = makeCommAccount('personal');
    expect(accountStreamAction(payload<CommAccount>('INSERT', account))).toEqual({
      type: 'upsert',
      items: [account],
    });
  });

  it('patches only the columns an UPDATE can actually touch, on an update', () => {
    const account = makeCommAccount('personal');
    expect(accountStreamAction(payload<CommAccount>('UPDATE', account))).toEqual({
      type: 'patch',
      ids: [account.id],
      patch: {
        key: account.key,
        kind: account.kind,
        label: account.label,
        home: account.home,
        owner_handles: account.owner_handles,
        expected_interval_seconds: account.expected_interval_seconds,
        cursor: account.cursor,
        last_seen_at: account.last_seen_at,
        last_error: account.last_error,
        last_error_at: account.last_error_at,
      },
    });
  });

  // BUG 2 (the same latent trap as messageStreamAction's, applied for consistency): no writer
  // ever touches `enabled` or `created_at` (see AccountUpdateColumns), so spreading the whole
  // payload risks carrying an unreliable replicated value onto the store the moment a future
  // writer changes that. Not exploitable today — `comm_accounts` has no TOASTed column — but the
  // whitelist keeps the two sibling stream handlers deriving from the same rule.
  it('never carries enabled or created_at onto the patch, even though the wire payload has them', () => {
    const account = makeCommAccount('personal');
    const action = accountStreamAction(payload<CommAccount>('UPDATE', account));
    expect(action?.type).toBe('patch');
    const patch = action && 'patch' in action ? action.patch : undefined;
    expect(patch).not.toHaveProperty('enabled');
    expect(patch).not.toHaveProperty('created_at');
  });

  it('removes on a delete', () => {
    const account = makeCommAccount('personal');
    expect(accountStreamAction(payload<CommAccount>('DELETE', { id: account.id }))).toEqual({
      type: 'remove',
      ids: [account.id],
    });
  });
});

describe('healthStreamValue', () => {
  it('takes the new row, and clears on a delete', () => {
    const health = makeCommHealth();
    expect(healthStreamValue(payload<CommClassifierHealth>('INSERT', health))).toEqual(health);
    expect(healthStreamValue(payload<CommClassifierHealth>('DELETE', health))).toBeUndefined();
  });
});

describe('verdictStreamAction', () => {
  it('upserts an arriving verdict', () => {
    const verdict = makeCommVerdict('m1');
    expect(verdictStreamAction(payload<CommVerdict>('INSERT', verdict))).toEqual({
      type: 'upsert',
      verdicts: [verdict],
    });
  });

  it('ignores an update — the classifier never revises a verdict in place', () => {
    const verdict = makeCommVerdict('m1');
    expect(verdictStreamAction(payload<CommVerdict>('UPDATE', verdict))).toBeNull();
  });

  it('removes on a cascade delete, and ignores a delete payload carrying no id', () => {
    const verdict = makeCommVerdict('m1');
    expect(verdictStreamAction(payload<CommVerdict>('DELETE', { id: verdict.id }))).toEqual({
      type: 'remove',
      ids: [verdict.id],
    });
    expect(verdictStreamAction(payload<CommVerdict>('DELETE', {}))).toBeNull();
  });
});

// ── selectors + actions, through a real provider ────────────────────────────

const QUEUED = makeCommMessage(ACCOUNT, {
  id: '00000000-0000-4000-8000-000000000001',
  tier: 'today',
  judged_by: 'model',
});
const SHELVED = makeCommMessage(ACCOUNT, {
  id: '00000000-0000-4000-8000-000000000002',
  tier: 'fyi',
  judged_by: 'model',
});
// A fixed id (rather than makeCommVerdict's random default) so a test can name it directly
// instead of reading it back out of the store.
const SEEDED_VERDICT = makeCommVerdict(QUEUED.id, { id: 'v-seeded' });

function useStore() {
  return {
    actions: useCommsActions(),
    accounts: useCommsAccounts(),
    messages: useCommsMessages(),
    byTier: useQueuedByTier(),
    count: useQueueCount(),
    shelf: useShelf(),
    health: useCommsHealth(),
    verdicts: useCommsVerdicts(),
    counts: useShelfCounts(),
    sync: useCommsSync(),
  };
}

function makeWrapper(messages: CommMessage[] = [QUEUED, SHELVED]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CommsProvider
        initialSeed={makeCommsSeed({
          accounts: [makeCommAccount('personal')],
          messages,
          verdicts: [SEEDED_VERDICT],
          health: makeCommHealth(),
        })}
      >
        {children}
      </CommsProvider>
    );
  };
}

describe('CommsProvider selectors', () => {
  it('derives the queue, the shelf and the badge count from one seeded list', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.accounts).toHaveLength(1);
    expect(result.current.count).toBe(1);
    expect(result.current.byTier.today).toHaveLength(1);
    expect(result.current.shelf).toHaveLength(1);
    expect(result.current.health).toBeDefined();
    expect(Object.keys(result.current.verdicts)).toHaveLength(1);
  });

  it('throws outside a provider, naming the hook that asked', () => {
    expect(() => renderHook(() => useCommsMessages())).toThrow(
      'useCommsMessages must be used within a CommsProvider',
    );
  });
});

describe('comm_verdicts realtime subscription', () => {
  it('a verdict landing out of band reaches verdictsById without a reload', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(Object.keys(result.current.verdicts)).toHaveLength(1);

    const arriving = makeCommVerdict(QUEUED.id, { id: 'v-arriving' });
    act(() => {
      mockRealtimeHandlers.get('comm_verdicts')?.(
        payload<CommVerdict>('INSERT', arriving) as never,
      );
    });

    expect(result.current.verdicts['v-arriving']).toEqual(arriving);
  });

  it('subscribes exactly one comm_verdicts channel and tears down all four on unmount', () => {
    const { unmount } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(mockRealtimeHandlers.get('comm_verdicts')).toBeDefined();

    unmount();

    expect(mockRemoveChannel).toHaveBeenCalledTimes(4);
  });

  it('evicts a verdict from verdictsById on a cascade DELETE — the message it judged was purged', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(result.current.verdicts[SEEDED_VERDICT.id]).toBeDefined();

    act(() => {
      mockRealtimeHandlers.get('comm_verdicts')?.(
        payload<CommVerdict>('DELETE', { id: SEEDED_VERDICT.id }) as never,
      );
    });

    expect(result.current.verdicts[SEEDED_VERDICT.id]).toBeUndefined();
  });
});

/**
 * ALF-258. A channel's join payload is frozen at `subscribe()`, and on a fresh page load the
 * socket does not hold the session's JWT yet — so every table joined as `anon`, which RLS lets
 * see nothing, and supabase-js never re-sent the token because, by the time the join completed,
 * it had not "changed". The queue then sat still until a hard reload.
 */
describe('CommsProvider — joining realtime as the signed-in user', () => {
  it('joins no channel until the socket holds the session token', async () => {
    const releaseAuth = holdRealtimeAuth(mockSetAuth);
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    // No argument: the token comes from the session, not a pinned one that would never refresh.
    expect(mockSetAuth).toHaveBeenCalledWith();
    expect(mockJoinedTables).toEqual([]);

    await releaseAuth();

    expect(mockJoinedTables).toEqual([
      'comm_messages',
      'comm_accounts',
      'comm_classifier_health',
      'comm_verdicts',
    ]);
  });

  it('joins nothing when it unmounts before the token arrives', async () => {
    const releaseAuth = holdRealtimeAuth(mockSetAuth);
    const { unmount } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    unmount();

    await releaseAuth();

    expect(mockJoinedTables).toEqual([]);
  });
});

describe('comm_messages realtime UPDATE', () => {
  it('never lets a TOASTed-away, null-substituted body clobber the stored one', () => {
    const withBody = { ...QUEUED, body: 'the real email body' };
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([withBody, SHELVED]) });

    // What Realtime actually delivers for an UPDATE that leaves `body` untouched: the decoder
    // cannot recover a TOASTed column's real value without REPLICA IDENTITY FULL, so it
    // substitutes null — while CommMessage's type still claims body is a string.
    const wireRow = {
      ...withBody,
      tier: 'asap',
      judged_by: 'owner',
      body: null,
    } as unknown as CommMessage;
    act(() => {
      mockRealtimeHandlers.get('comm_messages')?.(payload<CommMessage>('UPDATE', wireRow) as never);
    });

    const row = result.current.messages.find((m) => m.id === withBody.id);
    // The columns an UPDATE really writes DID apply...
    expect(row?.tier).toBe('asap');
    expect(row?.judged_by).toBe('owner');
    // ...but the body Realtime lied about did not.
    expect(row?.body).toBe('the real email body');
  });
});

describe('patchMessageLocally', () => {
  it('changes a row in this tab with no server write', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      result.current.actions.patchMessageLocally(QUEUED.id, {
        cleared_at: '2026-02-01T09:00:00.000Z',
        cleared_by: 'reply',
      });
    });

    expect(result.current.count).toBe(0);
  });
});

describe('writeMessage', () => {
  const CLEAR = { cleared_at: '2026-02-01T09:00:00.000Z', cleared_by: 'not_replying' } as const;

  it('applies the change immediately and reconciles with the server row', async () => {
    const saved: CommMessage = { ...QUEUED, ...CLEAR, ask: 'from the server' };
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.writeMessage(
        QUEUED.id,
        CLEAR,
        () => Promise.resolve(saved),
        "Couldn't clear that message",
      );
    });

    expect(result.current.count).toBe(0);
    // Reconciled with the whole server row, not just the fields the caller named.
    expect(result.current.messages.find((m) => m.id === QUEUED.id)?.ask).toBe('from the server');
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('restores the captured fields, toasts, and re-throws on failure', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(
        result.current.actions.writeMessage(
          QUEUED.id,
          CLEAR,
          () => Promise.reject(new Error('boom')),
          "Couldn't clear that message",
        ),
      ).rejects.toThrow('boom');
    });

    expect(result.current.count).toBe(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't clear that message");
  });

  it('rolls back ONLY what it changed, leaving a field the stream moved meanwhile alone', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    const failing = act(async () => {
      await expect(
        result.current.actions.writeMessage(
          QUEUED.id,
          CLEAR,
          () => Promise.reject(new Error('boom')),
          "Couldn't clear that message",
        ),
      ).rejects.toThrow('boom');
    });
    // A concurrent change to an unrelated field, as the realtime stream would deliver it.
    act(() => {
      result.current.actions.patchMessageLocally(QUEUED.id, { ask: 'a re-judged ask' });
    });
    await failing;

    const row = result.current.messages.find((m) => m.id === QUEUED.id);
    expect(row?.cleared_at).toBeNull();
    expect(row?.ask).toBe('a re-judged ask');
  });
});

// ── the row verbs ───────────────────────────────────────────────────────────
//
// Each verb is a thin optimistic write over one endpoint, so what is worth pinning is the
// PATCH it applies before the server answers: that patch is what moves the row out of the
// queue on the click rather than on the round-trip.

describe('clearMessage', () => {
  it('clears a row immediately and reconciles with the server', async () => {
    const saved: CommMessage = {
      ...QUEUED,
      cleared_at: '2026-02-01T09:00:00.000Z',
      cleared_by: 'not_replying',
    };
    mockApi.clearCommMessage.mockResolvedValue(saved);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.clearMessage(QUEUED.id, 'not_replying');
    });

    expect(mockApi.clearCommMessage).toHaveBeenCalledWith(QUEUED.id, 'not_replying');
    expect(result.current.count).toBe(0);
    expect(result.current.messages.find((m) => m.id === QUEUED.id)?.cleared_by).toBe(
      'not_replying',
    );
  });

  it('leaves the tier alone when the owner is simply declining', () => {
    mockApi.clearCommMessage.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      void result.current.actions.clearMessage(QUEUED.id, 'not_replying');
    });

    const row = result.current.messages.find((m) => m.id === QUEUED.id);
    expect(row?.tier).toBe('today');
    expect(row?.judged_by).toBe('model');
  });

  it('demotes to the shelf when the row asked nothing — the owner has just judged it', () => {
    mockApi.clearCommMessage.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      void result.current.actions.clearMessage(QUEUED.id, 'nothing_to_answer');
    });

    const row = result.current.messages.find((m) => m.id === QUEUED.id);
    expect(row?.tier).toBe('fyi');
    expect(row?.judged_by).toBe('owner');
    expect(result.current.shelf).toHaveLength(2);
  });

  it('rolls the row back and toasts when the clear fails', async () => {
    mockApi.clearCommMessage.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.clearMessage(QUEUED.id, 'not_replying')).rejects.toThrow(
        'boom',
      );
    });

    expect(result.current.count).toBe(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't clear that message");
  });
});

describe('changeTier', () => {
  it('moves the row and marks the owner as its judge', () => {
    mockApi.changeCommTier.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      void result.current.actions.changeTier(QUEUED.id, 'asap');
    });

    expect(mockApi.changeCommTier).toHaveBeenCalledWith(QUEUED.id, 'asap');
    expect(result.current.byTier.asap).toHaveLength(1);
    expect(result.current.byTier.today).toHaveLength(0);
    expect(result.current.messages.find((m) => m.id === QUEUED.id)?.judged_by).toBe('owner');
  });

  it('re-opens a shelved row promoted back into the queue — the false-negative path', () => {
    const cleared: CommMessage = {
      ...SHELVED,
      cleared_at: '2026-02-01T09:00:00.000Z',
      cleared_by: 'nothing_to_answer',
    };
    mockApi.changeCommTier.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([QUEUED, cleared]) });

    act(() => {
      void result.current.actions.changeTier(cleared.id, 'today');
    });

    expect(result.current.count).toBe(2);
    expect(result.current.messages.find((m) => m.id === cleared.id)?.cleared_at).toBeNull();
  });

  it('keeps the exit when the owner demotes a row to the shelf', () => {
    mockApi.changeCommTier.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      void result.current.actions.changeTier(QUEUED.id, 'fyi');
    });

    const row = result.current.messages.find((m) => m.id === QUEUED.id);
    expect(row?.tier).toBe('fyi');
    expect(row?.cleared_by).toBeNull();
  });

  it('rolls back and toasts on failure', async () => {
    mockApi.changeCommTier.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.changeTier(QUEUED.id, 'asap')).rejects.toThrow('boom');
    });

    expect(result.current.byTier.today).toHaveLength(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't change that tier");
  });
});

describe('makeInboxItem', () => {
  const ITEM = { id: 'item-1', title: 'Approve the invoice' } as unknown as Item;

  it('clears the row, hands back both rows, and says where the obligation went', async () => {
    const saved: CommMessage = {
      ...QUEUED,
      cleared_at: '2026-02-01T09:00:00.000Z',
      cleared_by: 'inbox_item',
      inbox_item_id: ITEM.id,
    };
    mockApi.makeInboxItemFromMessage.mockResolvedValue({ message: saved, item: ITEM });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    let returned: { message: CommMessage; item: Item } | undefined;
    await act(async () => {
      returned = await result.current.actions.makeInboxItem(QUEUED.id);
    });

    expect(result.current.count).toBe(0);
    expect(returned?.item).toBe(ITEM);
    expect(result.current.messages.find((m) => m.id === QUEUED.id)?.inbox_item_id).toBe(ITEM.id);
    expect(mockShowToast).toHaveBeenCalledWith('Added to Inbox');
  });

  it('restores the row and says nothing about the Inbox when the create fails', async () => {
    mockApi.makeInboxItemFromMessage.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.makeInboxItem(QUEUED.id)).rejects.toThrow('boom');
    });

    expect(result.current.count).toBe(1);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't add that to the Inbox");
    expect(mockShowToast).not.toHaveBeenCalledWith('Added to Inbox');
  });
});

describe('requestReclassify', () => {
  it('marks the row as asked-for and resets its attempt count', () => {
    mockApi.requestReclassify.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      void result.current.actions.requestReclassify(QUEUED.id);
    });

    const row = result.current.messages.find((m) => m.id === QUEUED.id);
    expect(row?.reclassify_requested_at).not.toBeNull();
    expect(row?.classify_attempts).toBe(0);
    // The row does NOT leave the queue: nothing has re-judged it yet.
    expect(result.current.count).toBe(1);
  });

  it('rolls back and toasts on failure', async () => {
    mockApi.requestReclassify.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.requestReclassify(QUEUED.id)).rejects.toThrow('boom');
    });

    expect(result.current.messages.find((m) => m.id === QUEUED.id)?.reclassify_requested_at).toBe(
      null,
    );
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't ask for a re-run");
  });
});

describe('purge', () => {
  it('removes a purged message only once the server says it is gone', async () => {
    let resolvePurge: ((value: { purged: number }) => void) | undefined;
    mockApi.purgeComms.mockReturnValue(
      new Promise((resolve) => {
        resolvePurge = resolve;
      }),
    );
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    const pending = act(async () => {
      await result.current.actions.purge({ message_id: QUEUED.id });
    });
    // Nothing optimistic: a destroy is not undoable, so the row stays until it is confirmed.
    expect(result.current.messages).toHaveLength(2);
    resolvePurge?.({ purged: 1 });
    await pending;

    expect(result.current.messages).toHaveLength(1);
  });

  it('leaves the client alone for an account-wide purge — there is no id list to remove', async () => {
    mockApi.purgeComms.mockResolvedValue({ purged: 12 });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.purge({ account_id: ACCOUNT });
    });

    expect(mockApi.purgeComms).toHaveBeenCalledWith({ account_id: ACCOUNT });
    expect(result.current.messages).toHaveLength(2);
  });

  it('toasts and re-throws when the purge fails', async () => {
    mockApi.purgeComms.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.purge({ message_id: QUEUED.id })).rejects.toThrow('boom');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't purge those messages");
  });
});

/** Shadow `document.hidden` — a read-only getter in jsdom — and fire what that change fires. */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Shadow `navigator.onLine` and fire the matching window event. */
function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  globalThis.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

/** A snapshot read the test resolves (or fails) by hand. */
function holdSnapshot() {
  const held: { resolve?: (seed: CommsSeed) => void; reject?: (error: Error) => void } = {};
  mockApi.fetchCommsSnapshot.mockReturnValueOnce(
    new Promise<CommsSeed>((resolve, reject) => {
      held.resolve = resolve;
      held.reject = reject;
    }),
  );
  return {
    resolve: async (seed: CommsSeed) => {
      await act(async () => {
        held.resolve?.(seed);
        await Promise.resolve();
      });
    },
    reject: async () => {
      await act(async () => {
        held.reject?.(new Error('offline'));
        await Promise.resolve();
      });
    },
  };
}

/**
 * ALF-258. The view has to be a true reflection of the server however the tab got here, and
 * Realtime can't promise that alone: a socket that lapses — a tab in the background, a machine
 * asleep, a phone that suspended the app — drops every change in the gap and replays none, and so
 * does the gap between the shell's server read and the channels joining.
 */
describe('CommsProvider — re-reading the view whenever it may have missed something', () => {
  const PERSONAL = makeCommAccount('personal', { id: ACCOUNT });
  const ARRIVED = makeCommMessage(ACCOUNT, {
    id: '00000000-0000-4000-8000-000000000003',
    tier: 'asap',
    judged_by: 'model',
  });

  /** What the server holds after `ARRIVED` landed and `SHELVED` was purged. */
  const LATER = makeCommsSeed({ accounts: [PERSONAL], messages: [QUEUED, ARRIVED] });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  });

  /** Render, and let the first read — the one every join makes — land as `first`. */
  async function renderJoined(first: CommsSeed = makeCommsSeed({ messages: [QUEUED, SHELVED] })) {
    const read = holdSnapshot();
    const rendered = renderHook(() => useStore(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
    });
    await read.resolve(first);
    return rendered;
  }

  it('re-reads once every channel has joined, closing the gap since the shell read', async () => {
    const read = holdSnapshot();
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledWith(SHELF_PAGE_SIZE);
    });
    await read.resolve(LATER);

    expect(result.current.messages.map((message) => message.id)).toEqual([QUEUED.id, ARRIVED.id]);
  });

  it('brings the view up to date when the tab comes back — new rows in, purged rows out', async () => {
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);

    act(() => {
      setTabHidden(false);
    });

    await waitFor(() => {
      expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    });
    expect(result.current.shelf).toEqual([]);
  });

  it('re-reads when the socket rejoins, and is live again only once that read lands', async () => {
    const { result } = await renderJoined();

    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });
    expect(result.current.sync.live).toBe(false);
    const read = holdSnapshot();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    // Joined again, but whatever the gap dropped is still missing until the read says otherwise.
    expect(result.current.sync.live).toBe(false);
    await read.resolve(LATER);

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    expect(result.current.sync.live).toBe(true);
  });

  it('re-reads when the browser comes back online, and is not live while it is off', async () => {
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);

    act(() => {
      setOnline(false);
    });
    expect(result.current.sync.live).toBe(false);
    act(() => {
      setOnline(true);
    });

    await waitFor(() => {
      expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    });
    expect(result.current.sync.live).toBe(true);
  });

  it('keeps a change that streamed in while the read was in flight', async () => {
    const { result } = await renderJoined();
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });

    // The read was taken before ARRIVED landed; the stream delivers it while the read is out.
    act(() => {
      mockRealtimeHandlers.get('comm_messages')?.(payload<CommMessage>('INSERT', ARRIVED) as never);
    });
    await read.resolve(makeCommsSeed({ messages: [QUEUED, SHELVED] }));

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
  });

  it('never reverts a row whose write is still in flight', async () => {
    const { result } = await renderJoined();
    mockApi.clearCommMessage.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.actions.clearMessage(QUEUED.id, 'not_replying');
    });
    // The server hasn't seen the clear yet, so its snapshot still has the row queued.
    const stale = {
      ...makeCommsSeed({ messages: [QUEUED, SHELVED] }),
      lastClassifiedAt: '2026-09-09T12:30:00.000Z',
    };
    mockApi.fetchCommsSnapshot.mockResolvedValue(stale);

    act(() => {
      setTabHidden(false);
    });
    await waitFor(() => {
      expect(result.current.sync.lastClassifiedAt).toBe(stale.lastClassifiedAt);
    });

    expect(result.current.byTier.today).toEqual([]);
  });

  it('re-reads after a write fails, since its row was held back from any read meanwhile', async () => {
    const { result } = await renderJoined();
    const write = { reject: (_error: Error) => {} };
    mockApi.clearCommMessage.mockReturnValue(
      new Promise((_resolve, reject) => {
        write.reject = reject;
      }),
    );
    let clearing: Promise<unknown> = Promise.resolve();
    act(() => {
      clearing = result.current.actions.clearMessage(QUEUED.id, 'not_replying').catch(() => {});
    });
    // The server re-judged the row while the clear was out; the read that saw it held the row.
    const rejudged = { ...QUEUED, tier: 'asap' as const };
    mockApi.fetchCommsSnapshot.mockResolvedValue(makeCommsSeed({ messages: [rejudged, SHELVED] }));
    act(() => {
      setTabHidden(false);
    });
    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      write.reject(new Error('boom'));
      await clearing;
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(3);
    await waitFor(() => {
      expect(result.current.byTier.asap.map((message) => message.id)).toEqual([QUEUED.id]);
    });
  });

  it('takes a read that lands as proof it is online, whatever navigator.onLine says', async () => {
    const { result } = await renderJoined();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });
    // `onLine` has false negatives; the read landing is the evidence.
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    const read = holdSnapshot();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    await read.resolve(LATER);

    expect(result.current.sync.live).toBe(true);
  });

  it('runs one more read when a trigger lands mid-read, rather than dropping it', async () => {
    await renderJoined();
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    act(() => {
      setTabHidden(false);
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);

    await read.resolve(makeCommsSeed());

    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(3);
    });
  });

  it('says it is not live when a read fails, and live again once one lands', async () => {
    const { result } = await renderJoined();
    const failing = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    await failing.reject();

    // Nothing is blanked or toasted — the header's "Not live" line is how the owner hears it.
    expect(result.current.sync.live).toBe(false);
    expect(result.current.messages).toHaveLength(2);
    expect(mockShowToast).not.toHaveBeenCalled();

    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    act(() => {
      setTabHidden(false);
    });
    await waitFor(() => {
      expect(result.current.sync.live).toBe(true);
    });
    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
  });

  it('does not read while the tab is hidden — coming back to the front does', async () => {
    await renderJoined();

    act(() => {
      setTabHidden(true);
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does not read when a channel rejoins behind a hidden tab — coming back does', async () => {
    await renderJoined();
    act(() => {
      setTabHidden(true);
    });

    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      setTabHidden(false);
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('reads once when the tab comes back, not once per event the return fires', async () => {
    await renderJoined();
    const read = holdSnapshot();

    act(() => {
      setTabHidden(false);
      globalThis.dispatchEvent(new Event('focus'));
    });
    await read.resolve(makeCommsSeed());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('re-reads a page restored from the back/forward cache, and not an ordinary pageshow', async () => {
    await renderJoined();

    act(() => {
      globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('retries a failed read while the tab is in front, and stops once one lands', async () => {
    const { result } = await renderJoined();
    jest.useFakeTimers();
    const failing = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    await failing.reject();
    expect(result.current.sync.live).toBe(false);
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);

    act(() => {
      jest.advanceTimersByTime(COMMS_READ_RETRY_MS);
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(3);
    await waitFor(() => {
      expect(result.current.sync.live).toBe(true);
    });

    act(() => {
      jest.advanceTimersByTime(COMMS_READ_RETRY_MS * 3);
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failed read behind a hidden tab', async () => {
    await renderJoined();
    jest.useFakeTimers();
    const failing = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    await failing.reject();

    act(() => {
      setTabHidden(true);
    });
    act(() => {
      jest.advanceTimersByTime(COMMS_READ_RETRY_MS * 3);
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  const HOUR = 60 * 60 * 1000;

  it('knows the machine slept, dates "not live" to the last tick before it did, and rejoins', async () => {
    jest.useFakeTimers();
    const { result } = await renderJoined();
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS));
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
    const asleepAt = Date.now();
    const joinsBeforeSleep = mockJoinedTables.length;

    // Timers freeze while it sleeps; the socket may be dead without phoenix knowing yet.
    jest.setSystemTime(asleepAt + HOUR);
    const read = holdSnapshot();
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS));

    const since = Date.parse(result.current.sync.notLiveSince ?? '');
    expect(result.current.sync.live).toBe(false);
    expect(since).toBeLessThanOrEqual(asleepAt);
    expect(since).toBeGreaterThan(asleepAt - COMMS_READ_RETRY_MS);
    // The channels that slept aren't trusted: fresh ones join, and their join is what re-reads.
    expect(mockJoinedTables).toHaveLength(joinsBeforeSleep + 4);
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
    await read.resolve(LATER);
    expect(result.current.sync.live).toBe(true);
  });

  it('takes no gap behind a hidden tab for sleep — its timers are only throttled', async () => {
    jest.useFakeTimers();
    const { result } = await renderJoined();
    act(() => {
      setTabHidden(true);
    });
    jest.setSystemTime(Date.now() + HOUR);
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS));
    expect(result.current.sync.live).toBe(true);

    // Throttled to one tick a minute or less, so the gap after its last hidden tick is no proof either.
    jest.setSystemTime(Date.now() + HOUR);
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    await read.resolve(LATER);
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS));

    expect(result.current.sync.live).toBe(true);
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('re-creates the channels after one is closed out from under it, then re-reads', async () => {
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    jest.useFakeTimers();

    // phoenix never rejoins a channel the server closed, so nothing else would bring it back.
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CLOSED');
    });
    expect(result.current.sync.live).toBe(false);
    act(() => {
      jest.advanceTimersByTime(COMMS_REJOIN_MS);
    });

    await waitFor(() => {
      expect(mockJoinedTables).toHaveLength(CHANNEL_COUNT * 2);
    });
    expect(mockRemoveChannel).toHaveBeenCalledTimes(CHANNEL_COUNT);
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
    expect(result.current.sync.live).toBe(true);
  });

  it('never takes its own teardown for a close to recover from', async () => {
    // As the real client does: removing a channel reports it CLOSED — once the server lets it
    // go, by which time the next generation has joined.
    const closes: (() => void)[] = [];
    mockRemoveChannel.mockImplementation((channel: MockChannel) => {
      closes.push(() => channel.report?.('CLOSED'));
    });
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    jest.useFakeTimers();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CLOSED');
    });
    act(() => {
      jest.advanceTimersByTime(COMMS_REJOIN_MS);
    });
    await waitFor(() => {
      expect(result.current.sync.live).toBe(true);
    });

    act(() => {
      for (const close of closes) close();
    });
    act(() => {
      jest.advanceTimersByTime(COMMS_REJOIN_MS * 3);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(closes).toHaveLength(CHANNEL_COUNT);
    expect(result.current.sync.live).toBe(true);
    expect(mockJoinedTables).toHaveLength(CHANNEL_COUNT * 2);
  });

  it('counts a re-created channel as joined only once it has joined again', async () => {
    await renderJoined();
    jest.useFakeTimers();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CLOSED');
    });
    mockJoinOnSubscribe = false;
    act(() => {
      jest.advanceTimersByTime(COMMS_REJOIN_MS);
    });
    await waitFor(() => {
      expect(mockJoinedTables).toHaveLength(CHANNEL_COUNT * 2);
    });

    // The last generation's other three were joined; these three are not, yet.
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    act(() => {
      for (const table of ['comm_accounts', 'comm_classifier_health', 'comm_verdicts']) {
        mockSubscribeCallbacks.get(table)?.('SUBSCRIBED');
      }
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('dates "not live" from the moment it stopped being live, not from the last read', async () => {
    const { result } = await renderJoined(
      makeCommsSeed({ messages: [QUEUED, SHELVED], readAt: '2026-01-01T00:00:00.000Z' }),
    );
    expect(result.current.sync.notLiveSince).toBeUndefined();
    const before = Date.now();

    act(() => {
      setOnline(false);
    });

    expect(Date.parse(result.current.sync.notLiveSince ?? '')).toBeGreaterThanOrEqual(before);
  });

  const T1 = '2026-09-09T12:01:00.000Z';
  const T2 = '2026-09-09T12:02:00.000Z';
  const T3 = '2026-09-09T12:03:00.000Z';

  it('stays not live, dated at the drop, through a rejoin whose read then fails', async () => {
    const { result } = await renderJoined();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(T1));
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });

    jest.setSystemTime(new Date(T2));
    const read = holdSnapshot();
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T1 });

    jest.setSystemTime(new Date(T3));
    await read.reject();
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T1 });
  });

  it('stays dated at the drop when it rejoined behind a hidden tab and the return read fails', async () => {
    const { result } = await renderJoined();
    jest.useFakeTimers();
    act(() => {
      setTabHidden(true);
    });
    jest.setSystemTime(new Date(T1));
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });
    jest.setSystemTime(new Date(T2));
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T1 });

    jest.setSystemTime(new Date(T3));
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T1 });
    await read.reject();

    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T1 });
  });

  it('is not live after a read a channel dropped out from under, dated at the drop', async () => {
    const { result } = await renderJoined();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(T1));
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    jest.setSystemTime(new Date(T2));
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });

    await read.resolve(LATER);

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T2 });
  });

  it('dates itself to a read that lands while a channel is still down, but stays not live', async () => {
    const { result } = await renderJoined();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(T1));
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });
    jest.setSystemTime(new Date(T2));
    const read = holdSnapshot();
    act(() => {
      setTabHidden(false);
    });
    jest.setSystemTime(new Date(T3));

    await read.resolve(LATER);

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    expect(result.current.sync).toMatchObject({ live: false, notLiveSince: T2 });
  });

  it('keeps re-reading while it is not live, not only after a read failed', async () => {
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    jest.useFakeTimers();
    // A socket that can't get through: the channel errors and doesn't come back.
    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('CHANNEL_ERROR');
    });
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS * 2));
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(3);
    expect(result.current.sync.live).toBe(false);

    act(() => {
      mockSubscribeCallbacks.get('comm_messages')?.('SUBSCRIBED');
    });
    await waitFor(() => {
      expect(result.current.sync.live).toBe(true);
    });
    await act(() => jest.advanceTimersByTimeAsync(COMMS_READ_RETRY_MS * 3));
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(4);
  });

  it('starts a shell whose read failed unloaded, and reads without waiting for its channels', async () => {
    void holdRealtimeAuth(mockSetAuth);
    const failing = holdSnapshot();
    const read = holdSnapshot();
    const failed = makeCommsSeed({ readAt: '2026-01-01T00:00:00.000Z' });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <CommsProvider initialSeed={failed} initialFailed>
          {children}
        </CommsProvider>
      );
    }
    const { result } = renderHook(() => useStore(), { wrapper: Wrapper });

    // Nothing has loaded, so there is no moment the view was current to date it by.
    expect(result.current.sync).toMatchObject({ loaded: false, live: false });
    expect(result.current.sync.notLiveSince).toBeUndefined();
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
    await failing.reject();
    expect(result.current.sync).toMatchObject({ loaded: false, notLiveSince: undefined });

    act(() => {
      setTabHidden(false);
    });
    await read.resolve(LATER);

    // The rows are in, but with no channel joined the view still can't say it is live.
    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    expect(result.current.sync).toMatchObject({ loaded: true, live: false });
    expect(Date.parse(result.current.sync.notLiveSince ?? '')).toBeGreaterThan(
      Date.parse(failed.readAt),
    );
  });

  it('re-reads the counts within a bounded wait, however long a burst of message changes runs', async () => {
    await renderJoined();
    jest.useFakeTimers();
    // A change every half-settle: waiting for the burst to settle alone would never re-read.
    const step = COMMS_COUNTS_SETTLE_MS / 2;
    const change = () => {
      mockRealtimeHandlers.get('comm_messages')?.(payload<CommMessage>('INSERT', ARRIVED) as never);
      jest.advanceTimersByTime(step);
    };
    act(() => {
      for (let elapsed = step; elapsed < COMMS_COUNTS_MAX_WAIT_MS; elapsed += step) change();
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    act(change);

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('re-reads the counts once a burst of message changes settles', async () => {
    const { result } = await renderJoined();
    mockApi.fetchCommsSnapshot.mockResolvedValue({ ...LATER, shelfCount: 7 });

    act(() => {
      mockRealtimeHandlers.get('comm_messages')?.(payload<CommMessage>('INSERT', ARRIVED) as never);
    });

    await waitFor(
      () => {
        expect(result.current.counts.shelfCount).toBe(7);
      },
      { timeout: 3000 },
    );
  });

  /** A shelf ten rows longer than one page. */
  const LONG_SHELF = Array.from({ length: SHELF_PAGE_SIZE + 10 }, () =>
    makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }),
  );

  it('loads the next shelf page through the same read, asked for more', async () => {
    const { result } = await renderJoined(makeCommsSeed({ messages: LONG_SHELF }));

    act(() => {
      result.current.actions.showMoreShelf();
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenLastCalledWith(SHELF_PAGE_SIZE * 2);
  });

  it('asks for no more of the shelf than there is', async () => {
    const { result } = await renderJoined(makeCommsSeed({ messages: LONG_SHELF }));
    mockApi.fetchCommsSnapshot.mockResolvedValue(
      makeCommsSeed({ messages: LONG_SHELF, shelfLimit: SHELF_PAGE_SIZE * 2 }),
    );

    // Pressed twice before the page lands: the second can't reach past the shelf's last page.
    act(() => {
      result.current.actions.showMoreShelf();
      result.current.actions.showMoreShelf();
    });
    await waitFor(() => {
      expect(result.current.shelf).toHaveLength(LONG_SHELF.length);
    });
    // Every row is held: there is nothing more to ask for.
    act(() => {
      result.current.actions.showMoreShelf();
    });

    expect(mockApi.fetchCommsSnapshot.mock.calls.map(([shelf]) => shelf)).toEqual([
      SHELF_PAGE_SIZE,
      SHELF_PAGE_SIZE * 2,
      SHELF_PAGE_SIZE * 2,
    ]);
  });

  it('never asks for more of the shelf than the snapshot route serves', async () => {
    const vast = { ...makeCommsSeed({ messages: LONG_SHELF }), shelfCount: SHELF_LIMIT_MAX * 2 };
    const { result } = await renderJoined(vast);
    mockApi.fetchCommsSnapshot.mockResolvedValue(vast);

    act(() => {
      for (let press = 0; press <= SHELF_LIMIT_MAX / SHELF_PAGE_SIZE; press += 1) {
        result.current.actions.showMoreShelf();
      }
    });

    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenLastCalledWith(SHELF_LIMIT_MAX);
    });
  });
});
