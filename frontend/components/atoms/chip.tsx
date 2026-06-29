'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export type ChipProperties = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A clickable chip — the rounded, bordered pill button behind the task-detail chip row
 * (Due · Repeat · Priority). Owns the shared chip geometry (radius 9, 6×12 padding, 13px, the
 * teal focus ring); the caller supplies the tone (text / fill / border) via `className`.
 * forwardRef so it can be a Radix Popover trigger (`asChild`) and receive the anchor ref.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProperties>(
  ({ className, type, ...properties }, reference) => (
    <button
      type={type ?? 'button'}
      ref={reference}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-1.5 text-[13px] font-medium',
        'transition-colors motion-reduce:transition-none focus:outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1',
        'focus-visible:ring-offset-background',
        className,
      )}
      {...properties}
    />
  ),
);
Chip.displayName = 'Chip';
