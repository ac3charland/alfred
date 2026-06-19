import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const closeButtonVariants = cva(
  cn(
    'shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
  ),
  {
    variants: {
      variant: {
        // An icon "X" close (e.g. a toast). Children are the icon.
        icon: 'p-0.5',
        // A small text-link "Close" (e.g. the inline task meta panel). Children default to "Close".
        text: 'text-xs',
      },
    },
    defaultVariants: { variant: 'icon' },
  },
);

export interface CloseButtonProperties
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof closeButtonVariants> {}

/**
 * The shared dismiss control — one muted, teal-focus-ring close affordance in two
 * presentations: `icon` (an "X" glyph, e.g. a toast's close) and `text` (a small "Close"
 * text link, e.g. the inline task meta panel). Children are the icon (or, for `text`, default
 * to the "Close" label). Callers wire `aria-label` (for `icon`) and `onClick`.
 *
 * Defaults to `type="button"` so it never submits a surrounding form.
 */
const CloseButton = React.forwardRef<HTMLButtonElement, CloseButtonProperties>(
  ({ className, variant, type, children, ...properties }, reference) => {
    return (
      <button
        type={type ?? 'button'}
        className={cn(closeButtonVariants({ variant }), className)}
        ref={reference}
        {...properties}
      >
        {children ?? (variant === 'text' ? 'Close' : null)}
      </button>
    );
  },
);
CloseButton.displayName = 'CloseButton';

export { CloseButton, closeButtonVariants };
