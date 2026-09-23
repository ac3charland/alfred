import { act, renderHook } from '@testing-library/react';

import { COMMS_LIVE_WINDOW_MS } from '@/lib/comms';

import { useCommsLive } from './use-comms-live';

const READ_AT = '2026-09-09T12:00:00.000Z';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useCommsLive', () => {
  it('is live the instant a read lands, and stays live short of the window', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result } = renderHook(() => useCommsLive(true, READ_AT));

    expect(result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS - 1);
    });
    expect(result.current).toBe(true);
  });

  it('flips to not-live within 1s of the window elapsing', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result } = renderHook(() => useCommsLive(true, READ_AT));

    // `isCommsLive` treats an elapsed time equal to the window as still live.
    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS);
    });
    expect(result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it('flips within 1s of a wall-clock jump (sleep) with no elapsed real interval', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result } = renderHook(() => useCommsLive(true, READ_AT));
    expect(result.current).toBe(true);

    // Sleep: the wall clock jumps 8h but no monotonic timer fires for the jump itself — only
    // the next 1s re-check notices.
    jest.setSystemTime(new Date(Date.parse(READ_AT) + 8 * 3_600_000));
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(result.current).toBe(false);
  });

  it('goes live again once a new read lands', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result, rerender } = renderHook(({ lastReadAt }) => useCommsLive(true, lastReadAt), {
      initialProps: { lastReadAt: READ_AT },
    });

    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS + 1000);
    });
    expect(result.current).toBe(false);

    const laterRead = new Date(Date.now()).toISOString();
    rerender({ lastReadAt: laterRead });
    expect(result.current).toBe(true);
  });

  it('is never live while nothing has loaded', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result } = renderHook(() => useCommsLive(false, null));

    expect(result.current).toBe(false);

    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS);
    });
    expect(result.current).toBe(false);
  });

  it('clears its own interval on unmount, not just some timer', () => {
    jest.setSystemTime(new Date(READ_AT));
    const setSpy = jest.spyOn(globalThis, 'setInterval');
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const { result, unmount } = renderHook(() => useCommsLive(true, READ_AT));
    const armedId = setSpy.mock.results.at(-1)?.value as ReturnType<typeof setInterval> | undefined;

    unmount();

    expect(clearSpy).toHaveBeenCalledWith(armedId);

    // Belt-and-braces on the same assertion: nothing flips the value after unmount either,
    // since `result.current` is frozen at the last render.
    const before = result.current;
    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS + 1000);
    });
    expect(result.current).toBe(before);
  });
});
