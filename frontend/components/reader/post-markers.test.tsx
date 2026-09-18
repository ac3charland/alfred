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
});
