import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { SurfaceCard } from './surface-card';

describe('SurfaceCard', () => {
  it('renders its contents inside the shared card frame', () => {
    render(
      <SurfaceCard>
        <p>panel body</p>
      </SurfaceCard>,
    );

    const body = screen.getByText('panel body');
    expect(body).toBeInTheDocument();
    expect(body.parentElement).toHaveClass('rounded-lg', 'border', 'bg-surface');
  });

  it('heads the card when given a title, and adds the detail beside it', () => {
    render(
      <SurfaceCard title="Lines changed per week" detail="Jun 21 – Sep 12">
        <p>plot</p>
      </SurfaceCard>,
    );

    expect(screen.getByRole('heading', { name: 'Lines changed per week' })).toBeInTheDocument();
    expect(screen.getByText('Jun 21 – Sep 12')).toBeInTheDocument();
  });

  it('draws no header row at all without a title — the pane supplies its own', () => {
    render(
      <SurfaceCard>
        <p>pane</p>
      </SurfaceCard>,
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('omits the detail when only a title is given', () => {
    render(
      <SurfaceCard title="PRs merged in the last 7 days">
        <p>bar</p>
      </SurfaceCard>,
    );

    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.getByRole('heading').parentElement?.children).toHaveLength(1);
  });

  it('takes extra classes from the caller', () => {
    render(
      <SurfaceCard className="col-span-2">
        <p>wide</p>
      </SurfaceCard>,
    );

    expect(screen.getByText('wide').parentElement).toHaveClass('col-span-2');
  });
});
