import { type RowHotkeyEvent, isHotkeyBlocked, rowHotkeyAction } from './hotkeys';

function press(key: string, overrides: Partial<RowHotkeyEvent> = {}): RowHotkeyEvent {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: document.body,
    ...overrides,
  };
}

describe('rowHotkeyAction', () => {
  it.each([
    ['j', 'next'],
    ['ArrowDown', 'next'],
    ['k', 'previous'],
    ['ArrowUp', 'previous'],
    ['o', 'open'],
    ['i', 'inbox'],
    ['n', 'nothing'],
    ['x', 'not_replying'],
    ['t', 'tier'],
    ['Escape', 'deselect'],
  ])('maps %s to %s', (key, action) => {
    expect(rowHotkeyAction(press(key))).toBe(action);
  });

  it('accepts the shifted letter — a caps-locked keyboard still drives the queue', () => {
    expect(rowHotkeyAction(press('N'))).toBe('nothing');
  });

  it('ignores a key with no meaning here', () => {
    expect(rowHotkeyAction(press('q'))).toBeUndefined();
  });

  it.each(['metaKey', 'ctrlKey', 'altKey'] as const)('ignores a %s chord', (modifier) => {
    expect(rowHotkeyAction(press('j', { [modifier]: true }))).toBeUndefined();
  });
});

describe('rowHotkeyAction — what owns the keystroke', () => {
  it('ignores typing in a text field', () => {
    const input = document.createElement('input');
    expect(rowHotkeyAction(press('n', { target: input }))).toBeUndefined();
  });

  it('ignores typing in a textarea', () => {
    const textarea = document.createElement('textarea');
    expect(rowHotkeyAction(press('x', { target: textarea }))).toBeUndefined();
  });

  it('ignores a select, whose own keys pick options', () => {
    const select = document.createElement('select');
    expect(rowHotkeyAction(press('t', { target: select }))).toBeUndefined();
  });

  it('ignores a contenteditable region', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not implement `isContentEditable`; the attribute is what it stores.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(rowHotkeyAction(press('i', { target: editable }))).toBeUndefined();
  });

  it('ignores a keystroke inside an open menu — Radix owns its own type-ahead', () => {
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('div');
    menu.append(item);

    expect(rowHotkeyAction(press('t', { target: item }))).toBeUndefined();
  });

  it('ignores Escape inside a dialog, which closes itself', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');

    expect(rowHotkeyAction(press('Escape', { target: dialog }))).toBeUndefined();
  });

  it('still fires for an ordinary element, and for a null target', () => {
    expect(rowHotkeyAction(press('j', { target: document.createElement('div') }))).toBe('next');
    expect(rowHotkeyAction(press('j', { target: null }))).toBe('next');
  });
});

describe('isHotkeyBlocked', () => {
  it('is false for a plain element', () => {
    expect(isHotkeyBlocked(document.createElement('span'))).toBe(false);
  });

  it('is false for a non-element target', () => {
    expect(isHotkeyBlocked(document)).toBe(false);
  });
});
