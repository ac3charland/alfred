import { act, renderHook } from '@testing-library/react';

import { pinClock, setClockNow } from '@/lib/pin-clock';

import { NOW_TICK_MS, useNow } from './use-now';

pinClock('2026-09-09T12:00:10.500Z');

beforeEach(() => {
  // `doNotFake: ['Date']` so Jest's timer mock leaves `pinClock`'s Date proxy in place —
  // otherwise the fake Date would win and the pinned instant would be lost.
  jest.useFakeTimers({ doNotFake: ['Date'] });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useNow', () => {
  it('snaps the clock down to the tick boundary, so a render never sees a moving value', () => {
    const { result, rerender } = renderHook(() => useNow());

    // 12:00:10.500 with a 30s tick floors to 12:00:00.
    expect(result.current.toISOString()).toBe('2026-09-09T12:00:00.000Z');

    const first = result.current;
    rerender();
    // Same instant AND the same object — a fresh Date every render would re-run every memo
    // downstream that keys on it.
    expect(result.current).toBe(first);
  });

  it('advances when a tick elapses', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe('2026-09-09T12:00:00.000Z');

    act(() => {
      setClockNow('2026-09-09T12:00:41.000Z');
      jest.advanceTimersByTime(NOW_TICK_MS);
    });

    expect(result.current.toISOString()).toBe('2026-09-09T12:00:30.000Z');
  });

  it('honours a custom interval', () => {
    const { result } = renderHook(() => useNow(60_000));

    expect(result.current.toISOString()).toBe('2026-09-09T12:00:00.000Z');

    act(() => {
      setClockNow('2026-09-09T12:01:05.000Z');
      jest.advanceTimersByTime(60_000);
    });

    expect(result.current.toISOString()).toBe('2026-09-09T12:01:00.000Z');
  });

  it('stops ticking once unmounted', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useNow());

    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('notices a wall-clock jump (sleep) within 1s, without a full interval elapsing', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current.toISOString()).toBe('2026-09-09T12:00:00.000Z');

    // Sleep: the wall clock jumps 8h but the monotonic interval doesn't fire for it — only the
    // next 1s re-check does.
    act(() => {
      setClockNow('2026-09-09T20:00:10.500Z');
      jest.advanceTimersByTime(1000);
    });

    expect(result.current.toISOString()).toBe('2026-09-09T20:00:00.000Z');
  });

  it('checks every 1s even for an interval much longer than that', () => {
    const setSpy = jest.spyOn(globalThis, 'setInterval');
    renderHook(() => useNow(60_000));

    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
  });
});
