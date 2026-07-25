import type * as React from 'react';

import { isSaveShortcut } from './save-shortcut';

/** A minimal KeyboardEvent stand-in — only the fields the guard reads. */
function keyEvent(overrides: Partial<React.KeyboardEvent> = {}): React.KeyboardEvent {
  return {
    key: 'Enter',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as React.KeyboardEvent;
}

describe('isSaveShortcut', () => {
  it('is true for ⌘+Enter', () => {
    expect(isSaveShortcut(keyEvent({ metaKey: true }))).toBe(true);
  });

  it('is true for Ctrl+Enter', () => {
    expect(isSaveShortcut(keyEvent({ ctrlKey: true }))).toBe(true);
  });

  it('is false for a bare Enter (which stays a newline)', () => {
    expect(isSaveShortcut(keyEvent())).toBe(false);
  });

  it.each(['shiftKey', 'altKey'] as const)('is false when %s is also held', (modifier) => {
    expect(isSaveShortcut(keyEvent({ metaKey: true, [modifier]: true }))).toBe(false);
  });

  it('is false for another key held with the modifier', () => {
    expect(isSaveShortcut(keyEvent({ key: 'k', metaKey: true }))).toBe(false);
  });
});
