import { render, screen } from '@testing-library/react';

import { OptionButton, optionButtonVariants } from './option-button';

describe('OptionButton', () => {
  it('renders a type=button with the shared focus-ring base classes', () => {
    render(<OptionButton>Alfred</OptionButton>);
    const button = screen.getByRole('button', { name: 'Alfred' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('w-full', 'rounded-sm', 'focus-visible:ring-accent-teal');
  });

  it('uses the selected (teal) treatment when selected', () => {
    expect(optionButtonVariants({ selected: true })).toContain('bg-accent-teal/15');
    expect(optionButtonVariants({ selected: true })).toContain('text-foreground');
  });

  it('uses the muted hover treatment when not selected', () => {
    const result = optionButtonVariants({ selected: false });
    expect(result).toContain('text-muted-foreground');
    expect(result).toContain('hover:bg-secondary/60');
    expect(result).not.toContain('bg-accent-teal/15');
  });

  it('forwards aria-selected and onClick', () => {
    render(
      <OptionButton selected aria-selected role="option">
        Picked
      </OptionButton>,
    );
    expect(screen.getByRole('option', { name: 'Picked' })).toHaveAttribute('aria-selected', 'true');
  });

  it('uses the all-teal action treatment for kind="action" (no selected/muted coloring)', () => {
    const result = optionButtonVariants({ kind: 'action' });
    expect(result).toContain('text-accent-teal');
    expect(result).toContain('hover:bg-accent-teal/10');
    // The action row never gets the option row's justify-between or selected/muted coloring.
    expect(result).not.toContain('justify-between');
    expect(result).not.toContain('text-muted-foreground');
    expect(result).not.toContain('bg-accent-teal/15');
  });

  it('renders an action row as a left-aligned button', () => {
    render(<OptionButton kind="action">New project…</OptionButton>);
    const button = screen.getByRole('button', { name: 'New project…' });
    expect(button).toHaveClass('w-full', 'text-accent-teal', 'hover:bg-accent-teal/10');
    expect(button).not.toHaveClass('justify-between');
  });
});
