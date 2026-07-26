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
        // A modal's "×" dismiss (see `DialogCloseButton`). A thumb reaches for this first, so
        // the REAL box is a ≥44px tap target on mobile — the size the rest of the app's mobile
        // controls use — with the glyph scaled to match so it isn't lost in the target. At md+
        // it collapses back to the dense header close pointer devices don't need enlarged.
        dialog:
          'inline-flex h-11 w-11 items-center justify-center text-2xl leading-none md:h-auto md:w-auto md:p-1 md:text-lg',
      },
    },
    defaultVariants: { variant: 'icon' },
  },
);

export interface CloseButtonProperties
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof closeButtonVariants> {}

/**
 * The shared dismiss control — one muted, teal-focus-ring close affordance in three
 * presentations: `icon` (an "X" glyph, e.g. a toast's close), `text` (a small "Close"
 * text link, e.g. the inline task meta panel), and `dialog` (a modal's "×", with a ≥44px
 * mobile tap target). Children are the icon (or, for `text`, default to the "Close" label).
 * Callers wire `aria-label` (for `icon` / `dialog`) and `onClick`.
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
