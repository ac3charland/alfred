import type { KeyboardEvent } from 'react';

import { RowKeyboardSensor } from './keyboard-sensor';

/**
 * Build a minimal React-style keydown event for the activator: it reads `nativeEvent.code`
 * and `target`, and calls `preventDefault`. Everything else dnd-kit's activator ignores.
 */
function makeKeyEvent(code: string, target: EventTarget | null) {
  const preventDefault = jest.fn();
  const event = { nativeEvent: { code }, target, preventDefault } as unknown as KeyboardEvent;
  return { event, preventDefault };
}

const activator = RowKeyboardSensor.activators[0];
if (activator === undefined) throw new Error('RowKeyboardSensor must define a keydown activator');
const { handler } = activator;

describe('RowKeyboardSensor activator', () => {
  it('lifts (returns true, prevents default, fires onActivation) on Space from a non-interactive target', () => {
    const onActivation = jest.fn();
    const { event, preventDefault } = makeKeyEvent('Space', document.createElement('div'));

    const result = handler(event, { onActivation });

    expect(result).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it('lifts on Enter as well (matching dnd-kit defaults)', () => {
    const onActivation = jest.fn();
    const { event } = makeKeyEvent('Enter', document.createElement('div'));

    expect(handler(event, { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it('does NOT lift when the keypress originates inside the inline edit input', () => {
    const onActivation = jest.fn();
    const { event, preventDefault } = makeKeyEvent('Space', document.createElement('input'));

    const result = handler(event, { onActivation });

    // The whole bug: Space inside the input must stay a typed space, not a drag —
    // so the activator bails without preventing the keystroke.
    expect(result).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onActivation).not.toHaveBeenCalled();
  });

  it('does NOT lift when the keypress originates on a row button', () => {
    const onActivation = jest.fn();
    const { event, preventDefault } = makeKeyEvent('Enter', document.createElement('button'));

    expect(handler(event, { onActivation })).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onActivation).not.toHaveBeenCalled();
  });

  it('ignores non-lift keys (e.g. ArrowDown) even from a draggable surface', () => {
    const onActivation = jest.fn();
    const { event, preventDefault } = makeKeyEvent('ArrowDown', document.createElement('div'));

    expect(handler(event, { onActivation })).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onActivation).not.toHaveBeenCalled();
  });

  it('respects a custom keyboardCodes.start set', () => {
    const onActivation = jest.fn();
    const { event } = makeKeyEvent('KeyD', document.createElement('div'));

    const result = handler(event, {
      keyboardCodes: { start: ['KeyD'], cancel: [], end: [] },
      onActivation,
    });

    expect(result).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });
});
