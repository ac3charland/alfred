import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { PostMarkers } from './post-markers';

describe('PostMarkers', () => {
  it('shows the pending badge', () => {
    render(<PostMarkers state="pending" sent={false} />);
    expect(screen.getByText('summarising…')).toBeInTheDocument();
  });

  it('shows the failed badge', () => {
    render(<PostMarkers state="failed" sent={false} />);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
  });

  it('shows the refused badge', () => {
    render(<PostMarkers state="refused" sent={false} />);
    expect(screen.getByText('summary refused')).toBeInTheDocument();
  });

  it('renders nothing for a done post that has not been sent', () => {
    const { container } = render(<PostMarkers state="done" sent={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the secondary in Instapaper badge for a sent post', () => {
    render(<PostMarkers state="done" sent />);
    const badge = screen.getByText('in Instapaper');
    expect(badge.className).toContain('bg-secondary');
  });

  it('shows it beside a summary-state badge, not instead of one', () => {
    render(<PostMarkers state="failed" sent />);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });
});
