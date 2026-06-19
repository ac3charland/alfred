import * as React from 'react';

import { cn } from '@/lib/utils';

export type ClickableCardProperties = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * An interaction shell for a clickable region that wraps freeform content: a full-width,
 * left-aligned `<button>` that owns ONLY the interaction concern (the click/keyboard target
 * + the default-outline reset) and renders arbitrary `children`. The visible focus/hover
 * chrome lives on the surrounding card wrapper (e.g. `focus-within` on the parent), and the
 * parent supplies its own padding/layout via `className`.
 *
 * Used for the story-card body; reusable anywhere a clickable surface surrounds composed
 * content. Defaults to `type="button"` so it never submits a surrounding form.
 */
const ClickableCard = React.forwardRef<HTMLButtonElement, ClickableCardProperties>(
  ({ className, type, ...properties }, reference) => {
    return (
      <button
        type={type ?? 'button'}
        className={cn('block w-full text-left focus:outline-none', className)}
        ref={reference}
        {...properties}
      />
    );
  },
);
ClickableCard.displayName = 'ClickableCard';

export { ClickableCard };
