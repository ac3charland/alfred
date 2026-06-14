'use client';

import { X } from 'lucide-react';
import * as React from 'react';

import { CaptureBox } from '@/components/tasks/capture-box';
import { CollapseAllButton } from '@/components/tasks/collapse-all-button';
import { TaskList } from '@/components/tasks/task-list';
import { ViewLink } from '@/components/tasks/view-link';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

interface InboxScreenProperties {
  /** Whether the inbox list is revealed. Driven by the `?view=inbox` search param. */
  open: boolean;
}

const toggleLinkClass = cn(
  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground',
  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
  'transition-colors duration-150 hover:text-foreground motion-reduce:transition-none',
  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
);

/**
 * The landing + inbox screen, unified into a single route.
 *
 * - Landing (`open = false`): capture box centered vertically with flex-grow spacers.
 * - Inbox (`open = true`): capture box at top; the inbox list expands below via a
 *   grid-rows height animation. Spacers collapse (flex-grow 1 → 0) as the list
 *   expands, sliding the capture box up from center to its natural position.
 *
 * `open` is URL-driven (`/` vs `/?view=inbox`) rather than local state so that the
 * alfred wordmark — which lives in the layout, outside this component tree — can
 * return the user to the landing screen simply by linking to `/`. The list stays
 * mounted through its collapse animation so the exit can finish before it unmounts.
 */
export function InboxScreen({ open }: InboxScreenProperties) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Keep the list mounted while it collapses; unmount once the animation ends.
  // Derive the mount flag from `open` during render (React's recommended pattern
  // over a setState-in-effect): mount as soon as it opens, and — when motion is
  // disabled and there is no animation to wait on — unmount immediately on close.
  const [rendered, setRendered] = React.useState(open);
  if (open && !rendered) {
    setRendered(true);
  } else if (!open && rendered && prefersReducedMotion) {
    setRendered(false);
  }

  const handleAnimationEnd = (event_: React.AnimationEvent<HTMLDivElement>) => {
    // Ignore animations bubbling up from children; only react to our own collapse.
    if (event_.target === event_.currentTarget && !open) {
      setRendered(false);
    }
  };

  // Spacer class: flex-grow 1 (closed) collapses to 0 (open), centering the capture
  // box vertically on the landing screen. Two equal spacers share the available space.
  const spacerClass = cn(
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
    'transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none',
    open ? 'grow-0' : 'grow',
  );

  return (
    <div className="flex flex-col flex-1">
      {/* Top spacer: collapses when inbox opens, pushing capture box up */}
      <div className={spacerClass} data-testid="center-spacer-top" aria-hidden />

      {/* Capture box — the hero, always present on the landing/inbox screen */}
      <div className="mb-6">
        <CaptureBox />
      </div>

      {/* Subtle affordance: reveal the inbox list, or close it back to the landing */}
      <div className="flex justify-center">
        {open ? (
          <ViewLink href="/" aria-label="Close inbox" className={toggleLinkClass}>
            <X size={13} />
            Close
          </ViewLink>
        ) : (
          <ViewLink href="/?view=inbox" className={toggleLinkClass}>
            View inbox
          </ViewLink>
        )}
      </div>

      {/* Inbox list: expands from 0 height on open, collapses on close */}
      {rendered && (
        <div
          data-testid="inbox-reveal"
          className={cn(
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'grid',
            open ? 'animate-expand-y' : 'animate-collapse-y',
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'motion-reduce:animate-none',
          )}
          onAnimationEnd={handleAnimationEnd}
          aria-hidden={!open}
        >
          <div className="overflow-hidden">
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
                  Inbox
                </span>
                <CollapseAllButton scope={{ type: 'inbox' }} />
              </div>
              <TaskList scope={{ type: 'inbox' }} emptyMessage="Your inbox is empty" />
            </div>
          </div>
        </div>
      )}

      {/* Bottom spacer: mirrors top, collapses when inbox opens */}
      <div className={spacerClass} data-testid="center-spacer-bottom" aria-hidden />
    </div>
  );
}
