import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeReaderHealth,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderHealthSnapshot, ReaderOverview, ReaderPostListItem } from '@/lib/types';

import {
  ARCHIVE_READ_LIMIT,
  ReaderProvider,
  type ReaderState,
  readerReducer,
  useActiveCount,
  useArchiveStatus,
  useArchivedPosts,
  useReaderActions,
  useReaderHealth,
  useReaderHealthReconcileStartedAt,
  useReaderPosts,
  useWikiSendInFlight,
} from './reader-store';

// A partial mock: the request wrappers are stubbed, but `ApiError` stays the real class, since
// the re-summarise verb distinguishes a refusal the owner should read from a fault it shouldn't.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual<typeof import('@/lib/api-client')>('@/lib/api-client'),
  fetchReaderPosts: jest.fn(),
  fetchReaderHealth: jest.fn(),
  patchReaderPost: jest.fn(),
  sendReaderIdeasToWiki: jest.fn(),
}));
const mockApi = jest.mocked(api);

const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

const PUBLICATION = makeReaderPublication('Second Thoughts', {
  id: '00000000-0000-4000-8000-000000000001',
});

function post(
  overrides: Partial<Omit<ReaderPostListItem, 'overview'>> & {
    overview?: ReaderOverview | null;
  } = {},
): ReaderPostListItem {
  const { text: _text, ...listItem } = makeReaderPost(PUBLICATION.id, overrides);
  return listItem;
}

function useStore() {
  return {
    actions: useReaderActions(),
    posts: useReaderPosts(),
    count: useActiveCount(),
  };
}

