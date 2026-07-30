import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { ArchivedHabits } from '@/components/habits/archived-habits';
import type { HabitStats } from '@/lib/habits';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const TODAY = '2026-07-28';

const EVENING: Habit = {
  id: 'habit-1',
  name: 'Evening pages',
  notes: null,
  criteria: [{ key: 'pages', label: 'write a page', kind: 'boolean' }],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 0,
  started_on: '2026-02-03',
  archived_at: '2026-05-18T09:00:00Z',
  sort_order: null,
  created_at: '2026-02-03T00:00:00Z',
};

/**
 * The server's all-history baseline. It is the whole point of these rows: the habit ran outside
 * the seeded entry window, so a walk over the client's entries would read 0 for every figure.
 */
const BASELINE: HabitStats = {
  currentStreak: 0,
  longestStreak: 41,
  averageStreak: 12,
  allowanceRemaining: 0,
  hitRate: 0.92,
  metDaysTotal: 88,
  stage: 'possibly_established',
  counts: { met: 0, partial: 0, missed: 0, skipped: 0, unknown: 0 },
};

function renderSection(habits: Habit[], stats: Record<string, HabitStats> = {}) {
  const onUnarchive = jest.fn();
  const onDelete = jest.fn();
  renderWithProviders(
    <ArchivedHabits habits={habits} onUnarchive={onUnarchive} onDelete={onDelete} />,
    { habits: { habits, entries: [], today: TODAY, stats } },
  );
  return { onUnarchive, onDelete };
}

describe('ArchivedHabits', () => {
  it('is absent entirely when nothing is archived', () => {
    renderSection([]);

    expect(screen.queryByRole('button', { name: /Archived/ })).not.toBeInTheDocument();
  });

  it('counts the retired habits beside the disclosure, collapsed', () => {
    renderSection([EVENING, { ...EVENING, id: 'habit-2', name: 'Cold shower' }]);

    const toggle = screen.getByRole('button', { name: 'Archived (2)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('reveals one row per habit on expand, with the span it ran', async () => {
    const user = userEvent.setup();
    renderSection([EVENING]);

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));

    expect(screen.getByText('Evening pages')).toBeInTheDocument();
    expect(screen.getByText('every day · no misses · ran 3 Feb – 18 May 2026')).toBeInTheDocument();
  });

  // The figures are the seeder's whole-life stats, not a walk over a window the habit left.
  it('shows the all-history figures it finished on, never a window-derived zero', async () => {
    const user = userEvent.setup();
    renderSection([EVENING], { [EVENING.id]: BASELINE });

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));

    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('Possibly Established')).toBeInTheDocument();
  });

  // Current streak, misses left and hit rate are statements about NOW: a retired habit has none,
  // and showing a figure whose basis quietly changed is the trust bug this section avoids.
  it('shows no now-scoped figures', async () => {
    const user = userEvent.setup();
    renderSection([EVENING], { [EVENING.id]: BASELINE });

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));

    expect(screen.queryByText('current streak')).not.toBeInTheDocument();
    expect(screen.queryByText('misses left')).not.toBeInTheDocument();
    expect(screen.queryByText('hit rate')).not.toBeInTheDocument();
  });

  it('offers Unarchive as a first-class button', async () => {
    const user = userEvent.setup();
    const { onUnarchive } = renderSection([EVENING]);

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));

    expect(onUnarchive).toHaveBeenCalledWith(EVENING);
  });

  it('carries delete, and only delete, in the row’s menu', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderSection([EVENING]);

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));
    await user.click(screen.getByRole('button', { name: 'Options for Evening pages' }));

    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    await user.click(screen.getByRole('menuitem', { name: 'Delete habit…' }));

    expect(onDelete).toHaveBeenCalledWith(EVENING);
  });

  it('draws no history grid — the entries are outside the seeded window', async () => {
    const user = userEvent.setup();
    renderSection([EVENING]);

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));

    expect(screen.queryByRole('group', { name: /history/ })).not.toBeInTheDocument();
  });
});
