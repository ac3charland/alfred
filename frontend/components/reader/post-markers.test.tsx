import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { PostMarkers } from './post-markers';

describe('PostMarkers', () => {
  it('shows the pending badge', () => {
    render(<PostMarkers state="pending" />);
    expect(screen.getByText('summarising…')).toBeInTheDocument();
  });

  it('shows the failed badge', () => {
    render(<PostMarkers state="failed" />);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
  });

  it('shows the refused badge', () => {
    render(<PostMarkers state="refused" />);
    expect(screen.getByText('summary refused')).toBeInTheDocument();
  });

  it('shows in Instapaper for a sent post, beside any summary-state badge', () => {
    const { rerender } = render(<PostMarkers state="done" sent />);
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();

    rerender(<PostMarkers state="failed" sent />);
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
    expect(screen.getByText('summary failed')).toBeInTheDocument();
  });

  it('shows no Instapaper badge for a post never sent', () => {
    render(<PostMarkers state="pending" />);
    expect(screen.queryByText('in Instapaper')).not.toBeInTheDocument();
  });

  it('renders nothing for a done post', () => {
    const { container } = render(<PostMarkers state="done" />);
    expect(container).toBeEmptyDOMElement();
  });
});
