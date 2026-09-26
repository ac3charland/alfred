import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as api from '@/lib/api-client';
import { makeWikiPage, makeWikiSync, toWikiIndexRow } from '@/lib/wiki/fixtures';

import {
  WikiProvider,
  useWikiActions,
  useWikiConfig,
  useWikiCounts,
  useWikiPageBody,
  useWikiPages,
  useWikiSync,
} from './wiki-store';

jest.mock('@/lib/api-client', () => ({
  fetchWikiPages: jest.fn(),
  fetchWikiPageBody: jest.fn(),
}));

const mockFetchPages = jest.mocked(api.fetchWikiPages);
const mockFetchBody = jest.mocked(api.fetchWikiPageBody);

const STACKING = toWikiIndexRow(
  makeWikiPage('wiki/concepts/habit-stacking.md', { title: 'Habit stacking', blob_oid: 'b1' }),
);
const CLEAR = toWikiIndexRow(
  makeWikiPage('wiki/entities/james-clear.md', { title: 'James Clear', blob_oid: 'b2' }),
);
const ALPHA = toWikiIndexRow(makeWikiPage('wiki/concepts/alpha.md', { title: 'alpha' }));
const SYNC = makeWikiSync();
const CONFIG = { repo: 'ac3charland/knowledge', writable: true };

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <WikiProvider initialPages={[STACKING, CLEAR, ALPHA]} initialSync={SYNC} config={CONFIG}>
      {children}
    </WikiProvider>
  );
}

/** A promise the test settles by hand, so one request can be held in flight (race tests). */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

beforeEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

describe('WikiProvider seeds', () => {
  it('lists pages in the index order, not the seed order', () => {
    const { result } = renderHook(() => useWikiPages(), { wrapper });
    expect(result.current.map((page) => page.path)).toEqual([
      'wiki/concepts/alpha.md',
      'wiki/concepts/habit-stacking.md',
      'wiki/entities/james-clear.md',
    ]);
  });

  it('counts pages per section and in all', () => {
    const { result } = renderHook(() => useWikiCounts(), { wrapper });
    expect(result.current).toEqual({ all: 3, concepts: 2, entities: 1, sources: 0, questions: 0 });
  });

  it('exposes the sync row and the config as seeded', () => {
    const { result } = renderHook(() => ({ sync: useWikiSync(), config: useWikiConfig() }), {
      wrapper,
    });
    expect(result.current.sync).toEqual(SYNC);
    expect(result.current.config).toEqual(CONFIG);
  });

  it('throws outside a provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWikiConfig())).toThrow(
      'useWikiConfig must be used within a WikiProvider',
    );
  });
});

describe('refresh', () => {
  it('replaces the pages and the sync row wholesale', async () => {
    const newer = { ...STACKING, title: 'Habit stacking (revised)', blob_oid: 'b9' };
    const newSync = makeWikiSync({ pending: 3 });
    mockFetchPages.mockResolvedValue({ pages: [newer], sync: newSync });
    const { result } = renderHook(
      () => ({ pages: useWikiPages(), sync: useWikiSync(), actions: useWikiActions() }),
      { wrapper },
    );

    act(() => {
      result.current.actions.refresh();
    });

    await waitFor(() => {
      expect(result.current.pages).toEqual([newer]);
    });
    expect(result.current.sync).toEqual(newSync);
  });

  it('coalesces concurrent calls into one request', async () => {
    const read = deferred<{ pages: never[]; sync: null }>();
    mockFetchPages.mockReturnValue(read.promise);
    const { result } = renderHook(() => useWikiActions(), { wrapper });

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(mockFetchPages).toHaveBeenCalledTimes(1);

    await act(async () => {
      read.settle({ pages: [], sync: null });
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      result.current.refresh();
    });
    expect(mockFetchPages).toHaveBeenCalledTimes(2);
  });

  it('skips a read while the tab is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const { result } = renderHook(() => useWikiActions(), { wrapper });

    act(() => {
      result.current.refresh();
    });

    expect(mockFetchPages).not.toHaveBeenCalled();
  });

  it('keeps the current snapshot when the read fails', async () => {
    mockFetchPages.mockRejectedValue(new Error('502'));
    const { result } = renderHook(() => ({ pages: useWikiPages(), actions: useWikiActions() }), {
      wrapper,
    });

    await act(async () => {
      result.current.actions.refresh();
      await Promise.resolve();
    });

    expect(result.current.pages).toHaveLength(3);
  });

  it('re-reads when the tab becomes visible again and on a bfcache restore', async () => {
    mockFetchPages.mockResolvedValue({ pages: [], sync: null });
    const { result } = renderHook(() => useWikiPages(), { wrapper });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(mockFetchPages).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current).toEqual([]);
    });

    await act(async () => {
      globalThis.dispatchEvent(new Event('pageshow'));
      await Promise.resolve();
    });
    expect(mockFetchPages).toHaveBeenCalledTimes(2);
  });
});

function Body({ path }: { path: string }) {
  const state = useWikiPageBody(path);
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      {state.status === 'ready' && <pre data-testid="body">{state.body}</pre>}
      <button type="button" onClick={state.retry}>
        retry
      </button>
    </div>
  );
}

