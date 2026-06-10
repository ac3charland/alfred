'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskList } from '@/components/tasks/task-list';
import { cn } from '@/lib/utils';

interface InboxScreenProperties {
  /** Whether the inbox list is revealed. Driven by the `?view=inbox` search param. */
  open: boolean;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(callback: () => void): () => void {
  const query = globalThis.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', callback);
  return () => {
    query.removeEventListener('change', callback);
  };
}

const getReducedMotionSnapshot = (): boolean => globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;

// Server render has no matchMedia; assume motion is allowed so the markup matches
// the common client case and only corrects after hydration if needed.
const getReducedMotionServerSnapshot = (): boolean => false;

const toggleLinkClass = cn(
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground',
  'transition-colors duration-150 hover:text-foreground motion-reduce:transition-none',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
);

/**
 * The landing + inbox screen, unified into a single route.
 *
 * - Landing (`open = false`): just the capture box plus a subtle "View inbox" link.
 * - Inbox (`open = true`): the capture box plus the inbox task list, faded in below.
 *
 * `open` is URL-driven (`/` vs `/?view=inbox`) rather than local state so that the
 * alfred wordmark — which lives in the layout, outside this component tree — can
 * return the user to the landing screen simply by linking to `/`. The list stays
 * mounted through its fade-out so the exit animation can finish before it unmounts.
 */
export function InboxScreen({ open }: InboxScreenProperties) {
  const prefersReducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  // Keep the list mounted while it fades out; unmount once the animation ends.
  // Derive the mount flag from `open` during render (React's recommended pattern
  // over a setState-in-effect): mount as soon as it opens, and — when motion is
  // disabled and there is no fade-out to wait on — unmount immediately on close.
  const [rendered, setRendered] = React.useState(open);
  if (open && !rendered) {
    setRendered(true);
  } else if (!open && rendered && prefersReducedMotion) {
    setRendered(false);
  }

  const handleAnimationEnd = (event_: React.AnimationEvent<HTMLDivElement>) => {
    // Ignore animations bubbling up from children; only react to our own fade-out.
    if (event_.target === event_.currentTarget && !open) {
      setRendered(false);
    }
  };

  return (
    <>
      {/* Capture box — the hero, always present on the landing/inbox screen */}
      <div className="mb-6">
        <CaptureBox />
      </div>

      {/* Subtle affordance: reveal the inbox list, or close it back to the landing */}
      <div className="flex justify-center">
        {open ? (
          <Link href="/" aria-label="Close inbox" className={toggleLinkClass}>
            <X size={13} />
            Close
          </Link>
        ) : (
          <Link href="/?view=inbox" className={toggleLinkClass}>
            View inbox
          </Link>
        )}
      </div>

      {rendered && (
        <div
          data-testid="inbox-reveal"
          className={cn(
            'mt-6',
            open ? 'animate-fade-in' : 'animate-fade-out',
            'motion-reduce:animate-none',
          )}
          onAnimationEnd={handleAnimationEnd}
          aria-hidden={!open}
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
              Inbox
            </span>
          </div>
          <TaskList scope={{ type: 'inbox' }} emptyMessage="Your inbox is empty" />
        </div>
      )}
    </>
  );
}