/** Drain every pending microtask — a settled request's whole `.then`/`.catch`/`.finally` chain. */
async function flush(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A promise the test settles by hand, so one request can be held in flight. */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** Nothing read yet — the shape the shell hands the provider when neither read answered. */
const NO_HEALTH: ReaderHealthSnapshot = { health: undefined, account: undefined };

/** A reducer state at rest: the posts under test, no health read and no archive read. */
function state(posts: ReaderPostListItem[], health: ReaderHealthSnapshot = NO_HEALTH): ReaderState {
  return {
    posts,
    health,
    archiveStatus: 'idle',
    archiveFull: false,
    healthReconcileStartedAt: null,
    wikiSendsInFlight: [],
  };
}

function makeWrapper(posts: ReaderPostListItem[], health: ReaderHealthSnapshot = NO_HEALTH) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ReaderProvider initialPosts={posts} initialHealth={health}>
        {children}
      </ReaderProvider>
    );
  };
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
  // Every return-to-the-foreground re-reads BOTH surfaces, so the health read needs an answer in
  // any test that fires one, even where the list is what's under assertion.
  mockApi.fetchReaderHealth.mockResolvedValue(NO_HEALTH);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('readerReducer', () => {
  it('patches a post by id', () => {
    const original = post({ id: 'p-1', title: 'Original' });
    const next = readerReducer(state([original]), {
      type: 'posts',
      action: { type: 'patch', ids: ['p-1'], patch: { title: 'Patched' } },
    });
    expect(next.posts[0]?.title).toBe('Patched');
  });

  it('is a no-op for a patch naming an id it no longer holds', () => {
    const before = state([post({ id: 'p-1' })]);
    const next = readerReducer(before, {
      type: 'posts',
      action: { type: 'patch', ids: ['gone'], patch: { title: 'x' } },
    });
    expect(next).toEqual(before);
  });

  it('replaces the whole list on replaceAll', () => {
    const before = state([post({ id: 'p-1' }), post({ id: 'p-2' })]);
    const replacement = [post({ id: 'p-3' })];
    const next = readerReducer(before, { type: 'replaceAll', posts: replacement, keep: [] });
    expect(next.posts).toEqual(replacement);
  });

  it('keeps the local row for every id replaceAll is told to keep', () => {
    const local = post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' });
    const fromServer = post({ id: 'p-1', archived_at: null });
    const next = readerReducer(state([local]), {
      type: 'replaceAll',
      posts: [fromServer, post({ id: 'p-2' })],
      keep: ['p-1'],
    });
    expect(next.posts[0]).toBe(local);
    expect(next.posts).toHaveLength(2);
  });

  it('holds a kept row the server no longer lists — this tab wrote it after the read left', () => {
    // An unarchive still settling: the read went out before the write reached the server, so the
    // active list it came back with cannot speak for this row either way.
    const local = post({ id: 'p-1', archived_at: null });
    const next = readerReducer(state([local]), { type: 'replaceAll', posts: [], keep: ['p-1'] });
    expect(next.posts).toEqual([local]);
  });

  it('keeps every archived row the active read cannot see', () => {
    const archived = post({ id: 'p-archived', archived_at: '2026-09-18T09:00:00.000Z' });
    const active = post({ id: 'p-active' });
    const next = readerReducer(state([archived, active]), {
      type: 'replaceAll',
      posts: [active],
      keep: [],
    });
    expect(next.posts.map((p) => p.id)).toEqual(['p-active', 'p-archived']);
  });

  it('drops an active row the read no longer lists and this tab never touched', () => {
    // Archived on another tab — the read IS the authority for a row nobody here wrote.
    const gone = post({ id: 'p-gone' });
    const next = readerReducer(state([gone]), { type: 'replaceAll', posts: [], keep: [] });
    expect(next.posts).toEqual([]);
  });

  it('never lists a row twice, whichever rule holds it', () => {
    const archived = post({ id: 'p-archived', archived_at: '2026-09-18T09:00:00.000Z' });
    const written = post({ id: 'p-written' });
    const next = readerReducer(state([archived, written]), {
      type: 'replaceAll',
      posts: [post({ id: 'p-written' }), post({ id: 'p-fresh' })],
      keep: ['p-written'],
    });
    const ids = next.posts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
  });

  it('folds the archive read into the one post list and records how full it came back', () => {
    const held = post({ id: 'p-held' });
    const next = readerReducer(state([held]), {
      type: 'archiveRead',
      posts: [
        post({ id: 'p-held', archived_at: '2026-09-18T09:00:00.000Z' }),
        post({ id: 'p-new' }),
      ],
      full: true,
      keep: [],
    });
    expect(next.posts).toHaveLength(2);
    expect(next.posts[0]?.archived_at).toBe('2026-09-18T09:00:00.000Z');
    expect(next.archiveStatus).toBe('loaded');
    expect(next.archiveFull).toBe(true);
  });

  it('keeps the local row for every id the archive read is told to keep', () => {
    const local = post({ id: 'p-1', archived_at: null });
    const next = readerReducer(state([local]), {
      type: 'archiveRead',
      posts: [post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' })],
      full: false,
      keep: ['p-1'],
    });
    expect(next.posts[0]).toBe(local);
    expect(next.archiveStatus).toBe('loaded');
  });

  it('takes a kept row the store no longer holds from the read — there is nothing to defend', () => {
    const fromServer = post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' });
    const next = readerReducer(state([]), {
      type: 'archiveRead',
      posts: [fromServer],
      full: false,
      keep: ['p-1'],
    });
    expect(next.posts).toEqual([fromServer]);
  });

  it('records a failed archive read without touching the list', () => {
    const held = post({ id: 'p-1' });
    const next = readerReducer(state([held]), { type: 'archiveStatus', status: 'failed' });
    expect(next.archiveStatus).toBe('failed');
    expect(next.posts).toEqual([held]);
  });

  it('marks a health reconcile attempt as it launches', () => {
    const startedAt = '2026-09-18T09:00:00.000Z';
    const next = readerReducer(state([]), { type: 'healthReconcileAttempt', startedAt });
    expect(next.healthReconcileStartedAt).toBe(startedAt);
  });

  it('clears a marked attempt once a fresh health snapshot lands', () => {
    const before = {
      ...state([]),
      healthReconcileStartedAt: '2026-09-18T09:00:00.000Z',
    };
    const next = readerReducer(before, {
      type: 'health',
      snapshot: { health: undefined, account: undefined },
    });
    expect(next.healthReconcileStartedAt).toBeNull();
  });
});

describe('ReaderProvider selectors', () => {
  it('orders posts newest arrival first and excludes archived rows', () => {
    const older = post({ id: 'p-older', received_at: '2026-09-14T09:00:00.000Z' });
    const newer = post({ id: 'p-newer', received_at: '2026-09-16T09:00:00.000Z' });
    const archived = post({
      id: 'p-archived',
      received_at: '2026-09-17T09:00:00.000Z',
      archived_at: '2026-09-17T10:00:00.000Z',
    });
    const { result } = renderHook(() => useStore(), {
      wrapper: makeWrapper([older, newer, archived]),
    });

    expect(result.current.posts.map((p) => p.id)).toEqual(['p-newer', 'p-older']);
  });

  it('counts every unarchived post regardless of summary state', () => {
    const posts = [
      post({ id: 'p-1', summary_state: 'pending' }),
      post({ id: 'p-2', summary_state: 'failed' }),
      post({ id: 'p-3', archived_at: '2026-09-16T09:00:00.000Z' }),
    ];
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(posts) });

    expect(result.current.count).toBe(2);
  });

  it('throws outside a provider, naming the hook that asked', () => {
    expect(() => renderHook(() => useReaderPosts())).toThrow(
      'useReaderPosts must be used within a ReaderProvider',
    );
  });
});

describe('archive', () => {
  it('applies the change immediately and reconciles with the server row', async () => {
    const row = post({ id: 'p-1' });
    const saved: ReaderPostListItem = { ...row, archived_at: '2026-09-18T09:00:00.000Z' };
    mockApi.patchReaderPost.mockResolvedValue(saved);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await result.current.actions.archive('p-1');
    });

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: true });
    expect(result.current.posts).toHaveLength(0);
    expect(result.current.count).toBe(0);
  });

  it('removes the row from the list optimistically, before the server answers', () => {
    const row = post({ id: 'p-1' });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      void result.current.actions.archive('p-1');
    });

    expect(result.current.posts).toHaveLength(0);
  });

  it('rolls back and toasts on failure', async () => {
    const row = post({ id: 'p-1' });
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await expect(result.current.actions.archive('p-1')).rejects.toThrow('boom');
    });

    expect(result.current.posts).toHaveLength(1);
    expect(result.current.posts[0]?.archived_at).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't archive that post");
  });

  it('rolls back ONLY the field it touched, leaving a concurrent change alone', async () => {
    const row = post({ id: 'p-1', opened_at: null });
    const openedByServer = { ...row, opened_at: '2026-09-18T09:05:00.000Z' };
    mockApi.patchReaderPost.mockImplementation((_id, body) =>
      'archived' in body ? Promise.reject(new Error('boom')) : Promise.resolve(openedByServer),
    );
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    const failing = act(async () => {
      await expect(result.current.actions.archive('p-1')).rejects.toThrow('boom');
    });
    // A concurrent, unrelated write — markOpened's own local stamp — landing while the archive
    // is still in flight.
    act(() => {
      result.current.actions.markOpened('p-1');
    });
    await failing;

    expect(result.current.posts[0]?.archived_at).toBeNull();
    expect(result.current.posts[0]?.opened_at).not.toBeNull();
  });
});

