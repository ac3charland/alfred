import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
