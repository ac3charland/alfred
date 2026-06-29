'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface AnimatedHeightRevealProperties {
  /**
   * When true the region grows in (height 0 → auto) and its content fades in; when false it
   * shrinks back out and fades away, then the caller unmounts it via {@link onExited}.
   */
  open: boolean;
  /**
   * Called once the collapse animation finishes (the close direction only). The parent owns the
   * mount/unmount — it keeps this rendered through the exit and drops it here — so a closing
   * region survives long enough to animate even when the data that triggered it is already gone.
   */
  onExited: () => void;
  children: React.ReactNode;
  /** Applied to the inner fading layer (e.g. padding around the revealed content). */
  className?: string;
  /** Override the outer wrapper's `data-testid` (defaults to `animated-height-reveal`). */
  testId?: string;
}

/**
 * Reveals a region with a height-grow + fade on open and shrinks it back with a fade on close —
 * the two-way counterpart to {@link AnimatedHeightCollapse} (a transition that stays mounted) and
 * {@link AnimatedHeightEnter} (a one-shot entrance). Built from keyframe tokens so both directions
 * play on a class change: `animate-expand-y` / `animate-collapse-y` drive the `grid-template-rows`
 * height on the outer `grid` div, while the inner layer fades with `animate-fade-in` /
 * `animate-fade-out`. The `forwards` fill-mode baked into the collapse/fade-out tokens holds the
 * region at 0 through the gap between `animationend` and the parent's unmount (no flash — see the
 * `motion` skill).
 *
 * Unlike the collapse, the close direction ends in an unmount: the parent renders this through the
 * exit, and the wrapper's own (target-guarded) `onAnimationEnd` calls {@link onExited} so the
 * parent can drop it. Under reduced motion no animation runs, so the parent must unmount on its own
 * (no `animationend` to wait on) — gate the render flag on `prefers-reduced-motion` at the source.
 */
export function AnimatedHeightReveal({
  open,
  onExited,
  children,
  className,
  testId = 'animated-height-reveal',
}: AnimatedHeightRevealProperties) {
  const handleAnimationEnd = (event: React.AnimationEvent<HTMLDivElement>) => {
    // Only our own collapse counts — the inner fade (and any child animation) bubbles up, and the
    // expand-y entrance finishing is not an exit. Guard on both the target and the close direction.
    if (event.target === event.currentTarget && !open) {
      onExited();
    }
  };

  return (
    <div
      data-testid={testId}
      className={cn(
        'grid motion-reduce:animate-none',
        open ? 'animate-expand-y' : 'animate-collapse-y',
      )}
      onAnimationEnd={handleAnimationEnd}
      aria-hidden={!open}
    >
      <div className="overflow-hidden">
        <div
          className={cn(
            'motion-reduce:animate-none',
            open ? 'animate-fade-in' : 'animate-fade-out',
            className,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