describe('markOpened', () => {
  it('stamps opened_at locally without waiting for the server', () => {
    const row = post({ id: 'p-1', opened_at: null });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.markOpened('p-1');
    });

    expect(result.current.posts[0]?.opened_at).not.toBeNull();
    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { opened: true });
  });

  it('reconciles opened_at alone, so a late answer cannot un-archive the row', async () => {
    // The Open PATCH was sent first and answers with the row as it was then — unarchived. Taking
    // that whole row would undo the archive the owner asked for a moment later.
    const row = post({ id: 'p-1', opened_at: null });
    const openCall = deferred<ReaderPostListItem>();
    const archiveCall = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockImplementation((_id, body) =>
      'opened' in body ? openCall.promise : archiveCall.promise,
    );
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.markOpened('p-1');
    });
    act(() => {
      void result.current.actions.archive('p-1');
    });

    await act(async () => {
      openCall.settle({ ...row, opened_at: '2026-09-18T09:05:00.000Z' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.posts).toHaveLength(0);
    expect(result.current.count).toBe(0);
  });

  it('is not un-stamped by a read the write left too late to be in', async () => {
    // The read was issued while the Open PATCH was still in flight, so its answer describes the
    // row as it was before the stamp — taking it would rub the stamp out.
    const row = post({ id: 'p-1', opened_at: null });
    const openCall = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockReturnValue(openCall.promise);
    mockApi.fetchReaderPosts.mockResolvedValue([row]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.markOpened('p-1');
    });
    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await flush();
    });

    expect(result.current.posts[0]?.opened_at).not.toBeNull();
  });

  it('neither rolls back nor toasts when the write fails', async () => {
    const row = post({ id: 'p-1', opened_at: null });
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      result.current.actions.markOpened('p-1');
      // Let the rejected promise's .then/.catch settle.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.posts[0]?.opened_at).not.toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

/** Shadow `document.hidden` — a read-only getter in jsdom — and fire what that change fires. */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('refresh', () => {
  it('re-reads the list on focus and replaces it', async () => {
    const initial = [post({ id: 'p-1' })];
    const fromServer = [post({ id: 'p-2' })];
    mockApi.fetchReaderPosts.mockResolvedValue(fromServer);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(initial) });

    act(() => {
      globalThis.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['p-2']);
    });
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledWith({ scope: 'active' });
  });

  it('re-reads on the tab returning to the foreground', async () => {
    const fromServer = [post({ id: 'p-fresh' })];
    mockApi.fetchReaderPosts.mockResolvedValue(fromServer);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([]) });

    act(() => {
      setTabHidden(false);
    });

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['p-fresh']);
    });
  });

  it('does not re-read while the tab is hidden', () => {
    mockApi.fetchReaderPosts.mockResolvedValue([]);
    renderHook(() => useStore(), { wrapper: makeWrapper([]) });

    act(() => {
      setTabHidden(true);
    });

    expect(mockApi.fetchReaderPosts).not.toHaveBeenCalled();
  });

  it('collapses a focus and a visibilitychange landing together into one request', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([]) });

    act(() => {
      result.current.actions.refresh();
      result.current.actions.refresh();
    });

    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    });
  });

  it('does not resurrect a row whose archive is still in flight', async () => {
    // The refresh's answer was read on the server BEFORE the archive reached it, so replacing the
    // list wholesale would put the row the owner just archived back on screen.
    const row = post({ id: 'p-1' });
    const archiveCall = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockReturnValue(archiveCall.promise);
    mockApi.fetchReaderPosts.mockResolvedValue([row]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    let archiving: Promise<ReaderPostListItem> | undefined;
    act(() => {
      archiving = result.current.actions.archive('p-1');
    });
    act(() => {
      result.current.actions.refresh();
    });
    // Let the read's answer land while the archive is STILL in flight.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    expect(result.current.posts).toHaveLength(0);

    await act(async () => {
      archiveCall.settle({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
      await archiving;
    });
    expect(result.current.posts).toHaveLength(0);
  });

  it('holds back a row whose write finishes while the read is in flight, if it started earlier', async () => {
    // The archive PATCH started BEFORE the read was issued and was still pending at that
    // instant — so even though it settles and reconciles while the read is still in the air,
    // the read's answer (taken before the archive reached the server) cannot speak for this row.
    const row = post({ id: 'p-1' });
    const archiveCall = deferred<ReaderPostListItem>();
    const read = deferred<ReaderPostListItem[]>();
    mockApi.patchReaderPost.mockReturnValue(archiveCall.promise);
    mockApi.fetchReaderPosts.mockReturnValue(read.promise);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    let archiving: Promise<ReaderPostListItem> | undefined;
    act(() => {
      archiving = result.current.actions.archive('p-1');
    });
    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      archiveCall.settle({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
      await archiving;
    });
    expect(result.current.posts).toHaveLength(0);

    // The read's answer lands last, with the pre-archive list — stale for this row.
    await act(async () => {
      read.settle([row]);
      await flush();
    });

    expect(result.current.posts).toHaveLength(0);
  });

  it('does not resurrect a row archived after the read was issued', async () => {
    // The mirror image of the case above: the archive's PATCH has already ANSWERED by the time
    // the read's answer lands, so nothing is in flight any more — but the read left the server
    // before the archive reached it, so its list is just as stale for that row.
    const row = post({ id: 'p-1' });
    const read = deferred<ReaderPostListItem[]>();
    mockApi.fetchReaderPosts.mockReturnValue(read.promise);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await result.current.actions.archive('p-1');
    });
    expect(result.current.posts).toHaveLength(0);

    await act(async () => {
      read.settle([row]);
      await flush();
    });

    expect(result.current.posts).toHaveLength(0);
  });

  it('takes the server list verbatim once a later read has been issued', async () => {
    // The guard is scoped to ONE read: a mutation the next request was issued after is a
    // mutation that request can answer for, so its row stops being held back.
    const row = post({ id: 'p-1' });
    const firstRead = deferred<ReaderPostListItem[]>();
    mockApi.fetchReaderPosts.mockReturnValueOnce(firstRead.promise).mockResolvedValue([row]);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: '2026-09-18T09:00:00.000Z' });
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await result.current.actions.archive('p-1');
      firstRead.settle([row]);
      await flush();
    });
    expect(result.current.posts).toHaveLength(0);

    act(() => {
      result.current.actions.refresh();
    });

    await waitFor(() => {
      expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);
    });
  });

  it('holds a row back until the LAST of two overlapping writes on it has settled', async () => {
    // An Open stamp and an archive in flight on one row. The stamp answers first; the archive
    // has still not reached the server, so a read issued now cannot speak for the row — a
    // protection keyed on "is anything in flight" rather than "how many" would have dropped it
    // when the first of the two settled.
    const row = post({ id: 'p-1', opened_at: null });
    const openCall = deferred<ReaderPostListItem>();
    const archiveCall = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockImplementation((_id, body) =>
      'opened' in body ? openCall.promise : archiveCall.promise,
    );
    mockApi.fetchReaderPosts.mockResolvedValue([row]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.markOpened('p-1');
    });
    let archiving: Promise<ReaderPostListItem> | undefined;
    act(() => {
      archiving = result.current.actions.archive('p-1');
    });
    await act(async () => {
      openCall.settle({ ...row, opened_at: '2026-09-18T09:05:00.000Z' });
      await flush();
    });

    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await flush();
    });
    expect(result.current.posts).toHaveLength(0);

    await act(async () => {
      archiveCall.settle({ ...row, archived_at: '2026-09-18T09:06:00.000Z' });
      await archiving;
    });
    expect(result.current.posts).toHaveLength(0);
  });

  it('keeps the last known list when the re-read fails, and stays silent about it', async () => {
    const initial = [post({ id: 'p-1' })];
    mockApi.fetchReaderPosts.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper(initial) });

    act(() => {
      result.current.actions.refresh();
    });

    await waitFor(() => {
      expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    });
    expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

