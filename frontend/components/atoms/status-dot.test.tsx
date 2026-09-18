import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { StatusDot } from './status-dot';

describe('StatusDot', () => {
  it.each(['live', 'stale', 'erroring'] as const)(
    'carries the %s state in the accessible label, never in the colour alone',
    (state) => {
      render(<StatusDot state={state} label="Personal" title="Last synced 2m ago" />);

      expect(screen.getByRole('img', { name: `Personal · ${state}` })).toBeInTheDocument();
    },
  );

  it('shows the label and the reason the caller gave for the state', () => {
    render(<StatusDot state="erroring" label="Personal" title="The token was rejected" />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.getByTitle('The token was rejected')).toBeInTheDocument();
  });

  it('shows the elapsed suffix only when one is given', () => {
    const { rerender } = render(
      <StatusDot state="stale" label="Personal" title="Last synced 2h ago" />,
    );

    expect(screen.queryByText('· 2h')).not.toBeInTheDocument();

    rerender(<StatusDot state="stale" label="Personal" title="Last synced 2h ago" elapsed="2h" />);

    expect(screen.getByText('· 2h')).toBeInTheDocument();
  });
});
