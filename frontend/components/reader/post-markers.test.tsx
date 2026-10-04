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

  it('renders nothing for a done post', () => {
    const { container } = render(<PostMarkers state="done" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says a sent post is in Instapaper', () => {
    render(<PostMarkers state="done" sent />);
    expect(screen.getByText('in Instapaper')).toHaveClass('bg-secondary');
  });

  it('wears the Instapaper badge beside a summary-state badge, not instead of it', () => {
    render(<PostMarkers state="failed" sent />);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });

  it('says nothing about Instapaper for a post never sent', () => {
    render(<PostMarkers state="pending" sent={false} />);
    expect(screen.queryByText('in Instapaper')).not.toBeInTheDocument();
  });
});
