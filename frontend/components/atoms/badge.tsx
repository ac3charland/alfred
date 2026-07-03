import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The shared pill / status-chip styling — the single source of the rounded, dense `text-xs`
 * pill repeated across the type badge, the row count chips, the factory-state chip, the
 * due-date chip, and the folder due-count badge. The `variant` carries the tone; font weight
 * is left to the caller (the sites differ: `font-medium` on the type/due chips,
 * `font-semibold uppercase` on the state chip, none on the count chips) — pass it via
 * `className`.
 *
 * Set `interactive` to add the hover/transition treatment, and `asButton` to render a clickable
 * `<button type="button">` instead of a `<span>` (e.g. the due-date chip). The raw button stays
 * inside this atom, so feature components get a clickable chip without a raw element of their own.
 */
const badgeVariants = cva('shrink-0 rounded-full px-2 py-0.5 text-xs', {
  variants: {
    variant: {
      // A bare pill — shape only, no tone. The caller supplies the colour via `className`
      // (e.g. the per-project backlog badge, whose colour is computed, not a fixed variant).
      plain: '',
      muted: 'border border-border/70 text-muted-foreground',
      secondary: 'bg-secondary text-muted-foreground',
      accent: 'bg-accent-teal/15 text-accent-teal',
      alert: 'bg-amber-500/15 text-amber-400',
      destructive: 'bg-destructive/15 text-destructive',
      due: 'border border-accent-blue/50 text-accent-blue',
      dueToday: 'border border-accent-amber/50 text-accent-amber',
      overdue: 'border border-accent-red/50 text-accent-red',
    },
    interactive: {
      true: 'transition-colors motion-reduce:transition-none',
      false: '',
    },
  },
  compoundVariants: [
    // The bordered chips darken their border on hover only when they're clickable.
    { variant: 'due', interactive: true, class: 'hover:border-accent-blue' },
    { variant: 'dueToday', interactive: true, class: 'hover:border-accent-amber' },
    { variant: 'overdue', interactive: true, class: 'hover:border-accent-red' },
  ],
  defaultVariants: {
    variant: 'muted',
    interactive: false,
  },
});

export interface BadgeProperties
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof badgeVariants> {
  /**
   * Render as a clickable `<button type="button">` instead of a `<span>`. The raw button stays
   * in this atom, so feature code gets a clickable chip without rendering a raw element itself.
   */
  asButton?: boolean;
}

/** A small status/label pill. Tone via `variant`; weight/case via `className`. */
export function Badge({
  className,
  variant,
  interactive,
  asButton = false,
  ...properties
}: BadgeProperties) {
  const classes = cn(badgeVariants({ variant, interactive }), className);
  if (asButton) {
    return <button type="button" className={classes} {...properties} />;
  }
  return <span className={classes} {...properties} />;
}

export { badgeVariants };
