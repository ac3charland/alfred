import * as React from 'react';

import { cn } from '@/lib/utils';

export type FieldLabelProperties = React.LabelHTMLAttributes<HTMLLabelElement>;

/**
 * The small uppercase "eyebrow" label that sits above an inline editable field
 * (e.g. the Due date / Notes fields in a task row). Renders a real `<label>` so it
 * associates with its control via `htmlFor`.
 */
const FieldLabel = React.forwardRef<HTMLLabelElement, FieldLabelProperties>(
  ({ className, htmlFor, ...properties }, reference) => {
    return (
      // htmlFor is pulled out and applied explicitly so the label↔control association
      // is statically visible (to a11y linting and to the consumer's `id`).
      <label
        ref={reference}
        htmlFor={htmlFor}
        className={cn(
          'text-xs font-semibold tracking-widest uppercase text-muted-foreground',
          className,
        )}
        {...properties}
      />
    );
  },
);
FieldLabel.displayName = 'FieldLabel';

export { FieldLabel };
