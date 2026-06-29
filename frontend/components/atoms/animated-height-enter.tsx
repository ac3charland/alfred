'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface AnimatedHeightEnterProperties {
  /**
   * Play the entrance on mount: the region expands its height from 0 (pushing whatever sits
   * below it down) while its content fades and slides in from above. When false the children
   * render unwrapped — every existing row is the common case, so we add no extra DOM for it.
   */
  entering: boolean;
  children: React.ReactNode;
  /** Override the outer wrapper's `data-testid` (defaults to `animated-height-enter`). */
  testId?: string;
}

/**
 * The entrance counterpart to {@link AnimatedHeightCollapse}: a one-shot reveal for a row that
 * has just been added to a visible list. The outer `grid` runs `animate-expand-y`
 * (`grid-template-rows: 0fr → 1fr`), growing the row from nothing and pushing the rows below it
 * down; the inner content fades and slides down into place (`animate-in` from above). Both are
 * CSS keyframes, so they play once on mount and never replay on a re-render. See the `motion`
 * skill.
 *
 * Unlike the collapse, there is no open/close prop — the animation is keyed to the mount, so a
 * caller flips `entering` on only for the freshly-inserted (optimistic) row.
 */
export function AnimatedHeightEnter({
  entering,
  children,
  testId = 'animated-height-enter',
}: AnimatedHeightEnterProperties) {
  if (!entering) return <>{children}</>;

  return (
    <div data-testid={testId} className="grid animate-expand-y motion-reduce:animate-none">
      <div className="overflow-hidden">
        <div
          className={cn(
            'animate-in fade-in-0 slide-in-from-top-2 duration-300 ease-out',
            'motion-reduce:animate-none',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
