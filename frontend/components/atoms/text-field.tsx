import * as React from 'react';

import { cn } from '@/lib/utils';

export type TextFieldProperties = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * A single-line inline-edit text field — the bordered, `bg-input`, teal-focus-ring input
 * repeated across the compact capture box, inline title/due-date editing, and folder
 * create/rename forms. It bakes in the long focus-ring + border boilerplate; callers pass
 * sizing (`px-*`/`py-*`/`flex-1`) and behaviour props via the usual input attributes.
 *
 * (Distinct from `Input`, the full-width form field with the default ring used on the
 * login screen.)
 */
const TextField = React.forwardRef<HTMLInputElement, TextFieldProperties>(
  ({ className, type = 'text', ...properties }, reference) => {
    return (
      <input
        type={type}
        className={cn(
          'rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
          'placeholder:text-muted-foreground',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={reference}
        {...properties}
      />
    );
  },
);
// Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect.
TextField.displayName = 'TextField';

export { TextField };
