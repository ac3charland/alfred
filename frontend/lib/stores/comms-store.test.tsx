import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { act, renderHook } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeCommAccount,
  makeCommHealth,
  makeCommMessage,
  makeCommVerdict,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import type {
  CommAccount,
  CommClassifierHealth,
  CommMessage,
  CommVerdict,
  Item,
} from '@/lib/types';

import {
  CommsProvider,
  accountStreamAction,
  commsReducer,
  healthStreamValue,
  messageStreamAction,
  useCommsAccounts,
  useCommsActions,
  useCommsHealth,
  useCommsMessages,
  useCommsVerdicts,
  useQueueCount,
  useQueuedByTier,
  useShelf,
  verdictStreamAction,
} from './comms-store';

// The store opens a realtime channel on mount; stub the browser client so the subscription is
// inert and the tests drive the reducer directly. The provider subscribes one channel PER TABLE
// (comm_messages, comm_accounts, comm_classifier_health, comm_verdicts), so the stub keys each
// captured handler by the filter's table — capturing a single handler would let a later
// subscription silently overwrite an earlier one (see the supabase skill).
const mockRealtimeHandlers = new Map<string, (payload: never) => void>();
const mockRemoveChannel = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => {
      const chan = {
        on: (_event: string, filter: { table?: string }, handler: (payload: never) => void) => {
          if (filter.table !== undefined) mockRealtimeHandlers.set(filter.table, handler);
          return chan;
        },
        subscribe: () => chan,
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

beforeEach(() => {
  resetCommFixtureClock();
  jest.clearAllMocks();
  mockRealtimeHandlers.clear();
});

describe('commsReducer', () => {
  const empty = { accounts: [], messages: [], verdictsById: {}, health: undefined };

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
    const state = commsReducer(empty, { type: 'verdicts', verdicts: [verdict] });
    expect(state.verdictsById[verdict.id]).toBe(verdict);
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
      patch: judged,
    });
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
  it('upserts a self-registering account, patches an update, removes a delete', () => {
    const account = makeCommAccount('personal');
    expect(accountStreamAction(payload<CommAccount>('INSERT', account))).toEqual({
      type: 'upsert',
      items: [account],
    });
    expect(accountStreamAction(payload<CommAccount>('UPDATE', account))).toEqual({
      type: 'patch',
      ids: [account.id],
      patch: account,
    });
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
  it('adds an arriving verdict', () => {
    const verdict = makeCommVerdict('m1');
    expect(verdictStreamAction(payload<CommVerdict>('INSERT', verdict))).toEqual([verdict]);
  });

  it('ignores an update or a delete — verdicts are an append-only audit log, never revised in place', () => {
    const verdict = makeCommVerdict('m1');
    expect(verdictStreamAction(payload<CommVerdict>('UPDATE', verdict))).toBeNull();
    expect(verdictStreamAction(payload<CommVerdict>('DELETE', { id: verdict.id }))).toBeNull();
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
  };
}

function makeWrapper(messages: CommMessage[] = [QUEUED, SHELVED]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CommsProvider
        initialAccounts={[makeCommAccount('personal')]}
        initialMessages={messages}
        initialVerdicts={[makeCommVerdict(QUEUED.id)]}
        initialHealth={makeCommHealth()}
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
