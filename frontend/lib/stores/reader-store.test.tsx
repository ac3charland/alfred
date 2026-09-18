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
    const next = readerReducer(state, { type: 'replaceAll', posts: replacement });
    expect(next.posts).toEqual(replacement);
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
