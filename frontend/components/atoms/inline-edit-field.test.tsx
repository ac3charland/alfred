import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { InlineEditField } from './inline-edit-field';

/**
 * Controlled harness: InlineEditField is presentational, so a tiny stateful wrapper drives
 * `value`/`onChange` the way every real call site does. Spies capture submit/cancel.
 */
function Harness({
  initialValue = '',
  onSubmit = jest.fn(),
  onCancel = jest.fn(),
  requireValue,
  selectAllOnFocus,
}: {
  initialValue?: string;
  onSubmit?: () => void;
  onCancel?: () => void;
  requireValue?: boolean;
  selectAllOnFocus?: boolean;
}) {
  const [value, setValue] = React.useState(initialValue);
  return (
    <div>
      <button type="button">outside</button>
      <InlineEditField
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        onCancel={onCancel}
        confirmLabel="Confirm name"
        inputLabel="Name"
        placeholder="Type a name…"
        {...(requireValue === undefined ? {} : { requireValue })}
        {...(selectAllOnFocus === undefined ? {} : { selectAllOnFocus })}
      />
    </div>
  );
}

describe('InlineEditField', () => {
  it('focuses the input on mount', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('selects the existing text on mount when selectAllOnFocus is set', () => {
    render(<Harness initialValue="Existing" selectAllOnFocus />);
    const input = screen.getByLabelText<HTMLInputElement>('Name');
    // The whole value is selected on focus, so the next keystroke replaces it.
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Existing'.length);
  });

  it('does not select the existing text on mount by default', () => {
    render(<Harness initialValue="Existing" />);
    const input = screen.getByLabelText<HTMLInputElement>('Name');
    // No selection: caret sits at the end, so typing appends rather than replaces.
    expect(input.selectionStart).toBe(input.selectionEnd);
  });

  it('calls onChange as the user types', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Name'), 'Hello');
    expect(screen.getByLabelText('Name')).toHaveValue('Hello');
  });

  it('submits on Enter', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<Harness initialValue="Ready" onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Name'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn();
    render(<Harness initialValue="Ready" onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Confirm name' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    render(<Harness initialValue="Draft" onCancel={onCancel} />);
    await user.type(screen.getByLabelText('Name'), '{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels when a pointerdown lands outside the field', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    render(<Harness initialValue="Draft" onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel when a pointerdown lands inside the field', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    render(<Harness initialValue="Draft" onCancel={onCancel} />);
    await user.click(screen.getByLabelText('Name'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('removes the document listener on unmount', async () => {
    const user = userEvent.setup();
    const onCancel = jest.fn();
    const { unmount } = render(<Harness initialValue="Draft" onCancel={onCancel} />);
    unmount();
    await user.click(document.body);
    expect(onCancel).not.toHaveBeenCalled();
  });

  describe('requireValue (default)', () => {
    it('disables the confirm button while the value is empty', () => {
      render(<Harness initialValue="" />);
      expect(screen.getByRole('button', { name: 'Confirm name' })).toBeDisabled();
    });

    it('disables the confirm button while the value is only whitespace', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.type(screen.getByLabelText('Name'), ' '.repeat(3));
      expect(screen.getByRole('button', { name: 'Confirm name' })).toBeDisabled();
    });

    it('ignores Enter while the value is empty', async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<Harness onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe('requireValue=false', () => {
    it('keeps the confirm button enabled while empty', () => {
      render(<Harness requireValue={false} />);
      expect(screen.getByRole('button', { name: 'Confirm name' })).not.toBeDisabled();
    });

    it('submits on Enter even when empty (caller decides what empty means)', async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<Harness requireValue={false} onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