describe('the health slice', () => {
  it('exposes the snapshot the shell seeded it with', () => {
    const snapshot: ReaderHealthSnapshot = { health: makeReaderHealth('live'), account: undefined };
    const { result } = renderHook(() => useReaderHealth(), {
      wrapper: makeWrapper([], snapshot),
    });

    expect(result.current).toEqual(snapshot);
  });

  it('replaces the whole snapshot rather than merging into it', () => {
    const before: ReaderHealthSnapshot = {
      health: makeReaderHealth('live'),
      account: undefined,
    };
    const after: ReaderHealthSnapshot = { health: undefined, account: undefined };

    const next = readerReducer(state([post({ id: 'p-1' })], before), {
      type: 'health',
      snapshot: after,
    });

    expect(next.health).toEqual(after);
    // A health read says nothing about the list, and vice versa.
    expect(next.posts).toHaveLength(1);
  });

  it('leaves the snapshot alone when the list is replaced', () => {
    const snapshot: ReaderHealthSnapshot = {
      health: makeReaderHealth('ceiling'),
      account: undefined,
    };

    const next = readerReducer(state([], snapshot), {
      type: 'replaceAll',
      posts: [post({ id: 'p-1' })],
      keep: [],
    });

    expect(next.health).toBe(snapshot);
  });
});

