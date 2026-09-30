import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';

import { SheetDialog, SheetFooter, useSheetFooterElement } from './dialog';
import { TextareaField } from './textarea-field';

function setup(overrides: Partial<React.ComponentProps<typeof TextareaField>> = {}) {
  const onChange = jest.fn();
  const onSave = jest.fn();
  const onCancel = jest.fn();
  render(
    <TextareaField
      value="hello"
      onChange={onChange}
      onSave={onSave}
      onCancel={onCancel}
      aria-label="Edit notes"
      {...overrides}
    />,
  );
  return { onChange, onSave, onCancel };
}

describe('TextareaField', () => {
  it('renders the current value and calls onChange when edited', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const textarea = screen.getByLabelText('Edit notes');
    expect(textarea).toHaveValue('hello');
    await user.type(textarea, '!');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onSave / onCancel from the default Save / Cancel buttons', async () => {
    const user = userEvent.setup();
    const { onSave, onCancel } = setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom save/cancel labels', () => {
    setup({ saveLabel: 'Confirm block', cancelLabel: 'Dismiss' });
    expect(screen.getByRole('button', { name: 'Confirm block' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('disables both actions while pending', () => {
    setup({ isPending: true });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it.each([
    ['⌘', '{Meta>}{Enter}{/Meta}'],
    ['Ctrl', '{Control>}{Enter}{/Control}'],
  ])('saves on %s+Enter', async (_label, chord) => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByLabelText('Edit notes'));
    await user.keyboard(chord);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('leaves a bare Enter to insert a newline instead of saving', async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByLabelText('Edit notes'));
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('ignores the save shortcut while a save is already in flight', async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ isPending: true });
    await user.click(screen.getByLabelText('Edit notes'));
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('calls onEscape when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onEscape = jest.fn();
    setup({ onEscape });
    await user.click(screen.getByLabelText('Edit notes'));
    await user.keyboard('{Escape}');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('caps the textarea when maxLength is given', () => {
    setup({ maxLength: 500 });
    expect(screen.getByLabelText('Edit notes')).toHaveAttribute('maxLength', '500');
  });

  it('leaves the textarea uncapped when maxLength is omitted (every existing call site)', () => {
    setup();
    expect(screen.getByLabelText('Edit notes')).not.toHaveAttribute('maxLength');
  });

  it('disables Save — but not Cancel — when the draft is not worth saving', async () => {
    const user = userEvent.setup();
    const { onSave, onCancel } = setup({ canSave: false });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // An unsavable draft is still one the user may want to abandon.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Edit notes'));
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the warning variant with an amber confirm and a caption label', () => {
    setup({
      variant: 'warning',
      label: 'Why is this blocked? (optional)',
      saveLabel: 'Confirm block',
    });
    expect(screen.getByText('Why is this blocked? (optional)')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm block' });
    expect(confirm).toHaveClass('bg-amber-500');
  });
});

/** A controlled harness, since the field is controlled and `autoGrow` follows its `value`. */
function Controlled(properties: Partial<React.ComponentProps<typeof TextareaField>>) {
  const [value, setValue] = React.useState('one');
  return (
    <TextareaField
      value={value}
      onChange={setValue}
      onSave={jest.fn()}
      onCancel={jest.fn()}
      aria-label="Edit notes"
      {...properties}
    />
  );
}

describe('TextareaField autoGrow', () => {
  const originals = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
  };

  /**
   * jsdom has no layout: a 20px line per newline-separated row, plus a 2px border in total. The
   * content height is read off the one textarea a test renders.
   */
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => (document.querySelector('textarea')?.value.split('\n').length ?? 1) * 20,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 102,
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get: () => 100,
    });
  });

  afterEach(() => {
    for (const [name, descriptor] of Object.entries(originals)) {
      const target = name === 'clientHeight' ? Element.prototype : HTMLElement.prototype;
      if (descriptor === undefined) Reflect.deleteProperty(target, name);
      else Object.defineProperty(target, name, descriptor);
    }
  });

  it('leaves the height to the browser by default (every existing call site)', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const textarea = screen.getByLabelText('Edit notes');

    await user.type(textarea, '{Enter}two{Enter}three');

    expect(textarea.style.height).toBe('');
    expect(textarea).not.toHaveClass('overflow-hidden');
  });

  it('sizes the textarea to its content on mount, adding the border the content box leaves out', () => {
    render(<Controlled autoGrow />);

    // 1 line = 20px of content, +2px for the border (offsetHeight 102 − clientHeight 100).
    expect(screen.getByLabelText('Edit notes').style.height).toBe('22px');
  });

  it('grows as the note gets longer, with no inner scroll left over', async () => {
    const user = userEvent.setup();
    render(<Controlled autoGrow />);
    const textarea = screen.getByLabelText('Edit notes');

    await user.type(textarea, '{Enter}two{Enter}three{Enter}four');

    expect(textarea.style.height).toBe('82px');
    // The editor never scrolls internally: the sheet around it is the one scroller.
    expect(textarea).toHaveClass('overflow-hidden');
  });

  it('shrinks again when text is deleted', async () => {
    const user = userEvent.setup();
    render(<Controlled autoGrow />);
    const textarea = screen.getByLabelText('Edit notes');
    await user.type(textarea, '{Enter}two{Enter}three');
    expect(textarea.style.height).toBe('62px');

    await user.clear(textarea);

    expect(textarea.style.height).toBe('22px');
  });

  describe('when the width changes', () => {
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = jest.fn();
    const originalObserver = globalThis.ResizeObserver;
    const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    let width = 300;
    let wrappedLines = 0;

    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = disconnect;
    }

    beforeEach(() => {
      callbacks.length = 0;
      disconnect.mockClear();
      width = 300;
      wrappedLines = 0;
      globalThis.ResizeObserver = FakeResizeObserver;
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get: () => width,
      });
      // The outer describe's scrollHeight stub counts newlines; a narrower field wraps more.
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () =>
          ((document.querySelector('textarea')?.value.split('\n').length ?? 1) + wrappedLines) * 20,
      });
    });

    afterEach(() => {
      globalThis.ResizeObserver = originalObserver;
      if (originalWidth === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      else Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalWidth);
    });

    function resize(next: number) {
      width = next;
      act(() => {
        for (const callback of callbacks) callback([], {} as ResizeObserver);
      });
    }

    it('re-measures, because a rotation re-wraps the text without changing it', () => {
      render(<Controlled autoGrow />);
      const textarea = screen.getByLabelText('Edit notes');
      expect(textarea.style.height).toBe('22px');

      wrappedLines = 2;
      resize(200);

      expect(textarea.style.height).toBe('62px');
    });

    it('leaves the height alone when only the height changed (its own resize does not loop)', () => {
      render(<Controlled autoGrow />);
      const textarea = screen.getByLabelText('Edit notes');

      wrappedLines = 2;
      resize(300);

      expect(textarea.style.height).toBe('22px');
    });

    it('stops watching on unmount, and never watches when autoGrow is off', () => {
      const view = render(<Controlled autoGrow />);
      view.unmount();
      expect(disconnect).toHaveBeenCalled();

      callbacks.length = 0;
      render(<Controlled autoGrow={false} />);
      expect(callbacks).toHaveLength(0);
    });
  });

  it('keeps the `rows` attribute, which sizes an empty field before there is text to measure', () => {
    render(<Controlled autoGrow rows={4} />);

    expect(screen.getByLabelText('Edit notes')).toHaveAttribute('rows', '4');
  });
});

