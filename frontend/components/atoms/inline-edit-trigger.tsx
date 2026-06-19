import * as React from 'react';

import { cn } from '@/lib/utils';

export type InlineEditTriggerProperties = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The display-mode trigger of an inline editor: a left-aligned, `rounded-sm`, teal-focus-ring
 * button that swaps to an input/textarea on click. The repeated affordance for the task
 * meta-panel's due-date and notes fields and the epic header's notes. Callers add per-site
 * sizing / layout / hover via `className` and the display content via children.
 *
 * Defaults to `type="button"` so it never submits a surrounding form.
 */
const InlineEditTrigger = React.forwardRef<HTMLButtonElement, InlineEditTriggerProperties>(
  ({ className, type, ...properties }, reference) => {
    return (
      <button
        type={type ?? 'button'}
        className={cn(
          'rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal',
          className,
        )}
        ref={reference}
        {...properties}
      />
    );
  },
);
InlineEditTrigger.displayName = 'InlineEditTrigger';

export { InlineEditTrigger };
