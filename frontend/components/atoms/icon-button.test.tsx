import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { IconButton } from './icon-button';

describe('IconButton', () => {
  it('renders a button with its icon children and accessible name', () => {
    render(
      <IconButton aria-label="Delete">
        <span>icon</span>
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<IconButton aria-label="Add" onClick={onClick} />);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(<IconButton aria-label="Add" onClick={onClick} disabled />);

    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the danger tone classes', () => {
    render(<IconButton aria-label="Delete" tone="danger" />);

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'hover:text-destructive',
      'focus-visible:ring-destructive',
    );
  });

  it('applies the requested size classes', () => {
    render(<IconButton aria-label="Open" size="lg" />);

    expect(screen.getByRole('button', { name: 'Open' })).toHaveClass('h-8', 'w-8');
  });

  it('merges a custom className with the variant classes', () => {
    render(<IconButton aria-label="Open" className="shrink-0" />);

    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveClass('shrink-0');
    expect(button).toHaveClass('inline-flex');
  });

  it('renders as the child element when asChild is set (for Radix triggers)', () => {
    render(
      <IconButton asChild aria-label="Home">
        <a href="/home">icon</a>
      </IconButton>,
    );

    const link = screen.getByRole('link', { name: 'Home' });
    expect(link).toHaveClass('inline-flex');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