describe('TextareaField focusOnMount', () => {
  it('is not focused on mount by default (every existing call site)', () => {
    render(<Controlled />);

    expect(screen.getByLabelText('Edit notes')).not.toHaveFocus();
  });

  it('focuses on mount with the caret at the end of the text, ready to type more', async () => {
    const user = userEvent.setup();
    render(<Controlled focusOnMount />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Edit notes');

    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);

    await user.keyboard('!');
    expect(textarea).toHaveValue('one!');
  });
});

describe('TextareaField actionsTarget', () => {
  function renderWithTarget(
    target: Element | null | undefined,
    overrides: Partial<React.ComponentProps<typeof TextareaField>> = {},
  ) {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    const view = render(
      <div>
        <div data-testid="field">
          <TextareaField
            value="hello"
            onChange={jest.fn()}
            onSave={onSave}
            onCancel={onCancel}
            aria-label="Edit notes"
            actionsTarget={target}
            {...overrides}
          />
        </div>
        <div data-testid="target" />
      </div>,
    );
    return { ...view, onSave, onCancel };
  }

  it('renders Save / Cancel inline, inside the field, when no target is given', () => {
    renderWithTarget(undefined);

    expect(screen.getByTestId('field')).toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    );
    expect(screen.getByTestId('field')).toContainElement(
      screen.getByRole('button', { name: 'Cancel' }),
    );
  });

  it('portals Save / Cancel into the given element instead', async () => {
    const user = userEvent.setup();
    const target = document.createElement('div');
    document.body.append(target);
    const { onSave, onCancel } = renderWithTarget(target);

    expect(target).toContainElement(screen.getByRole('button', { name: 'Save' }));
    expect(target).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('field')).not.toContainElement(
      screen.getByRole('button', { name: 'Save' }),
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    target.remove();
  });

  it('draws the portalled row as a full-width bar', () => {
    const target = document.createElement('div');
    document.body.append(target);
    renderWithTarget(target);

    const bar = screen.getByRole('button', { name: 'Save' }).parentElement;
    expect(bar).toHaveClass(
      'flex',
      'gap-2',
      'border-t',
      'border-border',
      'bg-surface',
      'px-4',
      'py-2',
    );
    target.remove();
  });

  it('keeps the warning variant right-aligned with its amber confirm in the bar', () => {
    const target = document.createElement('div');
    document.body.append(target);
    renderWithTarget(target, { variant: 'warning', saveLabel: 'Confirm block' });

    const confirm = screen.getByRole('button', { name: 'Confirm block' });
    expect(confirm).toHaveClass('bg-amber-500');
    expect(confirm.parentElement).toHaveClass('justify-end');
    target.remove();
  });

  it('renders no actions until the target exists (null), rather than flashing them inline', () => {
    renderWithTarget(null);

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('keeps the textarea focused when a bar button is pressed, so the keyboard stays up', () => {
    const target = document.createElement('div');
    document.body.append(target);
    renderWithTarget(target);

    // `fireEvent` returns false when the event's default was prevented — which is what stops the
    // press from moving focus off the textarea (and dropping the keyboard) before the click lands.
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Save' }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Cancel' }))).toBe(false);
    target.remove();
  });

  it('leaves the inline buttons alone (desktop behaviour is unchanged)', () => {
    renderWithTarget(undefined);

    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Save' }))).toBe(true);
  });

  describe('inside a sheet', () => {
    function SheetEditor() {
      const footer = useSheetFooterElement();
      return (
        <TextareaField
          value="hello"
          onChange={jest.fn()}
          onSave={jest.fn()}
          onCancel={jest.fn()}
          aria-label="Edit notes"
          actionsTarget={footer}
        />
      );
    }

    it("takes the sheet's footer while mounted, hiding its resting content", () => {
      const view = render(
        <SheetDialog open onOpenChange={jest.fn()}>
          <DialogPrimitive.Title>Story</DialogPrimitive.Title>
          <SheetFooter>
            <nav aria-label="Actions">bar</nav>
          </SheetFooter>
          <SheetEditor />
        </SheetDialog>,
      );

      const footer = screen.getByRole('dialog').querySelector('[data-sheet-footer]');
      expect(footer).toContainElement(screen.getByRole('button', { name: 'Save' }));
      expect(screen.queryByRole('navigation', { name: 'Actions' })).not.toBeInTheDocument();

      view.rerender(
        <SheetDialog open onOpenChange={jest.fn()}>
          <DialogPrimitive.Title>Story</DialogPrimitive.Title>
          <SheetFooter>
            <nav aria-label="Actions">bar</nav>
          </SheetFooter>
        </SheetDialog>,
      );
      expect(screen.getByRole('navigation', { name: 'Actions' })).toBeInTheDocument();
    });
  });
});
