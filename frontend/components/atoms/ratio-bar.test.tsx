import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { RatioBar } from './ratio-bar';

/** The rendered segments, in DOM order — the bar's own children, minus the track itself. */
function segmentWidths(): string[] {
  const bar = screen.getByRole('img');
  return [...bar.children].map((child) => (child as HTMLElement).style.width);
}

describe('RatioBar', () => {
  it('sizes each segment by its share of the total', () => {
    render(
      <RatioBar
        ariaLabel="RealPlay 25 percent; Alfred 75 percent"
        segments={[
          { label: 'RealPlay', value: 1, tone: 'bg-accent-teal' },
          { label: 'Alfred', value: 3, tone: 'bg-accent-blue' },
        ]}
      />,
    );

    expect(segmentWidths()).toEqual(['25%', '75%']);
  });

  it('gives a single segment the whole track', () => {
    render(
      <RatioBar
        ariaLabel="Alfred 100 percent"
        segments={[{ label: 'Alfred', value: 4, tone: 'bg-accent-blue' }]}
      />,
    );

    expect(segmentWidths()).toEqual(['100%']);
  });

  it('drops a zero-value segment rather than drawing a sliver', () => {
    render(
      <RatioBar
        ariaLabel="RealPlay 0 percent; Alfred 100 percent"
        segments={[
          { label: 'RealPlay', value: 0, tone: 'bg-accent-teal' },
          { label: 'Alfred', value: 5, tone: 'bg-accent-blue' },
        ]}
      />,
    );

    expect(segmentWidths()).toEqual(['100%']);
  });

  it('renders an empty track — not a NaN width — when every value is zero', () => {
    render(
      <RatioBar
        ariaLabel="No pull requests"
        segments={[
          { label: 'RealPlay', value: 0, tone: 'bg-accent-teal' },
          { label: 'Alfred', value: 0, tone: 'bg-accent-blue' },
        ]}
      />,
    );

    expect(segmentWidths()).toEqual([]);
  });

  it('applies each segment its tone class', () => {
    render(
      <RatioBar
        ariaLabel="RealPlay 50 percent; Alfred 50 percent"
        segments={[
          { label: 'RealPlay', value: 1, tone: 'bg-accent-teal' },
          { label: 'Alfred', value: 1, tone: 'bg-accent-blue' },
        ]}
      />,
    );

    const [first, second] = [...screen.getByRole('img').children];
    expect(first).toHaveClass('bg-accent-teal');
    expect(second).toHaveClass('bg-accent-blue');
  });

  it('exposes the split to assistive technology and hides the decorative segments', () => {
    render(
      <RatioBar
        ariaLabel="RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests"
        segments={[
          { label: 'RealPlay', value: 3, tone: 'bg-accent-teal' },
          { label: 'Alfred', value: 6, tone: 'bg-accent-blue' },
        ]}
      />,
    );

    const bar = screen.getByRole('img', {
      name: 'RealPlay 33 percent, 3 pull requests; Alfred 67 percent, 6 pull requests',
    });
    for (const segment of bar.children) {
      expect(segment).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
