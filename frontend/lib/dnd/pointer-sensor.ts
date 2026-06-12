import { PointerSensor } from '@dnd-kit/core';
import type { PointerSensorOptions } from '@dnd-kit/core';
import type { PointerEvent } from 'react';

/**
 * Drag-and-drop from the whole task row, minus its controls (see the dnd-kit skill).
 *
 * The task row spreads the draggable listeners on its entire surface, so a press-and-drag
 * anywhere on it picks the row up. But the row also holds buttons (expand, complete, add
 * subtask, the kebab menu) and an inline edit input — a press on any of those must stay a
 * click / text selection, never the start of a drag. {@link RowPointerSensor} is the
 * activation guard that makes that distinction.
 */

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"]';

/**
 * True when `target` is, or sits inside, an interactive control (button, link, form field,
 * menu item). Walking up with `closest` covers nested content like the icon `<svg>` inside
 * a button. A drag must NOT start from one of these.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * A `PointerSensor` that begins a drag from any part of the draggable EXCEPT its interactive
 * controls. Mirrors dnd-kit's default activator (primary button only, fires `onActivation`)
 * and adds the {@link isInteractiveTarget} guard so the row's buttons and edit input keep
 * receiving clicks and text selection.
 */
export class RowPointerSensor extends PointerSensor {
  static override activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: PointerEvent, options: PointerSensorOptions): boolean => {
        if (!event.isPrimary || event.button !== 0) return false;
        if (isInteractiveTarget(event.target)) return false;
        // Call through `options` (not a destructured method) so `this` stays bound.
        options.onActivation?.({ event });
        return true;
      },
    },
  ];
}
