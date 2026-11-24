'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface ToggleButtonProperties {
  pressed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Layout tweaks for the row this toggle sits in (e.g. matching a neighbour's height). */
  className?: string;
  /** A tooltip for the button itself — e.g. what pausing/resuming actually does. */
  title?: string | undefined;
  /**
   * The colour it lights in when pressed: teal for a filter or mode (the default), green or red
   * when the toggle records an answer, as a habit's Yes / No pair does.
   */
  tone?: 'accent' | 'affirm' | 'deny';
}

const PRESSED_TONE = {
  accent: 'border-accent-teal/60 bg-accent-teal/10 text-accent-teal',
  affirm: 'border-accent-green bg-accent-green/15 text-accent-green',
  deny: 'border-accent-red bg-accent-red/15 text-accent-red',
} as const;

/** A pill toggle (Show archived / blocked filter, Collapse all), styled for the dense dark UI. */
export function ToggleButton({
  pressed,
  onToggle,
  children,
  className,
  title,
  tone = 'accent',
}: ToggleButtonProperties) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-100 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        pressed ? PRESSED_TONE[tone] : 'border-border text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
