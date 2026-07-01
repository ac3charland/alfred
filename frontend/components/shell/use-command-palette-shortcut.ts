'use client';

import * as React from 'react';

/**
 * The global ⌘K (mac) / Ctrl K (win/linux) shortcut: a single window `keydown` listener that
 * claims the key from the browser's default (Firefox/Chrome bind it to the address/search bar,
 * `preventDefault`) and **toggles** the navigation palette open/closed.
 *
 * The sibling of `use-global-search-shortcut.ts` — same shape, different key, and a toggle
 * instead of a focus callback (a nav palette should always be reachable, so it fires globally,
 * including while another input is focused).
 */
export function useCommandPaletteShortcut(toggle: () => void): void {
  React.useEffect(() => {
    const onKey = (event_: KeyboardEvent) => {
      // ⌘K / Ctrl K only — bare, without Shift/Alt, so other K chords are untouched.
      if (
        (event_.metaKey || event_.ctrlKey) &&
        !event_.shiftKey &&
        !event_.altKey &&
        event_.key.toLowerCase() === 'k'
      ) {
        event_.preventDefault(); // claim it from the browser's address/search-bar default
        toggle();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => {
      globalThis.removeEventListener('keydown', onKey);
    };
  }, [toggle]);
}
