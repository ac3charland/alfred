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

  it('shows the Instapaper badge for a sent post', () => {
    render(<PostMarkers state="done" sent />);
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });

  it('shows both badges at once — the two states are independent', () => {
    // A post whose summary failed is just as sendable, so a sent-and-failed row says both.
    render(<PostMarkers state="failed" sent />);
    expect(screen.getByText('summary failed')).toBeInTheDocument();
    expect(screen.getByText('in Instapaper')).toBeInTheDocument();
  });

  it('shows no Instapaper badge for a post that has not been sent', () => {
    render(<PostMarkers state="done" sent={false} />);
    expect(screen.queryByText('in Instapaper')).not.toBeInTheDocument();
  });
});
