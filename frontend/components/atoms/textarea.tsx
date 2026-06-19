import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProperties extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Drop the bordered chrome (border / `bg-input` / teal focus ring) and render a bare,
   * transparent textarea. For the hero capture box, where the border + focus glow live on
   * the wrapping container via `focus-within`, not on the textarea itself.
   */
  unstyled?: boolean;
}

/**
 * A multiline text atom — the textarea counterpart to {@link Input} (full-width, bordered,
 * teal inline-edit ring). Used for the inline notes editors.
 *
 * Pass `unstyled` for a chrome-less transparent textarea (the capture box, whose frame is on
 * the wrapper). Callers add sizing / `resize-*` / `rows` via the usual textarea attributes.
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProperties>(
  ({ className, unstyled = false, ...properties }, reference) => {
    return (
      <textarea
        className={cn(
          'w-full resize-none text-sm text-foreground placeholder:text-muted-foreground focus:outline-none',
          !unstyled &&
            'rounded-sm border border-border bg-input px-2 py-1.5 focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          className,
        )}
        ref={reference}
        {...properties}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
