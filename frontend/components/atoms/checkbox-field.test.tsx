import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckboxField } from './checkbox-field';

describe('CheckboxField', () => {
  it('exposes a checkbox named by its label', () => {
    render(<CheckboxField label="Needs refinement" checked onCheckedChange={jest.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Needs refinement' })).toBeInTheDocument();
  });

  it('reports its checked state to assistive tech', () => {
    const { rerender } = render(
      <CheckboxField label="Needs refinement" checked onCheckedChange={jest.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Needs refinement' })).toBeChecked();

    rerender(
      <CheckboxField label="Needs refinement" checked={false} onCheckedChange={jest.fn()} />,
    );
    expect(screen.getByRole('checkbox', { name: 'Needs refinement' })).not.toBeChecked();
  });

  it('reports the OPPOSITE of its current value on click (a toggle, not a set)', async () => {
    const onCheckedChange = jest.fn();
    const user = userEvent.setup();
    render(<CheckboxField label="Needs refinement" checked onCheckedChange={onCheckedChange} />);

    await user.click(screen.getByRole('checkbox', { name: 'Needs refinement' }));

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('renders the hint alongside the label', () => {
    render(
      <CheckboxField
        label="Needs refinement"
        checked={false}
        onCheckedChange={jest.fn()}
        hint="Unchecked — creates the story straight in Ready for Dev."
      />,
    );

    expect(screen.getByText(/straight in ready for dev/i)).toBeInTheDocument();
  });

  it('is inert while disabled', async () => {
    const onCheckedChange = jest.fn();
    const user = userEvent.setup();
    render(
      <CheckboxField label="Needs refinement" checked disabled onCheckedChange={onCheckedChange} />,
    );

    const box = screen.getByRole('checkbox', { name: 'Needs refinement' });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('names the control exactly once (the label is not read as separate text)', () => {
    // A `<label htmlFor>` can't name a button, so the association runs the other way — the
    // box points at the label's id. Two names would make a screen reader say it twice.
    render(<CheckboxField label="Needs refinement" checked onCheckedChange={jest.fn()} />);

    const box = screen.getByRole('checkbox', { name: 'Needs refinement' });
    expect(box).not.toHaveAttribute('aria-label');
    expect(box).toHaveAttribute('aria-labelledby');
  });
});
