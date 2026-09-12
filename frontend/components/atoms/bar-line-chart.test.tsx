import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { BarLineChart, type BarLinePoint, niceCeiling, trendSegments } from './bar-line-chart';

/** A plottable point with only the fields a case cares about spelled out. */
function point(value: number, average: number | null, extra: Partial<BarLinePoint> = {}) {
  return { label: `w${String(value)}`, value, average, title: `${String(value)} lines`, ...extra };
}

/** The bars actually drawn, as their inline height percentages, in DOM order. */
function barHeights(): string[] {
  return [...screen.getByRole('img').querySelectorAll('div[style]')].map(
    (bar) => (bar as HTMLElement).style.height,
  );
}

function polylines(): SVGPolylineElement[] {
  return [...screen.getByRole('img').querySelectorAll('polyline')];
}

describe('niceCeiling', () => {
  it('rounds up to the next multiple of the leading digit’s magnitude', () => {
    expect(niceCeiling(6140)).toBe(7000);
    expect(niceCeiling(420)).toBe(500);
    expect(niceCeiling(3)).toBe(3);
  });

  it('leaves a value that is already a nice tick alone', () => {
    expect(niceCeiling(7000)).toBe(7000);
    expect(niceCeiling(100)).toBe(100);
  });

  it('yields zero for an empty domain rather than a divisor of zero', () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(-5)).toBe(0);
  });
});

describe('trendSegments', () => {
  it('breaks the series into separate polylines at a null average', () => {
    const segments = trendSegments(
      [point(1, 1), point(2, 2), point(3, null), point(4, 4), point(5, 5)],
      10,
    );

    // Two runs, not one line drawn straight across the gap and not a dive to the floor.
    expect(segments).toHaveLength(2);
    expect(segments[0]?.points.split(' ')).toHaveLength(2);
    expect(segments[1]?.points.split(' ')).toHaveLength(2);
  });

  it('draws nothing for a lone reading between two gaps', () => {
    expect(trendSegments([point(1, null), point(2, 2), point(3, null)], 10)).toStrictEqual([]);
  });

  it('inverts y so a higher average sits higher in the box', () => {
    const [segment] = trendSegments([point(1, 0), point(2, 10)], 10);
    const [first, second] = segment?.points.split(' ') ?? [];

    expect(first?.split(',', 2)[1]).toBe('100.00');
    expect(second?.split(',', 2)[1]).toBe('0.00');
  });
});

describe('BarLineChart', () => {
  it('sizes each bar by its share of the nice ceiling', () => {
    render(<BarLineChart ariaLabel="two buckets" points={[point(500, null), point(1000, null)]} />);

    // Ceiling is 1000, so the buckets land at half and full height.
    expect(barHeights()).toStrictEqual(['50%', '100%']);
  });

  it('draws no bar at all for a zero bucket', () => {
    render(<BarLineChart ariaLabel="a quiet bucket" points={[point(0, null), point(100, null)]} />);

    expect(barHeights()).toStrictEqual(['100%']);
  });

  it('floors a small non-zero bucket so a quiet week is never invisible', () => {
    render(
      <BarLineChart ariaLabel="one tiny bucket" points={[point(1, null), point(9000, null)]} />,
    );

    expect(barHeights()).toStrictEqual(['2%', '100%']);
  });

  it('renders neither bars nor a line for an all-zero series', () => {
    render(
      <BarLineChart
        ariaLabel="nothing"
        points={[point(0, 0, { label: 'a' }), point(0, 0, { label: 'b' })]}
      />,
    );

    expect(barHeights()).toStrictEqual([]);
    expect(polylines()).toStrictEqual([]);
  });

  it('keeps the trend stroke uniform under the non-uniform viewBox scale', () => {
    render(<BarLineChart ariaLabel="a trend" points={[point(1, 1), point(2, 2)]} />);

    // Without this the line is visibly fat horizontally and thin vertically.
    expect(polylines()[0]).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  });

  it('dims a provisional bucket and leaves the rest solid', () => {
    render(
      <BarLineChart
        ariaLabel="a filling bucket"
        points={[point(100, 100), point(50, null, { provisional: true })]}
      />,
    );

    const [solid, dimmed] = [...screen.getByRole('img').querySelectorAll('div[style]')];
    expect(solid).toHaveClass('bg-accent-teal');
    expect(dimmed).toHaveClass('bg-accent-teal/30');
  });

  it('labels the axis maximum and every bucket', () => {
    render(<BarLineChart ariaLabel="labelled" points={[point(6140, null), point(200, null)]} />);

    expect(screen.getByText('7,000')).toBeInTheDocument();
    expect(screen.getByText('w6140')).toBeInTheDocument();
    expect(screen.getByText('w200')).toBeInTheDocument();
  });

  it('carries the caller’s description, since the plot alone holds the information', () => {
    render(<BarLineChart ariaLabel="12 weeks of lines changed" points={[point(1, 1)]} />);

    expect(screen.getByRole('img', { name: '12 weeks of lines changed' })).toBeInTheDocument();
  });

  it('reaches each bucket’s number by pointer, through the bar’s own title', () => {
    render(<BarLineChart ariaLabel="hoverable" points={[point(120, null)]} />);

    expect(screen.getByTitle('120 lines')).toBeInTheDocument();
  });
});
