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

  it('flips to not-live exactly at the window, mounted off a 30s tick boundary', () => {
    // 26s past the read — deliberately not a multiple of 30s, so a fix that still rode a
    // bucketed clock would flip late instead of exactly at the window.
    jest.setSystemTime(new Date(Date.parse(READ_AT) + 26_000));
    const { result } = renderHook(() => useCommsLive(true, READ_AT));

    // `isCommsLive` treats an elapsed time equal to the window as still live.
    act(() => {
      jest.advanceTimersByTime(COMMS_LIVE_WINDOW_MS - 26_000);
    });
    expect(result.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('re-arms the timer when a later read lands, rather than firing on the earlier one', () => {
    jest.setSystemTime(new Date(READ_AT));
    const { result, rerender } = renderHook(({ lastReadAt }) => useCommsLive(true, lastReadAt), {
      initialProps: { lastReadAt: READ_AT },
    });

    const laterRead = new Date(Date.parse(READ_AT) + 40_000).toISOString();
    act(() => {
      jest.setSystemTime(new Date(laterRead));
    });
    rerender({ lastReadAt: laterRead });

    // Past when the FIRST read's timer would have fired (65s after it, i.e. 25s after this
    // read) — still live proves that timer was cleared on re-subscribe, not merely not-yet-due.
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(result.current).toBe(true);

    // Now past the SECOND read's own window (65s after it).
    act(() => {
      jest.advanceTimersByTime(35_001);
    });
    expect(result.current).toBe(false);
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

  it('clears its timer on unmount', () => {
    jest.setSystemTime(new Date(READ_AT));
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderHook(() => useCommsLive(true, READ_AT));

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });
});
