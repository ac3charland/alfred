'use client';

import { Popover as PopoverPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The picker popover used by the task-detail chip row — a Radix Popover styled to the design's
 * deep-popover chrome (a touch darker than the menu surface: `#0d1320` fill, `#25324a` border,
 * radius 12, soft drop shadow). Radix owns the anchoring (below the chip, start-aligned, 6px
 * gap) and outside-click / Escape dismissal, so each chip picker only supplies its content.
 *
 * `Popover` (controlled `open`/`onOpenChange` so a selection can close it), `PopoverTrigger`
 * (the chip, via `asChild`) and `PopoverContent` (the panel) are the surface a caller composes.
 */
const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-50 rounded-xl border border-[#25324a] bg-[#0d1320] p-1 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)]',
        'focus:outline-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        'motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
