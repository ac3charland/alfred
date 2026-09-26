import { readerHotkeyAction } from './hotkeys';

/** A keystroke with no modifiers, aimed at nothing in particular. */
function press(key: string, overrides: Partial<Parameters<typeof readerHotkeyAction>[0]> = {}) {
  return readerHotkeyAction({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: null,
    ...overrides,
  });
}

describe('readerHotkeyAction — the key map', () => {
  it.each([
    ['j', 'next'],
    ['ArrowDown', 'next'],
    ['k', 'previous'],
    ['ArrowUp', 'previous'],
    ['i', 'send'],
    ['o', 'open'],
    ['e', 'archive'],
    ['v', 'overview'],
    ['Escape', 'deselect'],
  ])('reads %s as %s', (key, action) => {
    expect(press(key)).toBe(action);
  });

  it('is case-insensitive, so a capital letter still lands', () => {
    expect(press('J')).toBe('next');
    expect(press('E')).toBe('archive');
    expect(press('I')).toBe('send');
  });

  it(
    'binds neither Enter nor Space — the card and its verbs are focusable controls that the ' +
      'browser already activates with both',
    () => {
      expect(press('Enter')).toBeUndefined();
      expect(press(' ')).toBeUndefined();
    },
  );

  it('means nothing by any other key', () => {
    expect(press('q')).toBeUndefined();
    expect(press('ArrowLeft')).toBeUndefined();
    expect(press('1')).toBeUndefined();
  });
});

describe('readerHotkeyAction — when a keystroke is not a verb', () => {
  it.each(['metaKey', 'ctrlKey', 'altKey'] as const)('ignores a %s chord', (modifier) => {
    expect(press('e', { [modifier]: true })).toBeUndefined();
  });

  it('ignores a keystroke aimed at a text field', () => {
    const input = document.createElement('input');
    expect(press('e', { target: input })).toBeUndefined();
  });

  it('ignores a keystroke aimed at a contenteditable region', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not derive `isContentEditable` from the attribute, so state it outright.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(press('e', { target: editable })).toBeUndefined();
  });

  it('ignores a keystroke inside an open dialog, which owns its own keyboard', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    dialog.append(button);
    expect(press('e', { target: button })).toBeUndefined();
  });

  it('still reads a keystroke aimed at an ordinary element', () => {
    expect(press('e', { target: document.createElement('button') })).toBe('archive');
  });
});
