import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  COMMS_LIVE_WINDOW_MS,
  COMMS_POLL_MS,
  SHELF_LIMIT_MAX,
  SHELF_PAGE_SIZE,
  isCommsLive,
} from '@/lib/comms';
import {
  makeCommAccount,
  makeCommHealth,
  makeCommMessage,
  makeCommVerdict,
  makeCommsSeed,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import type { CommMessage, CommsSeed, Item } from '@/lib/types';

import {
  CommsProvider,
  commsReducer,
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
} from './comms-store';

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
  // No test is about the read landing unless it says so — a hanging promise means an
  // unexpected trigger fails loudly (an unresolved `act`) rather than reconciling silently.
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

  it('starts a shell whose read failed unloaded, with nothing to date it by', () => {
    const unloaded = stateFromSeed(makeCommsSeed(), true);

    expect(unloaded).toMatchObject({ loaded: false, lastReadAt: null });
    expect(empty.loaded).toBe(true);
    // The client's own clock, captured at mount.
    expect(empty.lastReadAt).not.toBeNull();
  });

  it('is loaded by the first read that lands, dated to when it started', () => {
    const unloaded = stateFromSeed(makeCommsSeed(), true);
    const startedAt = '2026-09-09T12:08:00.000Z';

    expect(commsReducer(unloaded, { type: 'read', startedAt })).toMatchObject({
      loaded: true,
      lastReadAt: startedAt,
    });
    // A snapshot alone replaces the rows; it is the read landing that says anything is loaded.
    expect(
      commsReducer(unloaded, { type: 'snapshot', seed: makeCommsSeed(), keep: new Set() }).loaded,
    ).toBe(false);
  });

  it('holds a row with a write in flight through a snapshot, rather than reverting it', () => {
    const message = makeCommMessage(ACCOUNT, { id: 'm1', tier: 'today' });
    const held = commsReducer(empty, {
      type: 'messages',
      action: { type: 'upsert', items: [message] },
    });
    const optimistic = commsReducer(held, {
      type: 'messages',
      action: { type: 'patch', ids: ['m1'], patch: { tier: 'asap' } },
    });

    const stale = commsReducer(optimistic, {
      type: 'snapshot',
      seed: makeCommsSeed({ messages: [message] }),
      keep: new Set(['m1']),
    });

    expect(stale.messages.find((row) => row.id === 'm1')?.tier).toBe('asap');
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
    expect(result.current.sync.loaded).toBe(true);
    expect(result.current.sync.lastReadAt).not.toBeNull();
  });

  it('counts nothing while unloaded, even though the failed seed carried rows', () => {
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <CommsProvider initialSeed={makeCommsSeed({ messages: [QUEUED] })} initialFailed>
          {children}
        </CommsProvider>
      );
    }
    const { result } = renderHook(() => useStore(), { wrapper: Wrapper });

    expect(result.current.count).toBe(0);
    expect(result.current.sync.loaded).toBe(false);
  });

  it('throws outside a provider, naming the hook that asked', () => {
    expect(() => renderHook(() => useCommsMessages())).toThrow(
      'useCommsMessages must be used within a CommsProvider',
    );
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

  it('rolls back ONLY what it changed, leaving a field a re-read moved meanwhile alone', async () => {
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
    // A concurrent local change to an unrelated field.
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

  it('re-throws when the purge fails, without toasting — PurgePanel shows the error in context', async () => {
    mockApi.purgeComms.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await expect(result.current.actions.purge({ message_id: QUEUED.id })).rejects.toThrow('boom');
    });

    expect(result.current.messages).toHaveLength(2);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('re-reads the snapshot once a purge lands, for every selector — not just the message one', async () => {
    mockApi.purgeComms.mockResolvedValue({ purged: 12 });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await act(async () => {
      await result.current.actions.purge({ account_id: ACCOUNT });
    });

    // An account/date-range purge has no id list to remove locally, so a re-read is the only
    // thing that can bring the queue and shelf up to date with what the server actually purged.
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalled();
  });
});

/** Shadow `document.hidden` — a read-only getter in jsdom — and fire what that change fires. */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
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

/** Whether a store's current sync state reads as live right now. */
function live(sync: { loaded: boolean; lastReadAt: string | null }): boolean {
  return isCommsLive(sync.loaded, sync.lastReadAt, new Date());
}

/**
 * What a browser tab coming back online fires — the simplest of the four re-read triggers —
 * flushed past the one microtask a resolved (or rejected) read takes to reach the store.
 */
async function fireOnline(): Promise<void> {
  await act(async () => {
    globalThis.dispatchEvent(new Event('online'));
    await Promise.resolve();
  });
}

/**
 * ALF-258 / the move off Realtime. The view has to be a true reflection of the server however
 * the tab got here, and it now gets there by POLLING the snapshot — every {@link COMMS_POLL_MS}
 * while visible, plus a handful of triggers that mean it may have missed something sooner.
 */
describe('CommsProvider — polling and recovery', () => {
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
  });

  it('polls every 30s while the tab is visible', async () => {
    jest.useFakeTimers();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTimeAsync(COMMS_POLL_MS));
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    await act(() => jest.advanceTimersByTimeAsync(COMMS_POLL_MS));
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
  });

  it('does not poll while the tab is hidden', async () => {
    jest.useFakeTimers();
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    renderHook(() => useStore(), { wrapper: makeWrapper() });
    act(() => {
      setTabHidden(true);
    });

    await act(() => jest.advanceTimersByTimeAsync(COMMS_POLL_MS * 3));

    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();
  });

  it('re-reads when the tab returns to the front', () => {
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      setTabHidden(true);
    });
    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();
    act(() => {
      setTabHidden(false);
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('re-reads a page restored from the back/forward cache, not an ordinary pageshow', () => {
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    });
    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();

    act(() => {
      globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the browser comes back online', () => {
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a plain focus event — a visible tab missed nothing', () => {
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    act(() => {
      globalThis.dispatchEvent(new Event('focus'));
    });

    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();
  });

  it('reconcile() re-reads immediately — the action CommsView fires on navigation (ALF-246)', async () => {
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(mockApi.fetchCommsSnapshot).not.toHaveBeenCalled();

    await act(async () => {
      result.current.actions.reconcile();
      await Promise.resolve();
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
  });

  it('brings the view up to date on a re-read — new rows in, purged rows out', async () => {
    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await fireOnline();

    await waitFor(() => {
      expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
    });
    expect(result.current.shelf).toEqual([]);
  });

  it('leaves the messages and lastReadAt alone when a read fails', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    const before = result.current.sync.lastReadAt;
    mockApi.fetchCommsSnapshot.mockRejectedValue(new Error('offline'));

    await fireOnline();

    expect(result.current.sync.lastReadAt).toBe(before);
    expect(result.current.messages).toHaveLength(2);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('runs one more read when a trigger lands mid-read, rather than dropping it', async () => {
    const read = holdSnapshot();
    renderHook(() => useStore(), { wrapper: makeWrapper() });

    await fireOnline();
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    mockApi.fetchCommsSnapshot.mockResolvedValue(makeCommsSeed());
    await fireOnline();
    // Still one in flight — the second trigger only asked for one more once this settles.
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    await read.resolve(makeCommsSeed());

    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps a local dispatch made while a read is in flight, replayed over the snapshot', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    const read = holdSnapshot();

    await fireOnline();
    // The read was taken before this local patch; a store with no replay would drop it once the
    // (older) snapshot it raced lands.
    act(() => {
      result.current.actions.patchMessageLocally(QUEUED.id, { tier: 'asap' });
    });
    await read.resolve(makeCommsSeed({ messages: [QUEUED, SHELVED] }));

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([QUEUED.id]);
  });

  it('never reverts a row whose write is still in flight', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
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

    await fireOnline();
    await waitFor(() => {
      expect(result.current.sync.lastClassifiedAt).toBe(stale.lastClassifiedAt);
    });

    expect(result.current.byTier.today).toEqual([]);
  });

  it('re-reads after a write fails, since its row was held back from any read meanwhile', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
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
    await fireOnline();
    await waitFor(() => {
      expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      write.reject(new Error('boom'));
      await clearing;
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(result.current.byTier.asap.map((message) => message.id)).toEqual([QUEUED.id]);
    });
  });

  it('marks a reconcile attempt as it launches, and clears it once a fresh snapshot lands', async () => {
    const read = holdSnapshot();
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(result.current.sync.lastReconcileAttemptAt).toBeNull();

    await fireOnline();
    expect(result.current.sync.lastReconcileAttemptAt).not.toBeNull();

    await read.resolve(makeCommsSeed());
    expect(result.current.sync.lastReconcileAttemptAt).toBeNull();
  });

  it('leaves the attempt marked after a failed reconcile — the next retry still gets its grace', async () => {
    const read = holdSnapshot();
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });

    await fireOnline();
    const attemptedAt = result.current.sync.lastReconcileAttemptAt;
    expect(attemptedAt).not.toBeNull();

    await read.reject();
    expect(result.current.sync.lastReconcileAttemptAt).toBe(attemptedAt);
  });

  it('starts a shell whose read failed unloaded, and reads on mount without waiting for a poll', async () => {
    const failing = holdSnapshot();
    const failed = makeCommsSeed();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <CommsProvider initialSeed={failed} initialFailed>
          {children}
        </CommsProvider>
      );
    }
    const { result } = renderHook(() => useStore(), { wrapper: Wrapper });

    // Nothing has loaded, so there is no moment the view was current to date it by.
    expect(result.current.sync).toMatchObject({ loaded: false, lastReadAt: null });
    expect(mockApi.fetchCommsSnapshot).toHaveBeenCalledTimes(1);

    await failing.reject();
    expect(result.current.sync).toMatchObject({ loaded: false, lastReadAt: null });

    mockApi.fetchCommsSnapshot.mockResolvedValue(LATER);
    await fireOnline();
    await waitFor(() => {
      expect(result.current.sync.loaded).toBe(true);
    });

    expect(result.current.byTier.asap.map((message) => message.id)).toEqual([ARRIVED.id]);
  });
});

