import type { MouseEvent, TouchEvent } from 'react';

import { RowMouseSensor, RowTouchSensor, isInteractiveTarget } from './pointer-sensor';

/** Build a minimal React-style mousedown event for the mouse activator handler. */
function makeMouseEvent(overrides: { button?: number; target?: EventTarget | null } = {}) {
  const nativeEvent = {
    button: overrides.button ?? 0,
    target: overrides.target ?? document.createElement('div'),
  };
  return { nativeEvent } as unknown as MouseEvent;
}

/** Build a minimal React-style touchstart event for the touch activator handler. */
function makeTouchEvent(overrides: { touchCount?: number; target?: EventTarget | null } = {}) {
  const nativeEvent = {
    touches: { length: overrides.touchCount ?? 1 },
    target: overrides.target ?? document.createElement('div'),
  };
  return { nativeEvent } as unknown as TouchEvent;
}

describe('RowMouseSensor activator', () => {
  // Reaching activators[0].handler is itself the assertion that the activators array and its
  // entry exist (an empty array or empty object here throws at setup).
  const activator = RowMouseSensor.activators[0];
  if (activator === undefined) {
    throw new Error('RowMouseSensor must define a mousedown activator');
  }
  const { handler } = activator;

  it('starts a drag (returns true, fires onActivation with the native event) on a primary press', () => {
    const onActivation = jest.fn();
    const event = makeMouseEvent();

    const result = handler(event, { onActivation });

    expect(result).toBe(true);
    expect(onActivation).toHaveBeenCalledWith({ event: event.nativeEvent });
  });

  it('does not throw when no onActivation handler is supplied (optional chaining)', () => {
    const event = makeMouseEvent();
    expect(handler(event, {})).toBe(true);
  });

  it('does NOT start a drag from an interactive control', () => {
    const onActivation = jest.fn();
    const event = makeMouseEvent({ target: document.createElement('button') });

    expect(handler(event, { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });

  it('ignores a non-primary (e.g. right-click) button', () => {
    const onActivation = jest.fn();
    expect(handler(makeMouseEvent({ button: 2 }), { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });
});

describe('RowTouchSensor activator', () => {
  const activator = RowTouchSensor.activators[0];
  if (activator === undefined) {
    throw new Error('RowTouchSensor must define a touchstart activator');
  }
  const { handler } = activator;

  it('starts a drag (returns true, fires onActivation with the native event) on a single-finger press', () => {
    const onActivation = jest.fn();
    const event = makeTouchEvent();

    const result = handler(event, { onActivation });

    expect(result).toBe(true);
    expect(onActivation).toHaveBeenCalledWith({ event: event.nativeEvent });
  });

  it('does not throw when no onActivation handler is supplied (optional chaining)', () => {
    const event = makeTouchEvent();
    expect(handler(event, {})).toBe(true);
  });

  it('does NOT start a drag from an interactive control', () => {
    const onActivation = jest.fn();
    const event = makeTouchEvent({ target: document.createElement('button') });

    expect(handler(event, { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });

  it('ignores a multi-touch gesture (e.g. a pinch)', () => {
    const onActivation = jest.fn();
    expect(handler(makeTouchEvent({ touchCount: 2 }), { onActivation })).toBe(false);
    expect(onActivation).not.toHaveBeenCalled();
  });
});

describe('isInteractiveTarget', () => {
  it('returns false for a null target', () => {
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it('returns false for a plain, non-interactive element', () => {
    const div = document.createElement('div');
    expect(isInteractiveTarget(div)).toBe(false);
  });

  it('returns true for a button', () => {
    const button = document.createElement('button');
    expect(isInteractiveTarget(button)).toBe(true);
  });

  it('returns true for an input', () => {
    const input = document.createElement('input');
    expect(isInteractiveTarget(input)).toBe(true);
  });

  it('returns true for a textarea', () => {
    expect(isInteractiveTarget(document.createElement('textarea'))).toBe(true);
  });

  it('returns true for an element nested inside a button (e.g. the icon svg)', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.append(icon);
    expect(isInteractiveTarget(icon)).toBe(true);
  });

  it('returns true for an element with role="menuitem"', () => {
    const item = document.createElement('div');
    item.setAttribute('role', 'menuitem');
    expect(isInteractiveTarget(item)).toBe(true);
  });

  it('returns false for non-Element event targets', () => {
    expect(isInteractiveTarget(new EventTarget())).toBe(false);
  });
});
