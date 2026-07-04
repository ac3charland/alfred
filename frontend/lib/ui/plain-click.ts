import type * as React from 'react';

/**
 * Whether a click on an anchor should be intercepted for client-side navigation. A "plain" left
 * click is the only one we hijack: we let the browser handle anything a consumer already prevented,
 * a non-primary button (middle-click → new tab), or a modified click (⌘/Ctrl/Shift/Alt → new
 * tab/window), so those keep their native behaviour and a hard load still works.
 *
 * Shared by every client-side link affordance (the wordmark, view links, the By-Priority rows) so
 * the modifier ladder is defined once.
 */
export function isPlainLeftClick(event: React.MouseEvent): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
