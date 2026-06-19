import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CloseButton } from './close-button';

describe('CloseButton', () => {
  it('text variant defaults its label to "Close"', () => {
    render(<CloseButton variant="text" />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('text variant accepts custom children', () => {
    render(<CloseButton variant="text">Dismiss</CloseButton>);

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('icon variant renders its icon child with an accessible name', () => {
    render(
      <CloseButton variant="icon" aria-label="Dismiss notification">
        <span>x</span>
      </CloseButton>,
    );

    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeInTheDocument();
  });

  it('defaults to type="button"', () => {
    render(<CloseButton variant="text" />);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
  });

  it('shares one muted, teal-focus-ring treatment across both variants', () => {
    const { rerender } = render(<CloseButton variant="text" />);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
      'focus-visible:ring-accent-teal',
    );

    rerender(
      <CloseButton variant="icon" aria-label="Dismiss">
        <span>x</span>
      </CloseButton>,
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
      'focus-visible:ring-accent-teal',
    );
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<CloseButton variant="text" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
