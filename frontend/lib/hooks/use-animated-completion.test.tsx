import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import { useAnimatedCompletion } from './use-animated-completion';

/**
 * Build the minimal `onTransitionEnd` event the hook reads: `target`, `currentTarget`, and
 * `propertyName`. `target === currentTarget` is the "own element" guard; pass a distinct
 * `target` (or a different property) to simulate a bubbled child transition.
 */
function collapseEvent(options: {
  ownElement?: boolean;
  propertyName?: string;
}): React.TransitionEvent<HTMLDivElement> {
  const element = {} as HTMLDivElement;
  const other = {} as HTMLDivElement;
  return {
    currentTarget: element,
    target: options.ownElement === false ? other : element,
    propertyName: options.propertyName ?? 'grid-template-rows',
  } as unknown as React.TransitionEvent<HTMLDivElement>;
}

describe('useAnimatedCompletion', () => {
  it('starts not completing', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));
    expect(result.current.isCompleting).toBe(false);
  });

  // ── Reduced motion: commit immediately, no animation to wait on. ──
  it('commits immediately on begin under reduced motion (no isCompleting)', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, true));

    act(() => {
      result.current.begin();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    // No exit animation plays — there's nothing to wait on.
    expect(result.current.isCompleting).toBe(false);
  });

  // ── Animated path: begin sets isCompleting; the collapse end commits. ──
  it('sets isCompleting on begin (animated) and does NOT commit yet', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });

    expect(result.current.isCompleting).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('commits when the grid-template-rows collapse ends', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not commit before begin (isCompleting guard)', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores a non-grid-template-rows transition', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({ propertyName: 'opacity' }));
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('ignores a grid-template-rows transition bubbling from a child', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({ ownElement: false }));
    });

    expect(onComplete).not.toHaveBeenCalled();
  });

  // ── Once-only guard: collapse end then a second event must not re-fire. ──
  it('commits exactly once even if the collapse end fires twice', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ── Navigate-away fallback: unmount mid-exit still commits. ──
  it('commits on unmount if still completing (navigate-away fallback)', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    expect(onComplete).not.toHaveBeenCalled();

    unmount();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does NOT commit on unmount when never completing', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => useAnimatedCompletion(onComplete, false));

    unmount();

    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does not double-commit when the collapse ends and THEN the row unmounts', () => {
    const onComplete = jest.fn(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });
    unmount();

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  // ── A rejected commit is swallowed (the store already rolled back). ──
  it('swallows a rejected onComplete without throwing', async () => {
    const onComplete = jest.fn(() => Promise.reject(new Error('network')));
    const { result } = renderHook(() => useAnimatedCompletion(onComplete, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