/**
 * Liveness is derived, not tracked: `lib/comms/live.ts`'s `isCommsLive` against the store's own
 * `loaded`/`lastReadAt`. Nothing here is an event the store could fail to fire — a stale view is
 * just what the subtraction says once enough real time (or a clock jump) has gone by.
 */
describe('CommsProvider — liveness', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Enough failed polls, back to back, to walk the clock just past the live window. */
  const JUST_PAST_THE_WINDOW = Math.ceil(COMMS_LIVE_WINDOW_MS / COMMS_POLL_MS) * COMMS_POLL_MS;

  it('is live right after the shell seed, and goes not live once every poll fails for long enough', async () => {
    jest.useFakeTimers();
    mockApi.fetchCommsSnapshot.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(live(result.current.sync)).toBe(true);

    // Every poll fails, so `lastReadAt` never moves while fake time keeps advancing past it.
    await act(() => jest.advanceTimersByTimeAsync(JUST_PAST_THE_WINDOW));

    expect(live(result.current.sync)).toBe(false);
    expect(Date.now() - Date.parse(result.current.sync.lastReadAt ?? '')).toBeGreaterThan(
      COMMS_LIVE_WINDOW_MS,
    );
  });

  it('is live again the moment a read lands', async () => {
    jest.useFakeTimers();
    mockApi.fetchCommsSnapshot.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    await act(() => jest.advanceTimersByTimeAsync(JUST_PAST_THE_WINDOW));
    expect(live(result.current.sync)).toBe(false);

    mockApi.fetchCommsSnapshot.mockResolvedValue(makeCommsSeed());
    await act(() => jest.advanceTimersByTimeAsync(COMMS_POLL_MS));

    expect(live(result.current.sync)).toBe(true);
  });

  it('goes not live after a wall-clock jump, as a sleeping machine would produce', () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper() });
    expect(live(result.current.sync)).toBe(true);

    // Timers freeze while it sleeps; only the clock itself jumps forward.
    jest.setSystemTime(Date.now() + 60 * 60 * 1000);

    expect(live(result.current.sync)).toBe(false);
  });
});

