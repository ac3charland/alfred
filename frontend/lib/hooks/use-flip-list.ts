'use client';

import * as React from 'react';

import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';

/** The Play transition: clear the inverted offset over a short ease-out (matches the motion skill). */
const FLIP_TRANSITION = 'transform 200ms ease-out';

/**
 * A minimal FLIP (First → Last → Invert → Play) hook for a list whose rows **reorder** — a DOM
 * sibling reorder CSS can't transition on its own (and there's no Framer Motion in the stack).
 * Track each row by a stable key and attach the returned `register(key)` ref-callback to its
 * element. In a `useLayoutEffect` the hook reads each tracked row's previous and new
 * `getBoundingClientRect` (First/Last), sets a no-transition `translateY(Δ)` so the row appears
 * un-moved (Invert), then on the next frame clears the offset under `FLIP_TRANSITION` (Play), so
 * the rows glide to their new slots.
 *
 * Honours `prefers-reduced-motion`: when reduced it skips the transform entirely (rows snap).
 * See the motion skill — the first list-reorder FLIP in the library.
 *
 * Pass `keys` in the CURRENT render order. Only rows present in both the previous and the new
 * render animate; entering/leaving rows are left alone.
 */
export function useFlipList(
  keys: readonly string[],
): (key: string) => React.RefCallback<HTMLElement> {
  const prefersReducedMotion = usePrefersReducedMotion();
  // Maps held across renders, minted lazily on first use rather than passed as the `useRef`
  // initial argument — that would freeze their contents under react-hooks/immutability, and the
  // hook legitimately mutates the tracked DOM nodes' styles below.
  const nodesRef = React.useRef<Map<string, HTMLElement> | undefined>(undefined);
  const prevRectsRef = React.useRef<Map<string, DOMRect> | undefined>(undefined);
  const registrarsRef = React.useRef<Map<string, React.RefCallback<HTMLElement>> | undefined>(
    undefined,
  );

  // One memoized ref-callback per key, so the same identity is reused across renders (no
  // detach/reattach churn on a row that merely changed position).
  const register = React.useCallback((key: string): React.RefCallback<HTMLElement> => {
    const registrars = (registrarsRef.current ??= new Map<
      string,
      React.RefCallback<HTMLElement>
    >());
    const existing = registrars.get(key);
    if (existing !== undefined) return existing;
    const callback: React.RefCallback<HTMLElement> = (element) => {
      const nodes = (nodesRef.current ??= new Map<string, HTMLElement>());
      if (element === null) nodes.delete(key);
      else nodes.set(key, element);
    };
    registrars.set(key, callback);
    return callback;
  }, []);

  React.useLayoutEffect(() => {
    const nodes = (nodesRef.current ??= new Map<string, HTMLElement>());
    const prevRects = prevRectsRef.current ?? new Map<string, DOMRect>();

    if (!prefersReducedMotion) {
      // Invert: offset each persisting row by how far it moved, with no transition.
      for (const [key, node] of nodes) {
        const previous = prevRects.get(key);
        if (previous === undefined) continue;
        const deltaY = previous.top - node.getBoundingClientRect().top;
        if (deltaY !== 0) {
          node.style.transition = 'none';
          node.style.transform = `translateY(${String(deltaY)}px)`;
        }
      }
      // Play: next frame, release the offset under the transition so the row eases into place.
      requestAnimationFrame(() => {
        for (const node of nodes.values()) {
          if (node.style.transform === '') continue;
          node.style.transition = FLIP_TRANSITION;
          node.style.transform = '';
        }
      });
    }

    // Record the new rects as the baseline for the next reorder.
    const snapshot = new Map<string, DOMRect>();
    for (const [key, node] of nodes) snapshot.set(key, node.getBoundingClientRect());
    prevRectsRef.current = snapshot;
  }, [keys, prefersReducedMotion]);

  return register;
}
