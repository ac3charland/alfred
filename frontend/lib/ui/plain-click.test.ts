import type * as React from 'react';

import { isPlainLeftClick } from './plain-click';

/** A minimal MouseEvent stand-in — only the fields the guard reads. */
function clickEvent(overrides: Partial<React.MouseEvent> = {}): React.MouseEvent {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as React.MouseEvent;
}

describe('isPlainLeftClick', () => {
  it('is true for an unmodified primary click', () => {
    expect(isPlainLeftClick(clickEvent())).toBe(true);
  });

  it('is false when default was already prevented', () => {
    expect(isPlainLeftClick(clickEvent({ defaultPrevented: true }))).toBe(false);
  });

  it('is false for a non-primary (e.g. middle) button', () => {
    expect(isPlainLeftClick(clickEvent({ button: 1 }))).toBe(false);
  });

  it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const)(
    'is false when %s is held',
    (modifier) => {
      expect(isPlainLeftClick(clickEvent({ [modifier]: true }))).toBe(false);
    },
  );
});
