import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The shared pill / status-chip styling. The base is the rounded, dense `text-xs` pill
 * repeated across the type badge, the row count chips, and the factory-state chip; the
 * `variant` carries the tone. Font weight is left to the caller (the sites differ:
 * `font-medium` on the type badge, `font-semibold uppercase` on the state chip, none on
 * the count chips) — pass it via `className`.
 */
const badgeVariants = cva('shrink-0 rounded-full px-2 py-0.5 text-xs', {
  variants: {
    variant: {
      muted: 'border border-border/70 text-muted-foreground',
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
