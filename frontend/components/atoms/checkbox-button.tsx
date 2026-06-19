import * as React from 'react';

import { cn } from '@/lib/utils';

export type CheckboxButtonProperties = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * A small square "framed check" button — the centred, rounded, bordered control shared by the
 * task-row completion checkbox and the inline confirm-title checks (task row + epic header). It
 * bakes in the box geometry (`flex … items-center justify-center rounded border`) and the teal
 * focus ring; callers pass the size, fill/hover colours, any state animation, and the check icon
 * child via `className` / children, so each site keeps its exact appearance.
 *
 * Defaults to `type="button"` so it never submits a surrounding form by accident.
 */
const CheckboxButton = React.forwardRef<HTMLButtonElement, CheckboxButtonProperties>(
  ({ className, type, ...properties }, reference) => {
    return (
      <button
        type={type ?? 'button'}
        className={cn(
          'flex shrink-0 items-center justify-center rounded border',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          className,
        )}
        ref={reference}
        {...properties}
      />
    );
  },
);
CheckboxButton.displayName = 'CheckboxButton';

export { CheckboxButton };
