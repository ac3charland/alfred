import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CheckboxButton } from './checkbox-button';

describe('CheckboxButton', () => {
  it('renders a button with its accessible name and children', () => {
    render(
      <CheckboxButton aria-label="Mark complete">
        <span>check</span>
      </CheckboxButton>,
    );

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
  });

  it('defaults to type="button" so it never submits a form', () => {
    render(<CheckboxButton aria-label="Confirm" />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveAttribute('type', 'button');
  });

  it('respects an explicit type', () => {
    render(<CheckboxButton aria-label="Submit" type="submit" />);

    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
  });

  it('applies the shared box geometry and teal focus ring', () => {
    render(<CheckboxButton aria-label="Confirm" />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass(
      'flex',
      'shrink-0',
      'items-center',
      'justify-center',
      'rounded',
      'border',
      'focus-visible:ring-accent-teal',
    );
  });

  it('merges a caller className for the per-site size / fill', () => {
    render(<CheckboxButton aria-label="Confirm" className="h-5 w-5 bg-accent-teal" />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toHaveClass(
      'h-5',
      'w-5',
      'bg-accent-teal',
    );
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<CheckboxButton aria-label="Confirm" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
