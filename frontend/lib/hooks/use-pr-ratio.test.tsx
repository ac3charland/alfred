import { act, renderHook, waitFor } from '@testing-library/react';

import * as api from '@/lib/api-client';
import type { PrRatioResponse } from '@/lib/types';

import { usePrRatio } from './use-pr-ratio';

jest.mock('@/lib/api-client');
const mockGetPrRatio = jest.mocked(api.getPrRatio);

const WEEK = {
  start: '2026-07-17T16:00:00-04:00',
  end: '2026-07-24T16:00:00-04:00',
  timezone: 'America/New_York',
};

const BEFORE: PrRatioResponse = {
  week: WEEK,
  total: 9,
  repos: [
    { repo: 'ac3charland/realplay', label: 'RealPlay', count: 3, percentage: 33 },
    { repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 67 },
  ],
};

const AFTER: PrRatioResponse = {
  week: WEEK,
  total: 6,
  repos: [{ repo: 'ac3charland/alfred', label: 'Alfred', count: 6, percentage: 100 }],
};

function noop(): void {
  // Placeholder until the Promise executor hands over its resolver.
}

/** A promise the test settles by hand, so the in-between state can be asserted. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = noop;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      settle(value);
    },
  };
}

describe('usePrRatio', () => {
  it('loads once on mount, then reports the ratio', async () => {
    mockGetPrRatio.mockResolvedValue(BEFORE);

    const { result } = renderHook(() => usePrRatio());

    expect(result.current.state).toEqual({ status: 'loading' });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'ready', ratio: BEFORE });
    });
    expect(mockGetPrRatio).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous ratio while a refetch is in flight, then swaps in the new one', async () => {
    mockGetPrRatio.mockResolvedValueOnce(BEFORE);
    const { result } = renderHook(() => usePrRatio());
    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
    });

    const next = deferred<PrRatioResponse | undefined>();
    mockGetPrRatio.mockReturnValueOnce(next.promise);
    act(() => {
      result.current.refetch();
    });

    // No flash back to the loading bar.
    expect(result.current.state).toEqual({ status: 'ready', ratio: BEFORE });

    await act(async () => {
      next.resolve(AFTER);
      await next.promise;
    });
    expect(result.current.state).toEqual({ status: 'ready', ratio: AFTER });
  });

  it('lets the latest refetch win when two are in flight', async () => {
    mockGetPrRatio.mockResolvedValueOnce(BEFORE);
    const { result } = renderHook(() => usePrRatio());
    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
    });

    const slow = deferred<PrRatioResponse | undefined>();
    const fast = deferred<PrRatioResponse | undefined>();
    mockGetPrRatio.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    act(() => {
      result.current.refetch();
      result.current.refetch();
    });

    await act(async () => {
      fast.resolve(AFTER);
      await fast.promise;
    });
    await act(async () => {
      slow.resolve(BEFORE);
      await slow.promise;
    });

    // The stale answer to the first tick must not overwrite the second's.
    expect(result.current.state).toEqual({ status: 'ready', ratio: AFTER });
  });

  it('reports an error when a refetch fails', async () => {
    mockGetPrRatio.mockResolvedValueOnce(BEFORE);
    const { result } = renderHook(() => usePrRatio());
    await waitFor(() => {
      expect(result.current.state.status).toBe('ready');
    });

    mockGetPrRatio.mockRejectedValueOnce(new Error('502'));
    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error' });
    });
  });

  it('recovers from an error state on a successful refetch', async () => {
    mockGetPrRatio.mockRejectedValueOnce(new Error('502'));
    const { result } = renderHook(() => usePrRatio());
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error' });
    });

    mockGetPrRatio.mockResolvedValueOnce(AFTER);
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'ready', ratio: AFTER });
    });
  });
});
