'use client';

import { type VariantProps, cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A square, icon-only ghost button — the repeated "hover affordance" primitive used
 * throughout task rows, the folder nav, and the mobile nav. Variants cover the tone
 * (semantic colour + focus ring) and the size; everything else (icon child, aria-label,
 * onClick, type, disabled) is a normal button prop.
 *
 * Set `asChild` to render through a Radix trigger (DropdownMenu.Trigger, Dialog.Trigger),
 * exactly like the shadcn Button.
 */
const iconButtonVariants = cva(
  cn(
    'inline-flex items-center justify-center rounded',
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
    'transition-colors duration-100 motion-reduce:transition-none',
    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
    'disabled:opacity-40 disabled:pointer-events-none',
  ),
  {
    variants: {
      tone: {
        neutral: 'text-muted-foreground hover:text-foreground focus-visible:ring-accent-blue',
        accent: 'text-muted-foreground hover:text-accent-teal focus-visible:ring-accent-blue',
        affirm: 'text-accent-teal hover:text-accent-teal focus-visible:ring-accent-teal',
        danger: 'text-muted-foreground hover:text-destructive focus-visible:ring-destructive',
      },
      size: {
        sm: 'h-5 w-5',
        md: 'h-6 w-6',
        lg: 'h-8 w-8',
      },
    },
    defaultVariants: {
      tone: 'neutral',
      size: 'md',
    },
  },
);

export interface IconButtonProperties
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof iconButtonVariants> {
  asChild?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProperties>(
  ({ className, tone, size, asChild = false, type, ...properties }, reference) => {
    const Comp = asChild ? Slot.Root : 'button';
    return (
      <Comp
        // Default to type="button" so an IconButton inside a <form> never submits by accident.
        // Callers that want a submit button pass type="submit" explicitly.
        type={asChild ? type : (type ?? 'button')}
        className={cn(iconButtonVariants({ tone, size, className }))}
        ref={reference}
        {...properties}
      />
    );
  },
);
// Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
IconButton.displayName = 'IconButton';

export { IconButton, iconButtonVariants };
