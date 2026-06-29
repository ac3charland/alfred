import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import { useAnimatedRowExit } from './use-animated-row-exit';

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

describe('useAnimatedRowExit', () => {
  it('starts not exiting', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));
    expect(result.current.isExiting).toBe(false);
  });

  // ── Reduced motion: commit immediately, no animation to wait on. ──
  it('commits immediately on begin under reduced motion (no isExiting)', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, true));

    act(() => {
      result.current.begin();
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    // No exit animation plays — there's nothing to wait on.
    expect(result.current.isExiting).toBe(false);
  });

  // ── Animated path: begin sets isExiting; the collapse end commits. ──
  it('sets isExiting on begin (animated) and does NOT commit yet', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });

    expect(result.current.isExiting).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits when the grid-template-rows collapse ends', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does not commit before begin (isExiting guard)', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ignores a non-grid-template-rows transition', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({ propertyName: 'opacity' }));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('ignores a grid-template-rows transition bubbling from a child', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({ ownElement: false }));
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  // ── Once-only guard: collapse end then a second event must not re-fire. ──
  it('commits exactly once even if the collapse end fires twice', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
      result.current.onCollapseEnd(collapseEvent({}));
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // ── Navigate-away fallback: unmount mid-exit still commits. ──
  it('commits on unmount if still exiting (navigate-away fallback)', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    expect(onCommit).not.toHaveBeenCalled();

    unmount();

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('does NOT commit on unmount when never exiting', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { unmount } = renderHook(() => useAnimatedRowExit(onCommit, false));

    unmount();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not double-commit when the collapse ends and THEN the row unmounts', () => {
    const onCommit = jest.fn(() => Promise.resolve());
    const { result, unmount } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });
    unmount();

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  // ── A rejected commit is swallowed (the store already rolled back). ──
  it('swallows a rejected onCommit without throwing', async () => {
    const onCommit = jest.fn(() => Promise.reject(new Error('network')));
    const { result } = renderHook(() => useAnimatedRowExit(onCommit, false));

    act(() => {
      result.current.begin();
    });
    act(() => {
      result.current.onCollapseEnd(collapseEvent({}));
    });

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledTimes(1);
    });
  });
});
