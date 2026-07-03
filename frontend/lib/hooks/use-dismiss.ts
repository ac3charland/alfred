'use client';

import * as React from 'react';

/**
 * Any open Radix floating layer: a chip-picker popover / dropdown menu (both wrapped by the
 * Popper) or a dialog's content. All of these are PORTALED to `document.body`, so they sit
 * outside the dismissed surface's DOM subtree even though they belong to it logically.
 */
const FLOATING_LAYER_SELECTOR = '[data-radix-popper-content-wrapper],[role="dialog"]';

/**
 * Dismiss a transient inline surface on an outside pointer press or the Escape key.
 *
 * Attaches document-level listeners while `enabled`, so mount/enable the caller only while the
 * surface is open. A pointer press inside `ref`, or inside any open Radix floating layer (a chip
 * picker, a menu, a dialog — all portaled OUTSIDE `ref`), is ignored so interacting with those
 * never closes the surface. Escape is likewise deferred while a floating layer is open, so the
 * first Escape closes the innermost popover and only a later Escape closes this surface. Listens
 * on `pointerdown` (not click/blur) so it fires before focus moves — matching InlineEditField's
 * dismiss, which survives Radix restoring focus to a trigger.
 */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled = true,
): void {
  React.useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(FLOATING_LAYER_SELECTOR)) return;
      onDismiss();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Let an open picker / menu / dialog consume Escape first.
      if (document.querySelector(FLOATING_LAYER_SELECTOR)) return;
      onDismiss();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [ref, onDismiss, enabled]);
}
