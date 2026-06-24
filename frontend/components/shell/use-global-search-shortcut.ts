'use client';

import * as React from 'react';

/**
 * The global ⌘P (mac) / Ctrl P (win/linux) shortcut: a single window `keydown` listener that
 * claims the key from the browser's Print dialog (`preventDefault`) and focuses the top-bar
 * search field — focusing it is what opens the results dropdown, so there's no separate toggle.
 *
 * `SearchBox` passes a callback that focuses (and selects) its input ref. `enabled` lets the
 * inactive layout (the mobile field on a desktop viewport, or vice-versa) opt out so only one
 * listener ever claims the key.
 */
export function useGlobalSearchShortcut(focusSearch: () => void, enabled = true): void {
  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (event_: KeyboardEvent) => {
      // ⌘P / Ctrl P only — bare, without Shift/Alt, so other P chords are untouched.
      if (
        (event_.metaKey || event_.ctrlKey) &&
        !event_.shiftKey &&
        !event_.altKey &&
        event_.key.toLowerCase() === 'p'
      ) {
        event_.preventDefault(); // claim it from the browser Print dialog
        focusSearch();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [focusSearch, enabled]);
}
