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

  it('defaults to type="button" to avoid accidental form submission', () => {
    render(<IconButton aria-label="Close" />);

    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('type', 'button');
  });

  it('respects an explicit type prop (e.g. type="submit")', () => {
    render(<IconButton aria-label="Submit" type="submit" />);

    expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('type', 'submit');
  });

  it('applies neutral tone classes by default', () => {
    render(<IconButton aria-label="Menu" />);

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass(
      'text-muted-foreground',
      'hover:text-foreground',
    );
  });

  it('applies the accent tone classes', () => {
    render(<IconButton aria-label="Star" tone="accent" />);

    expect(screen.getByRole('button', { name: 'Star' })).toHaveClass('hover:text-accent-teal');
  });

  it('applies the affirm tone classes', () => {
    render(<IconButton aria-label="Check" tone="affirm" />);

    expect(screen.getByRole('button', { name: 'Check' })).toHaveClass(
      'text-accent-teal',
      'focus-visible:ring-accent-teal',
    );
  });

  it('applies md size classes by default', () => {
    render(<IconButton aria-label="Menu" />);

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass('h-6', 'w-6');
  });

  it('applies sm size classes when size="sm"', () => {
    render(<IconButton aria-label="Menu" size="sm" />);

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass('h-5', 'w-5');
  });

  it('applies the shared base focus-ring, transition, and disabled classes', () => {
    render(<IconButton aria-label="Menu" />);

    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-offset-1',
      'focus-visible:ring-offset-background',
      'transition-colors',
      'duration-100',
      'motion-reduce:transition-none',
      'disabled:opacity-40',
      'disabled:pointer-events-none',
    );
  });

  it('exposes a stable displayName for devtools', () => {
    expect(IconButton.displayName).toBe('IconButton');
  });
});
