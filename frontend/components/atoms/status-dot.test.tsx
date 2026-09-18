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

  it('lets the caller name the state in its own words, in place of the tone word', () => {
    render(
      <StatusDot
        state="stale"
        label="summariser"
        stateLabel="never ran"
        title="The summariser has never run"
      />,
    );

    expect(screen.getByRole('img', { name: 'summariser · never ran' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'summariser · stale' })).not.toBeInTheDocument();
  });

  it('draws the named state too, so the line reads the way it is spoken', () => {
    render(
      <StatusDot
        state="stale"
        label="summariser"
        stateLabel="never ran"
        title="The summariser has never run"
      />,
    );

    expect(screen.getByText('summariser · never ran')).toBeInTheDocument();
  });

  it('draws the bare label when the caller names no state — the tone carries it', () => {
    render(<StatusDot state="stale" label="Personal" title="Last synced 4h ago" />);

    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText('Personal · stale')).not.toBeInTheDocument();
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
