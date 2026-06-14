import { KeyboardCode, KeyboardSensor } from '@dnd-kit/core';
import type { KeyboardSensorOptions } from '@dnd-kit/core';
import type { KeyboardEvent } from 'react';

import { isInteractiveTarget } from './pointer-sensor';

/**
 * Keyboard counterpart to {@link RowPointerSensor} (see the dnd-kit skill).
 *
 * The task row spreads the draggable listeners — including dnd-kit's keyboard activator —
 * across its whole surface. dnd-kit lifts a draggable when Space/Enter is pressed, so a
 * keydown that BUBBLES UP from a focused control inside the row (the inline title input, or
 * a row button) would otherwise start a phantom keyboard drag — and `preventDefault` would
 * swallow the very space the user meant to type, collapsing the editor behind the
 * DragOverlay. {@link RowKeyboardSensor} reuses {@link isInteractiveTarget} so typing in the
 * inline input, or pressing Space/Enter on a row button, stays a normal keystroke / click.
 */

// dnd-kit's default "lift" set is Space + Enter; we keep it identical and only ADD the
// interactive-target guard, so an accessible keyboard drag from a dedicated handle (were one
// ever added) would still behave the same.
const DEFAULT_START_CODES: readonly string[] = [KeyboardCode.Space, KeyboardCode.Enter];

export class RowKeyboardSensor extends KeyboardSensor {
  static override activators = [
    {
      eventName: 'onKeyDown' as const,
      handler: (event: KeyboardEvent, options: KeyboardSensorOptions): boolean => {
        const { code } = event.nativeEvent;
        const startCodes = options.keyboardCodes?.start ?? DEFAULT_START_CODES;
        if (!startCodes.includes(code)) return false;
        // The guard the default activator lacks: a press inside a button or the edit input
        // must stay a click / keystroke, never the start of a drag.
        if (isInteractiveTarget(event.target)) return false;
        event.preventDefault();
        // Call through `options` (not a destructured method) so `this` stays bound — same
        // as RowPointerSensor.
        options.onActivation?.({ event: event.nativeEvent });
        return true;
      },
    },
  ];
}
