import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToggleButton } from './toggle-button';

describe('ToggleButton', () => {
  it('renders a button with its children', () => {
    render(
      <ToggleButton pressed={false} onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toBeInTheDocument();
  });

  it('reflects the pressed state via aria-pressed', () => {
    const { rerender } = render(
      <ToggleButton pressed={false} onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    rerender(
      <ToggleButton pressed onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );
    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies the pressed accent treatment when pressed', () => {
    render(
      <ToggleButton pressed onToggle={() => {}}>
        Show archived
      </ToggleButton>,
    );

    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveClass(
      'border-accent-teal/60',
      'bg-accent-teal/10',
      'text-accent-teal',
    );
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = jest.fn();
    const user = userEvent.setup();
    render(
      <ToggleButton pressed={false} onToggle={onToggle}>
        Show archived
      </ToggleButton>,
    );

    await user.click(screen.getByRole('button', { name: 'Show archived' }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
