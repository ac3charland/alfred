'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

interface ToggleButtonProperties {
  pressed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

/** A pill toggle (Show archived / blocked filter, Collapse all), styled for the dense dark UI. */
export function ToggleButton({ pressed, onToggle, children }: ToggleButtonProperties) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-100 motion-reduce:transition-none',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        pressed
          ? 'border-accent-teal/60 bg-accent-teal/10 text-accent-teal'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
