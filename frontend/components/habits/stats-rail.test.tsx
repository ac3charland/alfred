import { render, screen } from '@testing-library/react';
import * as React from 'react';

import { StatsRail } from '@/components/habits/stats-rail';
import type { HabitStats } from '@/lib/habits';

/**
 * The rail is presentational — it is handed a `HabitStats` and renders it — so it is asserted
 * with a naked `render()`. Figures are addressed through their `data-figure` hooks rather than
 * by matching a number, which is what lets the same assertions hold as the calendar moves.
 */

function stats(overrides: Partial<HabitStats> = {}): HabitStats {
  return {
    currentStreak: 33,
    longestStreak: 33,
    averageStreak: 14,
    allowanceRemaining: 1,
    hitRate: 0.9375,
    metDaysTotal: 47,
    stage: 'nearing_automaticity',
    counts: { met: 47, partial: 1, missed: 2, skipped: 0, unknown: 0 },
    ...overrides,
  };
}

/** The value a figure shows, read through the hook rather than through its neighbours. */
function figure(name: string): string {
  const element = document.querySelector(`[data-figure="${CSS.escape(name)}"]`);
  if (element === null) throw new Error(`no figure named ${name}`);
  return element.textContent;
}

describe('StatsRail', () => {
  it('shows all six figures, each with its own label and its own hook', () => {
    render(<StatsRail habitName="Morning routine" stats={stats()} />);

    expect(figure('current-streak')).toBe('33current streak');
    expect(figure('longest')).toBe('33longest');
    expect(figure('average')).toBe('14average');
    expect(figure('hit-rate')).toBe('94%hit rate');
    expect(figure('misses-left')).toBe('1misses left');
    expect(figure('formation')).toContain('Nearing Automaticity');
  });

  it('renders a null average and a null hit rate as an em dash, never as a zero', () => {
    render(
      <StatsRail
        habitName="Evening wind-down"
        stats={stats({ averageStreak: null, hitRate: null })}
      />,
    );

    expect(figure('average')).toBe('—average');
    expect(figure('hit-rate')).toBe('—hit rate');
  });

  it('names the span of the two figures whose span is otherwise ambiguous', () => {
    render(<StatsRail habitName="Morning routine" stats={stats()} />);

    expect(screen.getByTitle(/over the last 120 days/i)).toHaveAttribute('data-figure', 'hit-rate');
    expect(screen.getByTitle(/in the last 7 days/i)).toHaveAttribute('data-figure', 'misses-left');
  });

  it('carries the banked-day caption with its tilde, and spells the hedge out for the meter', () => {
    render(<StatsRail habitName="Morning routine" stats={stats()} />);

    expect(screen.getByText('47 of ~66 banked days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '47 of about 66 banked days' })).toBeInTheDocument();
  });

  it('keeps the meter and the caption in step once the marker is past', () => {
    render(<StatsRail habitName="Morning routine" stats={stats({ metDaysTotal: 82 })} />);

    expect(screen.getByText('82 banked days · past ~66')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '82 banked days, past about 66' })).toBeInTheDocument();
  });

  it('still shows misses left, at zero, for a habit that forgives nothing', () => {
    // The six figures are non-optional: a rail whose shape changes per habit is harder to scan
    // than a constant zero.
    render(<StatsRail habitName="Evening wind-down" stats={stats({ allowanceRemaining: 0 })} />);

    expect(figure('misses-left')).toBe('0misses left');
  });

  it('is a group named for its habit, so two stacked rails are told apart', () => {
    render(<StatsRail habitName="Morning routine" stats={stats()} />);

    expect(screen.getByRole('group', { name: 'Morning routine stats' })).toBeInTheDocument();
  });

  it('greys a dead streak rather than colouring it as a live one', () => {
    const { rerender } = render(<StatsRail habitName="Morning routine" stats={stats()} />);
    expect(document.querySelector('[data-figure="current-streak"] b')).toHaveClass(
      'text-accent-green',
    );

    rerender(<StatsRail habitName="Morning routine" stats={stats({ currentStreak: 0 })} />);
    expect(document.querySelector('[data-figure="current-streak"] b')).toHaveClass(
      'text-muted-foreground',
    );
  });
});
