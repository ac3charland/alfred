'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface AnimatedHeightCollapseProperties {
  /** When true the region expands to its natural height; when false it collapses to 0. */
  open: boolean;
  children: React.ReactNode;
  /**
   * Called when the region's own height transition ends. Already filtered to this
   * element's `grid-template-rows` transition, so a nested collapse's transition (which
   * bubbles) never cross-fires — the caller can react to its own collapse finishing.
   */
  onTransitionEnd?: (event: React.TransitionEvent<HTMLDivElement>) => void;
  /** Applied to the inner `overflow-hidden` wrapper (e.g. opacity/stagger on the content). */
  className?: string;
  /**
   * Mark the collapsed region `aria-hidden` + `inert` so it leaves the accessibility tree and
   * can't take keyboard focus while closed (the DOM node stays mounted for the exit
   * animation). Defaults to mirroring `open` — pass `false` only when collapsed content must
   * stay reachable. RTL's `queryByRole` checks `aria-hidden`, so this is what hides collapsed
   * lists from role queries.
   */
  hideWhenClosed?: boolean;
  /** Override the outer wrapper's `data-testid` (defaults to `animated-height-collapse`). */
  testId?: string;
}

/**
 * Smoothly expands/collapses a region's height with the CSS grid-rows trick
 * (`grid-template-rows: 0fr ↔ 1fr`), the project's standard for animating `height: auto`.
 * The outer `grid` div drives the height via a 200ms ease-out transition; the inner
 * `overflow-hidden` div clips the content to the track. See the `motion` skill.
 */
export function AnimatedHeightCollapse({
  open,
  children,
  onTransitionEnd,
  className,
  hideWhenClosed = true,
  testId = 'animated-height-collapse',
}: AnimatedHeightCollapseProperties) {
  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    // Only our own grid-template-rows transition counts — child transitions (and other
    // properties) bubble up and must be ignored so nested collapses don't cross-fire.
    if (
      event.target === event.currentTarget &&
      event.propertyName === 'grid-template-rows' &&
      onTransitionEnd
    ) {
      onTransitionEnd(event);
    }
  };

  const hidden = hideWhenClosed && !open;

  return (
    <div
      data-testid={testId}
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      aria-hidden={hidden}
      inert={hidden}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className={cn('overflow-hidden', className)}>{children}</div>
    </div>
  );
}
