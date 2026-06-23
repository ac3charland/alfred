import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The shared pill / status-chip styling. The base is the rounded, dense `text-xs` pill
 * repeated across the type badge, the row count chips, the factory-state chip, and the
 * due-date chips; the `variant` carries the tone. Two tone families share the base:
 * `muted`/`info`/`warning` are *outlined* (border + coloured text), while
 * `secondary`/`accent`/`alert`/`destructive` are *filled* (tinted background). Font weight
 * is left to the caller (the sites differ: `font-medium` on the type/due chips,
 * `font-semibold uppercase` on the state chip, none on the count chips) — pass it via
 * `className`. Interactive sites (the due-date chip is a `<button>`) apply
 * `badgeVariants(...)` to their own element rather than rendering the `Badge` span.
 */
const badgeVariants = cva('shrink-0 rounded-full px-2 py-0.5 text-xs', {
  variants: {
    variant: {
      muted: 'border border-border/70 text-muted-foreground',
      info: 'border border-accent-blue/50 text-accent-blue',
      warning: 'border border-accent-amber/50 text-accent-amber',
      secondary: 'bg-secondary text-muted-foreground',
      accent: 'bg-accent-teal/15 text-accent-teal',
      alert: 'bg-amber-500/15 text-amber-400',
      destructive: 'bg-destructive/15 text-destructive',
    },
  },
  defaultVariants: {
    variant: 'muted',
  },
});

export interface BadgeProperties
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

/** A small status/label pill. Tone via `variant`; weight/case via `className`. */
export function Badge({ className, variant, ...properties }: BadgeProperties) {
  return <span className={cn(badgeVariants({ variant }), className)} {...properties} />;
}

export { badgeVariants };