describe('resummarize', () => {
  const DONE = {
    summary_state: 'done',
    gist: 'the summary it already has',
    summarize_attempts: 3,
    last_error: 'the schema did not fit',
  } as const;

  it('shows the row as pending immediately, keeping the summary already on it', () => {
    const row = post({ id: 'p-1', ...DONE });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      void result.current.actions.resummarize('p-1');
    });

    expect(result.current.posts[0]).toMatchObject({
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      gist: 'the summary it already has',
    });
  });

  it('reconciles with the row the server wrote', async () => {
    const row = post({ id: 'p-1', ...DONE });
    const saved: ReaderPostListItem = {
      ...row,
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      summarizing_since: null,
    };
    mockApi.patchReaderPost.mockResolvedValue(saved);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await result.current.actions.resummarize('p-1');
    });

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { resummarize: true });
    expect(result.current.posts[0]).toEqual(saved);
  });

  it('rolls back the fields it touched and toasts when the write fails', async () => {
    const row = post({ id: 'p-1', ...DONE });
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await expect(result.current.actions.resummarize('p-1')).rejects.toThrow('boom');
    });

    expect(result.current.posts[0]).toMatchObject({
      summary_state: 'done',
      summarize_attempts: 3,
      last_error: 'the schema did not fit',
    });
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't queue that summary");
  });

  it('toasts the server’s own sentence when the post cannot be re-summarised at all', async () => {
    const row = post({ id: 'p-1', ...DONE });
    mockApi.patchReaderPost.mockRejectedValue(
      new api.ApiError('API PATCH failed: 409', 409, 'Post text was swept on Sep 8, 2026'),
    );
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await expect(result.current.actions.resummarize('p-1')).rejects.toThrow();
    });

    expect(mockShowToast).toHaveBeenCalledWith('Post text was swept on Sep 8, 2026');
  });

  it('is not undone by a focus refetch that was already in the air', async () => {
    // The read left the server before the PATCH reached it, so its answer still calls the row
    // `done` — replacing the list wholesale would put the old summary state back on screen.
    const row = post({ id: 'p-1', ...DONE });
    const queueing = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockReturnValue(queueing.promise);
    mockApi.fetchReaderPosts.mockResolvedValue([row]);
    mockApi.fetchReaderHealth.mockResolvedValue(NO_HEALTH);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    let resummarizing: Promise<ReaderPostListItem> | undefined;
    act(() => {
      resummarizing = result.current.actions.resummarize('p-1');
    });
    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.posts[0]?.summary_state).toBe('pending');

    await act(async () => {
      queueing.settle({ ...row, summary_state: 'pending', summarize_attempts: 0 });
      await resummarizing;
    });
    expect(result.current.posts[0]?.summary_state).toBe('pending');
  });
});

