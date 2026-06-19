'use client';

import * as React from 'react';

export interface AnimatedCompletion {
  /**
   * True while the exit animation plays — the caller keeps the row rendered and applies the
   * exit classes (checkbox pop → height collapse → text fade) but has NOT yet committed the
   * mutation. The store filters the row out only once `onComplete` runs.
   */
  isCompleting: boolean;
  /**
   * Begin completion: play the exit animation, or — when motion is disabled — commit straight
   * away (there's no collapse animation whose end we could wait on).
   */
  begin: () => void;
  /**
   * Handler for the collapse wrapper's `onTransitionEnd`: the height collapse finishing is
   * what commits the completion. Guarded so only the wrapper's own `grid-template-rows`
   * transition counts — child transitions (checkbox/title colour fades, the inner subtask
   * grid) bubble up and must be ignored.
   */
  onCollapseEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

/**
 * The task-row completion exit, as a hook: the `isCompleting` state, the once-only mutation
 * fire, and the navigate-away fallback (Finding 9). Completing a task plays a checkbox pop +
 * height collapse and only commits `onComplete` when the collapse transition ends — the row
 * stays visible meanwhile so the exit can play. See the `motion` skill's "animate-then-commit"
 * pattern.
 *
 * Two invariants are load-bearing and preserved exactly:
 * - **Commit exactly once.** `hasCompletedRef` gates `onComplete` so the collapse-end handler
 *   and the unmount fallback can't both fire it.
 * - **Navigate-away fallback.** If the row unmounts mid-exit (the user navigates away before
 *   `transitionend`), the unmount effect's cleanup still commits, so the mutation isn't
 *   silently dropped. `isCompletingRef` lets that cleanup read the latest completing state.
 */
export function useAnimatedCompletion(
  onComplete: () => Promise<void> | void,
  prefersReducedMotion: boolean,
): AnimatedCompletion {
  const [isCompleting, setIsCompleting] = React.useState(false);
  // `hasCompletedRef` keeps the completion mutation firing exactly once (animation end OR
  // unmount); `isCompletingRef` lets the unmount fallback read the latest state.
  const hasCompletedRef = React.useRef(false);
  const isCompletingRef = React.useRef(false);

  // Commit the completion mutation, at most once. On success the row is filtered out of view
  // and unmounts (already collapsed to 0 height, so no jump); on failure the store rolls back
  // and a fresh, non-completing row remounts in its place.
  const runComplete = React.useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    void (async () => {
      try {
        await onComplete();
      } catch {
        // The store already restored the row.
      }
    })();
  }, [onComplete]);

  // Keep the ref in sync so the unmount fallback below sees the latest completing state.
  React.useEffect(() => {
    isCompletingRef.current = isCompleting;
  }, [isCompleting]);

  // Tear-down fallback: if the row is unmounted mid-exit (e.g. the user navigates away before
  // the collapse animation ends), still commit the completion so it isn't dropped.
  React.useEffect(
    () => () => {
      if (isCompletingRef.current) runComplete();
    },
    [runComplete],
  );

  const begin = React.useCallback(() => {
    if (prefersReducedMotion) {
      runComplete();
      return;
    }
    setIsCompleting(true);
  }, [prefersReducedMotion, runComplete]);

  const onCollapseEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === 'grid-template-rows' &&
        isCompleting
      ) {
        runComplete();
      }
    },
    [isCompleting, runComplete],
  );

  return { isCompleting, begin, onCollapseEnd };
}
