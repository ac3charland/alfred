import type * as React from 'react';

/**
 * Whether a keydown in a multiline editor should commit it. ⌘↵ (macOS) / Ctrl+↵ (elsewhere) is the
 * platform-standard "submit this textarea" gesture; a bare Enter stays a newline, so a notes body
 * can still be typed across several lines. Shift / Alt are excluded so a chord that means something
 * else doesn't save by accident.
 *
 * Shared by every notes editor (the task detail panel, the `TextareaField` inline editors) so the
 * modifier ladder is defined once.
 */
export function isSaveShortcut(event: React.KeyboardEvent): boolean {
  return (
    event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
  );
}