describe('reconcileHealth', () => {
  it('re-reads the health snapshot and the list together when the tab returns', async () => {
    const snapshot: ReaderHealthSnapshot = {
      health: makeReaderHealth('stalled'),
      account: undefined,
    };
    mockApi.fetchReaderPosts.mockResolvedValue([]);
    mockApi.fetchReaderHealth.mockResolvedValue(snapshot);
    const { result } = renderHook(
      () => ({ health: useReaderHealth(), actions: useReaderActions() }),
      { wrapper: makeWrapper([]) },
    );

    act(() => {
      globalThis.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(result.current.health).toEqual(snapshot);
    });
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    expect(mockApi.fetchReaderHealth).toHaveBeenCalledTimes(1);
  });

  it('does not read while the tab is hidden', () => {
    mockApi.fetchReaderHealth.mockResolvedValue(NO_HEALTH);
    renderHook(() => useReaderHealth(), { wrapper: makeWrapper([]) });

    act(() => {
      setTabHidden(true);
    });

    expect(mockApi.fetchReaderHealth).not.toHaveBeenCalled();
  });

  it('collapses concurrent triggers into one request', async () => {
    mockApi.fetchReaderHealth.mockResolvedValue(NO_HEALTH);
    const { result } = renderHook(() => useReaderActions(), { wrapper: makeWrapper([]) });

    act(() => {
      result.current.reconcileHealth();
      result.current.reconcileHealth();
    });

    await waitFor(() => {
      expect(mockApi.fetchReaderHealth).toHaveBeenCalledTimes(1);
    });
  });

  it('leaves the held snapshot alone when the read fails', async () => {
    const seeded: ReaderHealthSnapshot = { health: makeReaderHealth('live'), account: undefined };
    mockApi.fetchReaderHealth.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => ({ health: useReaderHealth(), actions: useReaderActions() }),
      { wrapper: makeWrapper([], seeded) },
    );

    await act(async () => {
      result.current.actions.reconcileHealth();
      await flush();
    });

    expect(result.current.health).toEqual(seeded);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('marks the attempt as it launches, and clears it once a fresh snapshot lands', async () => {
    const held = deferred<ReaderHealthSnapshot>();
    mockApi.fetchReaderHealth.mockReturnValue(held.promise);
    const { result } = renderHook(
      () => ({
        actions: useReaderActions(),
        reconcileStartedAt: useReaderHealthReconcileStartedAt(),
      }),
      { wrapper: makeWrapper([]) },
    );
    expect(result.current.reconcileStartedAt).toBeNull();

    act(() => {
      result.current.actions.reconcileHealth();
    });
    expect(result.current.reconcileStartedAt).not.toBeNull();

    await act(async () => {
      held.settle(NO_HEALTH);
      await flush();
    });
    expect(result.current.reconcileStartedAt).toBeNull();
  });

  it('leaves the attempt marked after a failed reconcile — the next retry still gets its grace', async () => {
    mockApi.fetchReaderHealth.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(
      () => ({
        actions: useReaderActions(),
        reconcileStartedAt: useReaderHealthReconcileStartedAt(),
      }),
      { wrapper: makeWrapper([]) },
    );

    await act(async () => {
      result.current.actions.reconcileHealth();
      await flush();
    });

    expect(result.current.reconcileStartedAt).not.toBeNull();
  });
});

describe('unarchive', () => {
  const ARCHIVED = { archived_at: '2026-09-18T09:00:00.000Z' };

  it('puts the row back on the reading list at once and reconciles with the server row', async () => {
    const row = post({ id: 'p-1', ...ARCHIVED });
    const saved: ReaderPostListItem = { ...row, archived_at: null };
    mockApi.patchReaderPost.mockResolvedValue(saved);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });
    expect(result.current.posts).toHaveLength(0);

    await act(async () => {
      await result.current.actions.unarchive('p-1');
    });

    expect(mockApi.patchReaderPost).toHaveBeenCalledWith('p-1', { archived: false });
    expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);
  });

  it('moves the row between the two lists before the server answers', () => {
    const row = post({ id: 'p-1', ...ARCHIVED });
    mockApi.patchReaderPost.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => ({ ...useStore(), archived: useArchivedPosts() }), {
      wrapper: makeWrapper([row]),
    });

    act(() => {
      void result.current.actions.unarchive('p-1');
    });

    expect(result.current.posts).toHaveLength(1);
    expect(result.current.archived).toHaveLength(0);
  });

  it('rolls the row back into the archive and toasts when the write fails', async () => {
    const row = post({ id: 'p-1', ...ARCHIVED });
    mockApi.patchReaderPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => ({ ...useStore(), archived: useArchivedPosts() }), {
      wrapper: makeWrapper([row]),
    });

    await act(async () => {
      await expect(result.current.actions.unarchive('p-1')).rejects.toThrow('boom');
    });

    expect(result.current.posts).toHaveLength(0);
    expect(result.current.archived.map((p) => p.id)).toEqual(['p-1']);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't unarchive that post");
  });

  it('survives a refresh whose read was issued before the write reached the server', async () => {
    const row = post({ id: 'p-1', ...ARCHIVED });
    const patchCall = deferred<ReaderPostListItem>();
    mockApi.patchReaderPost.mockReturnValue(patchCall.promise);
    // The stale active read cannot see the row: it was still archived when the read was served.
    mockApi.fetchReaderPosts.mockResolvedValue([]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      void result.current.actions.unarchive('p-1');
    });
    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      await flush();
    });

    expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);

    await act(async () => {
      patchCall.settle({ ...row, archived_at: null });
      await flush();
    });
    expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);
  });
});

describe('useArchivedPosts', () => {
  it('lists only archived posts, newest arrival first', () => {
    const posts = [
      post({
        id: 'p-old',
        received_at: '2026-09-12T09:00:00.000Z',
        archived_at: '2026-09-18T09:00:00.000Z',
      }),
      post({ id: 'p-active', received_at: '2026-09-17T09:00:00.000Z' }),
      post({
        id: 'p-new',
        received_at: '2026-09-15T09:00:00.000Z',
        archived_at: '2026-09-18T10:00:00.000Z',
      }),
    ];
    const { result } = renderHook(() => useArchivedPosts(), { wrapper: makeWrapper(posts) });

    expect(result.current.map((p) => p.id)).toEqual(['p-new', 'p-old']);
  });
});

/** The archive's three surfaces at once: its verb, its rows and how far its read got. */
function useArchive() {
  return {
    actions: useReaderActions(),
    archived: useArchivedPosts(),
    status: useArchiveStatus(),
  };
}

