import { render, screen } from '@testing-library/react';

import { Badge, badgeVariants } from './badge';

describe('Badge', () => {
  it('renders its children with the shared pill base classes', () => {
    render(<Badge>3</Badge>);
    const badge = screen.getByText('3');
    expect(badge).toHaveClass('shrink-0', 'rounded-full', 'px-2', 'py-0.5', 'text-xs');
  });

  it('maps each variant to its classes via badgeVariants', () => {
    expect(badgeVariants({ variant: 'muted' })).toContain('border-border/70');
    expect(badgeVariants({ variant: 'muted' })).toContain('text-muted-foreground');
    expect(badgeVariants({ variant: 'secondary' })).toContain('bg-secondary');
    expect(badgeVariants({ variant: 'accent' })).toContain('bg-accent-teal/15');
    expect(badgeVariants({ variant: 'accent' })).toContain('text-accent-teal');
    expect(badgeVariants({ variant: 'alert' })).toContain('bg-amber-500/15');
    expect(badgeVariants({ variant: 'alert' })).toContain('text-amber-400');
    expect(badgeVariants({ variant: 'destructive' })).toContain('bg-destructive/15');
    expect(badgeVariants({ variant: 'destructive' })).toContain('text-destructive');
  });

  it('applies the muted variant by default', () => {
    render(<Badge>Task</Badge>);
    expect(screen.getByText('Task')).toHaveClass('text-muted-foreground', 'border-border/70');
  });

  it('merges a caller className with the variant classes', () => {
    render(
      <Badge variant="accent" className="uppercase tracking-wide font-semibold">
        Ready
      </Badge>,
    );
    const badge = screen.getByText('Ready');
    expect(badge).toHaveClass('bg-accent-teal/15', 'uppercase', 'tracking-wide', 'font-semibold');
  });

  it('forwards arbitrary span props (e.g. data attributes, aria-label)', () => {
    render(
      <Badge aria-label="2 completed" data-factory-state="blocked">
        2
      </Badge>,
    );
    const badge = screen.getByLabelText('2 completed');
    expect(badge).toHaveAttribute('data-factory-state', 'blocked');
  });
});
