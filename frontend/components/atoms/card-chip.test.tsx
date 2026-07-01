import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardChip } from './card-chip';

describe('CardChip', () => {
  it('renders a button by default and forwards the click', async () => {
    const onClick = jest.fn();
    const user = userEvent.setup();
    render(
      <CardChip tone="accent" onClick={onClick}>
        Refine
      </CardChip>,
    );

    const chip = screen.getByRole('button', { name: 'Refine' });
    expect(chip).toHaveAttribute('type', 'button');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders an anchor when given an href, opening the link', () => {
    render(
      <CardChip tone="link" href="https://example.com/pr/1" target="_blank" rel="noreferrer">
        Review PR
      </CardChip>,
    );

    const link = screen.getByRole('link', { name: 'Review PR' });
    expect(link).toHaveAttribute('href', 'https://example.com/pr/1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('carries the shared chip chrome and accent focus ring', () => {
    render(<CardChip tone="accent">Chip</CardChip>);

    expect(screen.getByRole('button')).toHaveClass(
      'rounded-md',
      'border',
      'text-xs',
      'focus-visible:ring-2',
      'focus-visible:ring-accent-blue',
    );
  });

  it('applies the teal accent tone', () => {
    render(<CardChip tone="accent">Refine</CardChip>);

    expect(screen.getByRole('button')).toHaveClass(
      'border-accent-teal/40',
      'bg-accent-teal/10',
      'text-accent-teal',
    );
  });

  it('applies the muted subordinate tone', () => {
    render(<CardChip tone="subordinate">Skip</CardChip>);

    const chip = screen.getByRole('button');
    expect(chip).toHaveClass('border-border', 'text-muted-foreground');
    expect(chip).not.toHaveClass('border-accent-teal/40', 'bg-accent-teal/10');
  });

  it('applies the blue link tone', () => {
    render(
      <CardChip tone="link" href="https://example.com">
        Review PR
      </CardChip>,
    );

    expect(screen.getByRole('link')).toHaveClass(
      'border-accent-blue/40',
      'bg-accent-blue/10',
      'text-accent-blue',
    );
  });

  it('disables the button chip while a launch is in flight', () => {
    render(
      <CardChip tone="accent" disabled>
        Refine
      </CardChip>,
    );

    expect(screen.getByRole('button')).toBeDisabled();
  });
});
