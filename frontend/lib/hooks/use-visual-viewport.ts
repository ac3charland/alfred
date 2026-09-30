'use client';

import * as React from 'react';

/** The part of the screen the user can actually see: what's left above the on-screen keyboard. */
export interface VisualViewportBox {
  height: number;
  /** How far iOS has panned the visible part down the layout viewport (0 unless a field forced it). */
  offsetTop: number;
}

// `useSyncExternalStore` compares snapshots with `Object.is`, so an identical reading must hand
// back the identical object or every scroll event would re-render its subscribers.
let lastBox: VisualViewportBox | null = null;

/** `undefined` where the API isn't implemented at all (jsdom, the server), `null` where it's off. */
function currentViewport(): VisualViewport | null | undefined {
  return globalThis.visualViewport;
}

function getSnapshot(): VisualViewportBox | null {
  const viewport = currentViewport();
  if (viewport === undefined || viewport === null) {
    lastBox = null;
    return null;
  }
  const { height, offsetTop } = viewport;
  if (lastBox?.height !== height || lastBox.offsetTop !== offsetTop) {
    lastBox = { height, offsetTop };
  }
  return lastBox;
}

function subscribe(callback: () => void): () => void {
  const viewport = currentViewport();
  if (viewport === undefined || viewport === null) {
    return () => {
      // Nothing was subscribed to.
    };
  }
  viewport.addEventListener('resize', callback);
  viewport.addEventListener('scroll', callback);
  return () => {
    viewport.removeEventListener('resize', callback);
    viewport.removeEventListener('scroll', callback);
  };
}

/**
 * The visible viewport's height and offset, live. On iOS Safari the on-screen keyboard does not
 * resize the layout viewport, and `100dvh` ignores it too, so a fixed element sized to either
 * ends up half under the keyboard; `window.visualViewport` is the one measure that shrinks with
 * it. Returns `null` where the API is absent (older browsers, the server) so a caller can fall
 * back to `100dvh`.
 */
export function useVisualViewport(): VisualViewportBox | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}
