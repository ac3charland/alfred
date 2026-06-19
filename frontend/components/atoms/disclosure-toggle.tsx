import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const disclosureToggleVariants = cva('focus:outline-none focus-visible:ring-2', {
  variants: {
    variant: {
      // A full-width collapsible-section header (e.g. an epic block): rounded row, hover wash,
      // blue focus ring. Children are the chevron + heading content.
      header: cn(
        'flex flex-1 items-center gap-2 rounded-xl px-4 py-3 text-left',
        'transition-colors duration-100 hover:bg-secondary/30 motion-reduce:transition-none',
        'focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      ),
      // A muted inline expand/collapse text toggle (e.g. "Show completed (n)"): small,
      // low-contrast, teal focus ring. Children are the label.
      inline: cn(
        'inline-flex items-center rounded-sm text-xs text-muted-foreground/70',
        'transition-colors duration-100 hover:text-foreground motion-reduce:transition-none',
        'focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
      ),
    },
  },
  defaultVariants: { variant: 'inline' },
});

export interface DisclosureToggleProperties
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof disclosureToggleVariants> {}

/**
 * An expand/collapse toggle for a disclosure region — the shared affordance behind a
 * section's header (`header`) and an inline "Show more/less" control (`inline`). Owns the
 * interaction + per-variant chrome; the parent supplies freeform children (chevron, label,
 * count) and wires `aria-expanded` / `aria-controls` / `onClick`.
 *
 * Defaults to `type="button"` so it never submits a surrounding form.
 */
const DisclosureToggle = React.forwardRef<HTMLButtonElement, DisclosureToggleProperties>(
  ({ className, variant, type, ...properties }, reference) => {
    return (
      <button
        type={type ?? 'button'}
        className={cn(disclosureToggleVariants({ variant }), className)}
        ref={reference}
        {...properties}
      />
    );
  },
);
DisclosureToggle.displayName = 'DisclosureToggle';

export { DisclosureToggle, disclosureToggleVariants };
