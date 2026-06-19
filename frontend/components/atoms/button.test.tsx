import { render, screen } from '@testing-library/react';

import { Button, buttonVariants } from './button';

describe('Button', () => {
  it('renders its children inside a button element', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('applies the accent variant classes', () => {
    render(<Button variant="accent">Capture</Button>);
    const button = screen.getByRole('button', { name: 'Capture' });
    expect(button).toHaveClass('bg-accent-teal', 'text-background', 'hover:bg-accent-teal/90');
  });

  it('maps each variant to its classes via buttonVariants', () => {
    expect(buttonVariants({ variant: 'accent' })).toContain('bg-accent-teal');
    expect(buttonVariants({ variant: 'default' })).toContain('bg-primary');
    expect(buttonVariants({ variant: 'destructive' })).toContain('bg-destructive');
  });

  it('merges a caller className with the variant classes', () => {
    render(
      <Button variant="accent" className="disabled:opacity-40">
        Capture
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Capture' });
    expect(button).toHaveClass('bg-accent-teal', 'disabled:opacity-40');
  });
});
