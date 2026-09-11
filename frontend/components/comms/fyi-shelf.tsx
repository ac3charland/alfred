'use client';

import { ChevronRight } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { cn } from '@/lib/utils';

/**
 * The FYI shelf: everything that was judged to owe no reply, plus everything that has
 * already left the queue.
 *
 * Unbadged and collapsed by default, and both are decisions rather than styling. A count here
 * would make it a second queue and the module would have two inboxes again — the exact failure
 * it exists to remove. Collapsed because it is an archive, not a to-do list.
 *
 * What it buys is that a false negative stays recoverable: a message the classifier wrongly
 * shelved is here, and can be promoted back into the queue from its own tier picker. What it
 * does NOT buy is the recovery happening — nothing forces this open, which is the honest limit
 * of storing everything.
 */

interface FyiShelfProperties {
  /** How many rows are on the shelf — read in the summary line, never as a badge. */
  count: number;
  /** Told to the view, which walks shelf rows with `j`/`k` only while they are visible. */
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export function FyiShelf({ count, onOpenChange, children }: FyiShelfProperties) {
  const [open, setOpen] = React.useState(false);
  // The shelf is thousands of rows by design, so they are not mounted until it is first
  // opened — a collapsed region still renders its children, and this one would be the most
  // expensive thing on a page whose whole promise is that it can be glanced at.
  const [everOpened, setEverOpened] = React.useState(false);
  const regionId = React.useId();

  return (
    <section className="flex flex-col gap-1 rounded-xl border border-border/60 p-3">
      <DisclosureToggle
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) setEverOpened(true);
          onOpenChange?.(next);
        }}
        className="gap-1.5 self-start"
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          className={cn(
            'shrink-0 transition-transform duration-150 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span>
          FYI · {count.toLocaleString('en-US')} {count === 1 ? 'message' : 'messages'} · no reply
          owed — open to review
        </span>
      </DisclosureToggle>

      <AnimatedHeightCollapse open={open} testId="fyi-shelf-collapse">
        <div id={regionId} className="flex flex-col pt-1">
          {everOpened && children}
        </div>
      </AnimatedHeightCollapse>
    </section>
  );
}
