import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DisclosureToggle } from './disclosure-toggle';

describe('DisclosureToggle', () => {
  it('renders children and reflects aria-expanded / aria-controls', () => {
    render(
      <DisclosureToggle aria-expanded aria-controls="region-1">
        Epic name
      </DisclosureToggle>,
    );

    const button = screen.getByRole('button', { name: 'Epic name' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'region-1');
  });

  it('defaults to type="button"', () => {
    render(<DisclosureToggle>Show completed</DisclosureToggle>);

    expect(screen.getByRole('button', { name: 'Show completed' })).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('header variant renders the full-width rounded header chrome with the blue ring', () => {
    render(<DisclosureToggle variant="header">Epic name</DisclosureToggle>);

    expect(screen.getByRole('button', { name: 'Epic name' })).toHaveClass(
      'flex',
      'flex-1',
      'rounded-xl',
      'hover:bg-secondary/30',
      'focus-visible:ring-accent-blue',
    );
  });

  it('inline variant renders the muted low-contrast text toggle with the teal ring', () => {
    render(<DisclosureToggle variant="inline">Show completed (3)</DisclosureToggle>);

    expect(screen.getByRole('button', { name: 'Show completed (3)' })).toHaveClass(
      'inline-flex',
      'text-xs',
      'text-muted-foreground/70',
      'focus-visible:ring-accent-teal',
    );
  });

  it('forwards onClick', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<DisclosureToggle onClick={onClick}>Show completed</DisclosureToggle>);

    await user.click(screen.getByRole('button', { name: 'Show completed' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
