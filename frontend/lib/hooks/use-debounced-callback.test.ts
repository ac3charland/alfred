import { act, renderHook } from '@testing-library/react';

import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';

describe('useDebouncedCallback', () => {
  it('does not call synchronously', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => {
        result.current('a');
      });

      expect(callback).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls once, with the args, after the delay elapses', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => {
        result.current('a');
        jest.advanceTimersByTime(200);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('a');
    } finally {
      jest.useRealTimers();
    }
  });

  it('collapses a rapid burst into a single call using the LAST call’s args', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => {
        result.current('a');
        jest.advanceTimersByTime(80);
        result.current('b');
        jest.advanceTimersByTime(80);
        result.current('c');
        jest.advanceTimersByTime(200);
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('c');
    } finally {
      jest.useRealTimers();
    }
  });

  it('fires a separate call once each burst fully settles', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      const { result } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => {
        result.current('a');
        jest.advanceTimersByTime(200);
      });
      act(() => {
        result.current('b');
        jest.advanceTimersByTime(200);
      });

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, 'a');
      expect(callback).toHaveBeenNthCalledWith(2, 'b');
    } finally {
      jest.useRealTimers();
    }
  });

  it('cancels a pending call on unmount', () => {
    jest.useFakeTimers();
    try {
      const callback = jest.fn();
      const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 200));

      act(() => {
        result.current('a');
      });
      unmount();
      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(callback).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('always invokes the latest callback identity, not a stale closure', () => {
    jest.useFakeTimers();
    try {
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();
      const { result, rerender } = renderHook(
        ({ callback }: { callback: (value: string) => void }) =>
          useDebouncedCallback(callback, 200),
        { initialProps: { callback: firstCallback } },
      );

      rerender({ callback: secondCallback });
      act(() => {
        result.current('a');
        jest.advanceTimersByTime(200);
      });

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledWith('a');
    } finally {
      jest.useRealTimers();
    }
  });
});