describe('useWikiPageBody', () => {
  it('loads a body on first open and serves it from the cache on the next', async () => {
    mockFetchBody.mockResolvedValue({ path: STACKING.path, blob_oid: 'b1', body: '# Stacking' });
    const { rerender } = render(<Body path={STACKING.path} />, { wrapper });

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
    expect(screen.getByTestId('body')).toHaveTextContent('# Stacking');
    expect(mockFetchBody).toHaveBeenCalledWith(STACKING.path);

    rerender(<Body path={CLEAR.path} />);
    rerender(<Body path={STACKING.path} />);
    expect(screen.getByTestId('status')).toHaveTextContent('ready');
    expect(mockFetchBody).toHaveBeenCalledTimes(2);
  });

  it('treats an answer with a different blob than requested as a miss, not ready', async () => {
    // A refresh could change the page's blob between the effect reading `key` and the fetch
    // landing; caching whatever comes back under the STALE key would label a body with a version
    // it never was. It must become `error`, never `ready` with the wrong content.
    mockFetchBody.mockResolvedValue({
      path: STACKING.path,
      blob_oid: 'not-b1',
      body: '# Wrong version',
    });
    mockFetchPages.mockResolvedValue({ pages: [STACKING, CLEAR, ALPHA], sync: SYNC });
    render(<Body path={STACKING.path} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(screen.queryByTestId('body')).not.toBeInTheDocument();
  });

  it('refreshes the index on a blob mismatch, so a stale index catches up on its own', async () => {
    // The index that handed this hook `blob_oid` is itself out of date — refreshing is what
    // lets the NEXT render re-key onto the page's true current blob, rather than repeating the
    // same mismatch until something else (navigation, a tab return) happens to refresh it.
    mockFetchBody.mockResolvedValue({
      path: STACKING.path,
      blob_oid: 'not-b1',
      body: '# Wrong version',
    });
    mockFetchPages.mockResolvedValue({ pages: [STACKING, CLEAR, ALPHA], sync: SYNC });
    render(<Body path={STACKING.path} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });
    expect(mockFetchPages).toHaveBeenCalledTimes(1);
  });

  it('reports an error and refetches on retry', async () => {
    mockFetchBody
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValueOnce({ path: STACKING.path, blob_oid: 'b1', body: '# Stacking' });
    render(<Body path={STACKING.path} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('error');
    });

    act(() => {
      screen.getByRole('button', { name: 'retry' }).click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('ready');
    });
  });

  it('is an error for a path not in the index, without fetching', () => {
    render(<Body path="wiki/concepts/not-yet.md" />, { wrapper });

    expect(screen.getByTestId('status')).toHaveTextContent('error');
    expect(mockFetchBody).not.toHaveBeenCalled();
  });

  it('refetches a page whose blob changed on refresh, and keeps one that did not', async () => {
    // A well-behaved server: the answer's blob_oid always matches the path's CURRENT blob, the
    // same one `mockFetchPages` reports — `fetchBody` now rejects a mismatch (it would mean the
    // page moved on again mid-fetch), so the stub has to track it rather than echo a constant.
    const currentBlob: Record<string, string> = {
      [STACKING.path]: STACKING.blob_oid,
      [CLEAR.path]: CLEAR.blob_oid,
    };
    mockFetchBody.mockImplementation((path) =>
      Promise.resolve({ path, blob_oid: currentBlob[path] ?? '', body: `body of ${path}` }),
    );
    function Two() {
      return (
        <>
          <Body path={STACKING.path} />
          <Body path={CLEAR.path} />
        </>
      );
    }
    function Refresh() {
      const { refresh } = useWikiActions();
      return (
        <button type="button" onClick={refresh}>
          refresh
        </button>
      );
    }
    render(
      <>
        <Two />
        <Refresh />
      </>,
      { wrapper },
    );
    await waitFor(() => {
      expect(screen.getAllByTestId('status').map((node) => node.textContent)).toEqual([
        'ready',
        'ready',
      ]);
    });
    expect(mockFetchBody).toHaveBeenCalledTimes(2);

    currentBlob[STACKING.path] = 'b1-new';
    mockFetchPages.mockResolvedValue({
      pages: [{ ...STACKING, blob_oid: 'b1-new' }, CLEAR],
      sync: SYNC,
    });
    act(() => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });

    await waitFor(() => {
      expect(mockFetchBody).toHaveBeenCalledTimes(3);
    });
    expect(mockFetchBody).toHaveBeenLastCalledWith(STACKING.path);
    // CLEAR's blob did not change, so its cached body must survive `retain` untouched — never
    // dropped back to loading and re-fetched. `retain(new Set())` (dropping every key instead of
    // keeping the refreshed index's) would both re-fetch CLEAR and fail this.
    expect(mockFetchBody.mock.calls.filter(([path]) => path === CLEAR.path)).toHaveLength(1);
    expect(screen.getAllByTestId('status').map((node) => node.textContent)).toEqual([
      'ready',
      'ready',
    ]);
  });
});
