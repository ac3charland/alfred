import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import {
  makeReaderPost,
  makeReaderPublication,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import type { ReaderOverview, ReaderPostListItem } from '@/lib/types';

import {
  ReaderProvider,
  readerReducer,
  useActiveCount,
  useReaderActions,
  useReaderPosts,
} from './reader-store';

jest.mock('@/lib/api-client');
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

function makeWrapper(posts: ReaderPostListItem[]) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <ReaderProvider initialPosts={posts}>{children}</ReaderProvider>;
  };
}

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('readerReducer', () => {
  it('patches a post by id', () => {
    const original = post({ id: 'p-1', title: 'Original' });
    const next = readerReducer(
      { posts: [original] },
      { type: 'posts', action: { type: 'patch', ids: ['p-1'], patch: { title: 'Patched' } } },
    );
    expect(next.posts[0]?.title).toBe('Patched');
  });

  it('is a no-op for a patch naming an id it no longer holds', () => {
    const state = { posts: [post({ id: 'p-1' })] };
    const next = readerReducer(state, {
      type: 'posts',
      action: { type: 'patch', ids: ['gone'], patch: { title: 'x' } },
    });
    expect(next).toEqual(state);
  });

  it('replaces the whole list on replaceAll', () => {
    const state = { posts: [post({ id: 'p-1' }), post({ id: 'p-2' })] };
    const replacement = [post({ id: 'p-3' })];
    const next = readerReducer(state, { type: 'replaceAll', posts: replacement, keep: [] });
    expect(next.posts).toEqual(replacement);
  });

  it('keeps the local row for every id replaceAll is told to keep', () => {
    const local = post({ id: 'p-1', archived_at: '2026-09-18T09:00:00.000Z' });
    const fromServer = post({ id: 'p-1', archived_at: null });
    const next = readerReducer(
      { posts: [local] },
      { type: 'replaceAll', posts: [fromServer, post({ id: 'p-2' })], keep: ['p-1'] },
    );
    expect(next.posts[0]).toBe(local);
    expect(next.posts).toHaveLength(2);
  });

  it('does not re-add a kept row the server no longer lists', () => {
    const local = post({ id: 'p-1' });
    const next = readerReducer(
      { posts: [local] },
      { type: 'replaceAll', posts: [], keep: ['p-1'] },
    );
    expect(next.posts).toEqual([]);
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
