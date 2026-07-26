'use client';

import * as React from 'react';

import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';

/** A priority nudge re-ranks on screen instantly; only the network sync waits this long. */
export const MOVE_SYNC_DEBOUNCE_MS = 200;

/** What an optimistic jump hands back: the priority a failed commit rolls the story back to. */
export interface MoveApplied {
  priorityBefore: number | null;
}

/**
 * The instant-apply + debounced-commit pattern shared by every top/bottom priority jump — the
 * Backlog row's chevron pairs and the story detail modal's priority controls: every click
 * re-ranks the story on screen immediately, but only ONE network call — the LATEST click's
 * direction, rolling back to the burst's ORIGINAL prior priority on failure — goes out once the
 * clicks settle. A jump is idempotent in its direction, so (unlike the neighbour-swap reorder)
 * it never needs to replay earlier clicks in the burst.
 *
 * Returns a `(toTop: boolean) => void`, inert while `storyRef` is null (the view row type is
 * all-nullable).
 */
export function useMoveBurst(
  storyRef: string | null,
  apply: (ref: string, toTop: boolean) => MoveApplied | null,
  commit: (ref: string, toTop: boolean, priorityBefore: number | null) => Promise<void>,
): (toTop: boolean) => void {
  const burstRef = React.useRef<{ toTop: boolean; priorityBefore: number | null } | null>(null);

  const flush = useDebouncedCallback(() => {
    const burst = burstRef.current;
    burstRef.current = null;
    if (burst !== null && storyRef !== null)
      void commit(storyRef, burst.toTop, burst.priorityBefore);
  }, MOVE_SYNC_DEBOUNCE_MS);

  return (toTop: boolean) => {
    if (storyRef === null) return;
    const applied = apply(storyRef, toTop);
    if (applied !== null) {
      // Keep the FIRST click's prior priority for the whole burst — later clicks never reach
      // the server, so that original is what a failed commit rolls back to.
      burstRef.current = {
        toTop,
        priorityBefore: burstRef.current?.priorityBefore ?? applied.priorityBefore,
      };
    }
    flush();
  };
}
