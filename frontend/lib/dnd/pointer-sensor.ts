import { MouseSensor, TouchSensor } from '@dnd-kit/core';
import type { MouseSensorOptions, TouchSensorOptions } from '@dnd-kit/core';
import type { MouseEvent, TouchEvent } from 'react';

/**
 * Drag-and-drop from the whole row (or card), minus its controls (see the dnd-kit skill).
 *
 * A task row — and, on the Code board, a story card — spreads the draggable listeners on its
 * entire surface, so a press-and-drag anywhere on it picks it up. But it also holds buttons
 * (expand, complete, add subtask, the kebab menu; a card's launch chips) and an inline edit
 * input — a press on any of those must stay a click / text selection, never the start of a
 * drag. {@link RowMouseSensor} and {@link RowTouchSensor} are the activation guards that make
 * that distinction, with {@link DRAG_SURFACE_ATTRIBUTE} as the opt-out for a control that IS
 * the drag surface.
 *
 * A single unified pointer sensor can't behave differently for a mouse than for a finger:
 * its one activation constraint applies to every input. A `distance` threshold is right for
 * a mouse (a small deliberate drag) but wrong for touch, where a swipe past that threshold
 * is indistinguishable from the start of a scroll — so the sensor steals the gesture and the
 * list can't be scrolled. Splitting into a mouse sensor and a touch sensor lets dnd-kit route
 * each input to the sensor listening for it (mouse → `mousedown`, touch → `touchstart`) and
 * give each its own activation rule: distance for mouse, press-and-hold for touch. Each input
 * is routed independently, so a hybrid touchscreen-laptop gets the right behaviour per input
 * with no viewport/media-query guessing.
 */

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"]';

/**
 * Opts one interactive control OUT of the guard below, marking it as part of the draggable's
 * surface. Some draggables are interactive all the way across — a code story's card body is a
 * button that opens its detail modal — so without an opt-out they'd have nowhere to lift from.
 * The control keeps its click: a press that never travels far enough to clear the sensor's
 * activation distance is still a plain click.
 */
export const DRAG_SURFACE_ATTRIBUTE = 'data-drag-surface';

/** Spread onto the interactive element that IS the draggable's surface. */
export const dragSurfaceProperty = { [DRAG_SURFACE_ATTRIBUTE]: '' };

/**
 * True when `target` is, or sits inside, an interactive control (button, link, form field,
 * menu item) that isn't marked as a {@link DRAG_SURFACE_ATTRIBUTE drag surface}. Walking up
 * with `closest` covers nested content like the icon `<svg>` inside a button. A drag must NOT
 * start from one of these.
 *
 * Only the NEAREST interactive ancestor decides, so a control inside a marked surface (a card's
 * launch chip) still blocks the drag and keeps its own click.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && !interactive.hasAttribute(DRAG_SURFACE_ATTRIBUTE);
}

/**
 * A `MouseSensor` that begins a drag from any part of the draggable EXCEPT its interactive
 * controls. Mirrors dnd-kit's default mouse activator (ignore non-primary buttons, fire
 * `onActivation`) and adds the {@link isInteractiveTarget} guard so the row's buttons and
 * edit input keep receiving clicks and text selection. Paired with a `{ distance: 8 }`
 * constraint in the provider so a plain click isn't read as the start of a drag.
 */
export class RowMouseSensor extends MouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent: event }: MouseEvent, options: MouseSensorOptions): boolean => {
        if (event.button !== 0) return false;
        if (isInteractiveTarget(event.target)) return false;
        // Call through `options` (not a destructured method) so `this` stays bound.
        options.onActivation?.({ event });
        return true;
      },
    },
  ];
}

/**
 * A `TouchSensor` that begins a drag from any part of the draggable EXCEPT its interactive
 * controls. Mirrors dnd-kit's default touch activator (ignore multi-touch, fire
 * `onActivation`) and adds the {@link isInteractiveTarget} guard. Paired with a
 * `{ delay, tolerance }` constraint in the provider so a plain swipe scrolls the list and
 * only a press-and-hold lifts the row.
 */
export class RowTouchSensor extends TouchSensor {
  static override activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent: event }: TouchEvent, options: TouchSensorOptions): boolean => {
        if (event.touches.length > 1) return false;
        if (isInteractiveTarget(event.target)) return false;
        // Call through `options` (not a destructured method) so `this` stays bound.
        options.onActivation?.({ event });
        return true;
      },
    },
  ];
}
