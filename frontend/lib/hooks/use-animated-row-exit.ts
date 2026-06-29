'use client';

import * as React from 'react';

export interface AnimatedRowExit {
  /**
   * True while the exit animation plays — the caller keeps the row rendered and applies the
   * exit classes (height collapse + the per-exit treatment: completion's checkbox pop / text
   * fade, or deletion's fade-out) but has NOT yet committed the mutation. The store filters the
   * row out only once `onCommit` runs.
   */
  isExiting: boolean;
  /**
   * Begin the exit: play the animation, or — when motion is disabled — commit straight away
   * (there's no collapse animation whose end we could wait on).
   */
  begin: () => void;
  /**
   * Handler for the collapse wrapper's `onTransitionEnd`: the height collapse finishing is
   * what commits the mutation. Guarded so only the wrapper's own `grid-template-rows`
   * transition counts — child transitions (checkbox/title colour fades, the row fade-out, the
   * inner subtask grid) bubble up and must be ignored.
   */
  onCollapseEnd: (event: React.TransitionEvent<HTMLDivElement>) => void;
}

/**
 * The task-row exit animation, as a hook: the `isExiting` state, the once-only mutation fire,
 * and the navigate-away fallback. An exit (completion OR deletion) plays a height collapse and
 * only commits `onCommit` when the collapse transition ends — the row stays visible meanwhile
 * so the exit can play. See the `motion` skill's "animate-then-commit" pattern.
 *
 * Both the row-completion and row-deletion exits are this same mechanism; they differ only in
 * the visual treatment the caller layers on top (a checkbox pop + text fade vs a whole-row
 * fade-out) and the collapse timing, so the once-only / fallback plumbing lives here once.
 *
 * Two invariants are load-bearing and preserved exactly:
 * - **Commit exactly once.** `hasCommittedRef` gates `onCommit` so the collapse-end handler
 *   and the unmount fallback can't both fire it.
 * - **Navigate-away fallback.** If the row unmounts mid-exit (the user navigates away before
 *   `transitionend`), the unmount effect's cleanup still commits, so the mutation isn't
 *   silently dropped. `isExitingRef` lets that cleanup read the latest exiting state.
 */
export function useAnimatedRowExit(
  onCommit: () => Promise<void> | void,
  prefersReducedMotion: boolean,
): AnimatedRowExit {
  const [isExiting, setIsExiting] = React.useState(false);
  // `hasCommittedRef` keeps the mutation firing exactly once (animation end OR unmount);
  // `isExitingRef` lets the unmount fallback read the latest state.
  const hasCommittedRef = React.useRef(false);
  const isExitingRef = React.useRef(false);

  // Commit the mutation, at most once. On success the row is filtered out of view and unmounts
  // (already collapsed to 0 height, so no jump); on failure the store rolls back and a fresh,
  // non-exiting row remounts in its place.
  const runCommit = React.useCallback(() => {
    if (hasCommittedRef.current) return;
    hasCommittedRef.current = true;
    void (async () => {
      try {
        await onCommit();
      } catch {
        // The store already restored the row.
      }
    })();
  }, [onCommit]);

  // Keep the ref in sync so the unmount fallback below sees the latest exiting state.
  React.useEffect(() => {
    isExitingRef.current = isExiting;
  }, [isExiting]);

  // Tear-down fallback: if the row is unmounted mid-exit (e.g. the user navigates away before
  // the collapse animation ends), still commit so the mutation isn't dropped.
  React.useEffect(
    () => () => {
      if (isExitingRef.current) runCommit();
    },
    [runCommit],
  );

  const begin = React.useCallback(() => {
    if (prefersReducedMotion) {
      runCommit();
      return;
    }
    setIsExiting(true);
  }, [prefersReducedMotion, runCommit]);

  const onCollapseEnd = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === 'grid-template-rows' &&
        isExiting
      ) {
        runCommit();
      }
    },
    [isExiting, runCommit],
  );

  return { isExiting, begin, onCollapseEnd };
}