describe('loadArchive', () => {
  it('reads the archived scope once, however often it is asked', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([]);
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([]) });

    await act(async () => {
      result.current.actions.loadArchive();
      result.current.actions.loadArchive();
      await flush();
    });
    act(() => {
      result.current.actions.loadArchive();
    });

    expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(1);
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledWith({
      scope: 'archived',
      limit: ARCHIVE_READ_LIMIT,
    });
    expect(result.current.status.status).toBe('loaded');
  });

  it('upserts the read into the one post list rather than beside it', async () => {
    const held = post({ id: 'p-held', archived_at: '2026-09-18T09:00:00.000Z', title: 'Held' });
    mockApi.fetchReaderPosts.mockResolvedValue([
      { ...held, title: 'Held, as the server has it' },
      post({ id: 'p-fetched', archived_at: '2026-09-17T09:00:00.000Z' }),
    ]);
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([held]) });

    await act(async () => {
      result.current.actions.loadArchive();
      await flush();
    });

    expect(result.current.archived).toHaveLength(2);
    expect(result.current.archived.map((p) => p.title)).toContain('Held, as the server has it');
  });

  it('says the archive is full only when the read came back at its ceiling', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue(
      Array.from({ length: ARCHIVE_READ_LIMIT }, (_, index) =>
        post({ id: `p-${String(index)}`, archived_at: '2026-09-18T09:00:00.000Z' }),
      ),
    );
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([]) });

    await act(async () => {
      result.current.actions.loadArchive();
      await flush();
    });

    expect(result.current.status.full).toBe(true);
  });

  it('is not full on a short read', async () => {
    mockApi.fetchReaderPosts.mockResolvedValue([
      post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' }),
    ]);
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([]) });

    await act(async () => {
      result.current.actions.loadArchive();
      await flush();
    });

    expect(result.current.status.full).toBe(false);
    expect(result.current.status.status).toBe('loaded');
  });

  it('records the failure rather than reading as an empty archive, and retries', async () => {
    mockApi.fetchReaderPosts.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([]) });

    await act(async () => {
      result.current.actions.loadArchive();
      await flush();
    });
    expect(result.current.status.status).toBe('failed');
    expect(mockShowToast).not.toHaveBeenCalled();

    await act(async () => {
      result.current.actions.loadArchive();
      await flush();
    });
    expect(mockApi.fetchReaderPosts).toHaveBeenCalledTimes(2);
    expect(result.current.status.status).toBe('loaded');
  });

  it('is reading while the request is in the air, neither loaded nor failed', () => {
    mockApi.fetchReaderPosts.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([]) });

    act(() => {
      result.current.actions.loadArchive();
    });

    expect(result.current.status.status).toBe('loading');
  });

  it('does not undo an unarchive that landed while its read was in flight', async () => {
    // The archive read was served before the PATCH reached the server, so its answer still has
    // the row filed away — folding that in would put a post the owner just recovered straight
    // back into the archive.
    const row = post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' });
    const read = deferred<ReaderPostListItem[]>();
    mockApi.fetchReaderPosts.mockReturnValue(read.promise);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, archived_at: null });
    const { result } = renderHook(() => ({ ...useArchive(), posts: useReaderPosts() }), {
      wrapper: makeWrapper([row]),
    });

    act(() => {
      result.current.actions.loadArchive();
    });
    await act(async () => {
      await result.current.actions.unarchive('p-1');
    });

    await act(async () => {
      read.settle([row]);
      await flush();
    });

    expect(result.current.posts.map((p) => p.id)).toEqual(['p-1']);
    expect(result.current.archived).toHaveLength(0);
  });

  it('does not undo a re-summarise that landed while its read was in flight', async () => {
    const row = post({
      id: 'p-1',
      archived_at: '2026-09-18T09:00:00.000Z',
      summary_state: 'done',
      gist: 'the summary it already has',
    });
    const read = deferred<ReaderPostListItem[]>();
    mockApi.fetchReaderPosts.mockReturnValue(read.promise);
    mockApi.patchReaderPost.mockResolvedValue({ ...row, summary_state: 'pending' });
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([row]) });

    act(() => {
      result.current.actions.loadArchive();
    });
    await act(async () => {
      await result.current.actions.resummarize('p-1');
    });

    await act(async () => {
      read.settle([row]);
      await flush();
    });

    expect(result.current.archived[0]?.summary_state).toBe('pending');
  });

  it('still takes the read’s copy of a row this tab never wrote', async () => {
    const held = post({ id: 'p-held', archived_at: '2026-09-18T09:00:00.000Z', title: 'Held' });
    const written = post({ id: 'p-written', archived_at: '2026-09-18T09:00:00.000Z' });
    const read = deferred<ReaderPostListItem[]>();
    mockApi.fetchReaderPosts.mockReturnValue(read.promise);
    mockApi.patchReaderPost.mockResolvedValue({ ...written, archived_at: null });
    const { result } = renderHook(() => useArchive(), { wrapper: makeWrapper([held, written]) });

    act(() => {
      result.current.actions.loadArchive();
    });
    await act(async () => {
      await result.current.actions.unarchive('p-written');
    });
    await act(async () => {
      read.settle([{ ...held, title: 'Held, as the server has it' }, written]);
      await flush();
    });

    expect(result.current.archived.map((p) => p.title)).toEqual(['Held, as the server has it']);
  });
});