describe('CommsProvider — shelf paging', () => {
  /** A shelf ten rows longer than one page. */
  const LONG_SHELF = Array.from({ length: SHELF_PAGE_SIZE + 10 }, () =>
    makeCommMessage(ACCOUNT, { tier: 'fyi', judged_by: 'model' }),
  );

  it('loads the next shelf page through the same read, asked for more', () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(LONG_SHELF) });

    act(() => {
      result.current.actions.showMoreShelf();
    });

    expect(mockApi.fetchCommsSnapshot).toHaveBeenLastCalledWith(SHELF_PAGE_SIZE * 2);
  });

  it('asks for no more of the shelf than there is', async () => {
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(LONG_SHELF) });
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
      SHELF_PAGE_SIZE * 2,
      SHELF_PAGE_SIZE * 2,
    ]);
  });

  it('never asks for more of the shelf than the snapshot route serves', async () => {
    const vast = { ...makeCommsSeed({ messages: LONG_SHELF }), shelfCount: SHELF_LIMIT_MAX * 2 };
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(LONG_SHELF) });
    mockApi.fetchCommsSnapshot.mockResolvedValue(vast);
    // A read has to land first so the store knows the shelf's true (vast) size — otherwise
    // every press below clamps to the seed's own smaller count instead.
    await fireOnline();
    await waitFor(() => {
      expect(result.current.counts.shelfCount).toBe(vast.shelfCount);
    });

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
