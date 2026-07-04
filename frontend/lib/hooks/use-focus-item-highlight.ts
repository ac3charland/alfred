'use client';

import * as React from 'react';

import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';
import { consumeTaskFocus } from '@/components/tasks/navigate-to-task';

/** How long the post-navigation highlight ring lingers before it fades out. */
const HIGHLIGHT_MS = 1600;

/**
 * Scroll this row into view and flag a transient highlight whenever a "go to this task" jump names
 * its id. The caller attaches `ref` to its row element and toggles a ring class on `highlighted` (a
 * static ring under reduced motion — no pulse).
 *
 * A jump fires two ways so it lands regardless of mount timing (see `navigateToTaskAndFocus`): a row
 * already on screen catches the live event; a row that mounts *after* a cross-view switch claims the
 * pending target on mount. `scrollIntoView` is feature-detected because jsdom doesn't implement it.
 */
export function useFocusItemHighlight<T extends HTMLElement>(
  id: string,
): {
  ref: React.RefObject<T | null>;
  highlighted: boolean;
} {
  const ref = React.useRef<T>(null);
  const [highlighted, setHighlighted] = React.useState(false);

  React.useEffect(() => {
    const focusNow = () => {
      const node = ref.current;
      // `scrollIntoView` is unimplemented under jsdom, so feature-detect before calling.
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'center' });
      }
      setHighlighted(true);
    };
    // Cross-view jump: the request was recorded before this row existed, so claim it on mount.
    if (consumeTaskFocus(id)) {
      focusNow();
    }
    // Same-view jump: the request fires while this row is already mounted.
    const handle = (event_: Event) => {
      const detail = (event_ as CustomEvent<{ id: string }>).detail;
      if (detail.id !== id) return;
      // Clear the pending flag too, so a later remount of this row doesn't re-ring it.
      consumeTaskFocus(id);
      focusNow();
    };
    globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, handle);
    return () => {
      globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, handle);
    };
  }, [id]);

  React.useEffect(() => {
    if (!highlighted) return;
    const timer = globalThis.setTimeout(() => {
      setHighlighted(false);
    }, HIGHLIGHT_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [highlighted]);

  return { ref, highlighted };
}
