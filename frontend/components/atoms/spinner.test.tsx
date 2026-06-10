import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { Spinner } from './spinner';

describe('Spinner', () => {
  it('exposes a status role for assistive technology', () => {
    render(<Spinner />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('defaults to a "Loading" accessible name', () => {
    render(<Spinner />);

    expect(screen.getByRole('status')).toHaveAccessibleName('Loading');
  });

  it('uses a custom label as its accessible name', () => {
    render(<Spinner label="Saving" />);

    expect(screen.getByRole('status', { name: 'Saving' })).toBeInTheDocument();
  });

  it('animates by applying the spin class', () => {
    render(<Spinner />);

    expect(screen.getByRole('status')).toHaveClass('animate-spin');
  });

  it('merges a custom className', () => {
    render(<Spinner className="text-accent-teal" />);

    expect(screen.getByRole('status')).toHaveClass('text-accent-teal');
  });
});