describe('sendIdeasToWiki', () => {
  const IDEAS = ['Idea one', 'Idea two', 'Idea three'];
  const done = () =>
    post({
      id: 'p-1',
      summary_state: 'done',
      overview: makeReaderOverview({ novel_ideas: IDEAS }),
      wiki_sent_ideas: [],
    });

  it('is not optimistic: the row reads unsent until the server confirms', () => {
    const row = done();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    act(() => {
      void result.current.actions.sendIdeasToWiki('p-1', ['Idea one']);
    });

    expect(result.current.posts[0]?.wiki_sent_ideas).toEqual([]);
  });

  it('sends exactly the bullets it is given and reconciles with the row the server wrote', async () => {
    const row = done();
    const saved: ReaderPostListItem = { ...row, wiki_sent_ideas: ['Idea one', 'Idea two'] };
    mockApi.sendReaderIdeasToWiki.mockResolvedValue(saved);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await expect(
        result.current.actions.sendIdeasToWiki('p-1', ['Idea one', 'Idea two']),
      ).resolves.toEqual(saved);
    });

    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledWith('p-1', {
      ideas: ['Idea one', 'Idea two'],
    });
    expect(result.current.posts[0]).toEqual(saved);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it.each([
    [409, "That idea isn't in this post's overview any more"],
    [501, 'The wiki is not configured on this deployment'],
    [502, "Couldn't reach the wiki repo"],
    [503, 'The wiki repo was busy — try again'],
  ])(
    'toasts the route’s own %i sentence, rethrows, and leaves the row unchanged',
    async (status, sentence) => {
      const row = done();
      mockApi.sendReaderIdeasToWiki.mockRejectedValue(
        new api.ApiError(`API POST failed: ${String(status)}`, status, sentence),
      );
      const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

      await act(async () => {
        await expect(result.current.actions.sendIdeasToWiki('p-1', ['Idea one'])).rejects.toThrow();
      });

      expect(mockShowToast).toHaveBeenCalledWith(sentence);
      expect(result.current.posts[0]).toEqual(row);
    },
  );

  it('toasts its own line when the failure carried no sentence', async () => {
    const row = done();
    mockApi.sendReaderIdeasToWiki.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await expect(result.current.actions.sendIdeasToWiki('p-1', ['Idea one'])).rejects.toThrow(
        'network down',
      );
    });

    expect(mockShowToast).toHaveBeenCalledWith("Couldn't send to the wiki");
    expect(result.current.posts[0]).toEqual(row);
  });

  it('refuses a second send for a post whose first is still in flight, without calling the API', async () => {
    const row = done();
    const sending = deferred<ReaderPostListItem>();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(sending.promise);
    const { result } = renderHook(
      () => ({
        ...useStore(),
        inFlight: useWikiSendInFlight('p-1'),
        other: useWikiSendInFlight('p-2'),
      }),
      { wrapper: makeWrapper([row]) },
    );

    let first: Promise<ReaderPostListItem> | undefined;
    act(() => {
      first = result.current.actions.sendIdeasToWiki('p-1', ['Idea one']);
    });
    expect(result.current.inFlight).toBe(true);
    expect(result.current.other).toBe(false);

    await act(async () => {
      await expect(result.current.actions.sendIdeasToWiki('p-1', ['Idea two'])).rejects.toThrow(
        'already in flight',
      );
    });
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();

    await act(async () => {
      sending.settle({ ...row, wiki_sent_ideas: ['Idea one'] });
      await first;
    });
    expect(result.current.inFlight).toBe(false);
  });

  it('clears the in-flight mark when a send fails, so the retry can go', async () => {
    const row = done();
    mockApi.sendReaderIdeasToWiki.mockRejectedValueOnce(new Error('boom'));
    mockApi.sendReaderIdeasToWiki.mockResolvedValueOnce({ ...row, wiki_sent_ideas: ['Idea one'] });
    const { result } = renderHook(() => ({ ...useStore(), inFlight: useWikiSendInFlight('p-1') }), {
      wrapper: makeWrapper([row]),
    });

    await act(async () => {
      await expect(result.current.actions.sendIdeasToWiki('p-1', ['Idea one'])).rejects.toThrow();
    });
    expect(result.current.inFlight).toBe(false);
    await act(async () => {
      await result.current.actions.sendIdeasToWiki('p-1', ['Idea one']);
    });
    expect(mockApi.sendReaderIdeasToWiki).toHaveBeenCalledTimes(2);
  });

  it('takes the server row from a refresh issued after the send settled', async () => {
    const row = done();
    mockApi.sendReaderIdeasToWiki.mockResolvedValue({ ...row, wiki_sent_ideas: ['Idea one'] });
    const later: ReaderPostListItem = { ...row, wiki_sent_ideas: ['Idea one', 'Idea two'] };
    mockApi.fetchReaderPosts.mockResolvedValue([later]);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    await act(async () => {
      await result.current.actions.sendIdeasToWiki('p-1', ['Idea one']);
    });
    await act(async () => {
      result.current.actions.refresh();
      await flush();
    });

    expect(result.current.posts[0]?.wiki_sent_ideas).toEqual(['Idea one', 'Idea two']);
  });

  it('is not undone by a focus refetch that left before the send landed', async () => {
    // The read left the server before the send's append reached it, so its answer still calls
    // every bullet unsent — taking it would rub out the marks the send just reconciled.
    const row = done();
    const sending = deferred<ReaderPostListItem>();
    const reading = deferred<ReaderPostListItem[]>();
    mockApi.sendReaderIdeasToWiki.mockReturnValue(sending.promise);
    mockApi.fetchReaderPosts.mockReturnValue(reading.promise);
    const { result } = renderHook(() => useStore(), { wrapper: makeWrapper([row]) });

    let send: Promise<ReaderPostListItem> | undefined;
    act(() => {
      send = result.current.actions.sendIdeasToWiki('p-1', ['Idea one']);
    });
    act(() => {
      result.current.actions.refresh();
    });
    await act(async () => {
      sending.settle({ ...row, wiki_sent_ideas: ['Idea one'] });
      await send;
    });
    await act(async () => {
      reading.settle([row]);
      await flush();
    });

    expect(result.current.posts[0]?.wiki_sent_ideas).toEqual(['Idea one']);
  });
});
