'use client';

import * as React from 'react';

import { ALFRED_FOCUS_ITEM_EVENT } from '@/components/tasks/alfred-link';

/** How long the post-navigation highlight ring lingers before it fades out. */
const HIGHLIGHT_MS = 1600;

/**
 * Listen for the global-search focus event and, when it names this row's id, scroll the row
 * into view and flag a transient highlight. The caller attaches `ref` to its row element and
 * toggles a ring class on `highlighted` (a static ring under reduced motion — no pulse).
 *
 * `scrollIntoView` is feature-detected because jsdom doesn't implement it.
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
    const handle = (event_: Event) => {
      const detail = (event_ as CustomEvent<{ id: string }>).detail;
      if (detail.id !== id) return;
      const node = ref.current;
      // `scrollIntoView` is unimplemented under jsdom, so feature-detect before calling.
      if (node && typeof node.scrollIntoView === 'function') {
        node.scrollIntoView({ block: 'center' });
      }
      setHighlighted(true);
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
