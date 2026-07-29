import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { HabitsView } from '@/components/habits/habits-view';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const TODAY = '2026-07-28';

const MORNING: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [{ key: 'light', label: 'Outside for light', kind: 'boolean' }],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-07-20',
  archived_at: null,
  sort_order: null,
  created_at: '2026-07-20T00:00:00Z',
};

function renderView(habits: Habit[]) {
  return renderWithProviders(<HabitsView />, {
    habits: { habits, entries: [], today: TODAY },
  });
}

describe('HabitsView', () => {
  it('offers a way out of the empty state', async () => {
    const user = userEvent.setup();
    renderView([]);

    expect(screen.getByText('No habits yet')).toBeInTheDocument();
    // Two ways in: the page header and the empty state's own action.
    const [, fromEmptyState] = screen.getAllByRole('button', { name: /new habit/i });
    if (fromEmptyState === undefined) throw new Error('the empty state offers no way to create');
    await user.click(fromEmptyState);

    expect(screen.getByLabelText('Habit name')).toBeInTheDocument();
  });

  it('renders one card per habit, with its cadence summary and its grid', () => {
    renderView([MORNING, { ...MORNING, id: 'habit-2', name: 'Evening wind-down', allowance: 0 }]);

    expect(screen.getByRole('heading', { name: 'Morning routine' })).toBeInTheDocument();
    expect(screen.getByText('· every day · 1 miss / rolling week')).toBeInTheDocument();
    expect(screen.getByText('· every day · no misses')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Morning routine history' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Evening wind-down history' })).toBeInTheDocument();
  });

  it('gives every card its own stats rail, named for its own habit', () => {
    renderView([MORNING, { ...MORNING, id: 'habit-2', name: 'Evening wind-down', allowance: 0 }]);

    expect(screen.getByRole('group', { name: 'Morning routine stats' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Evening wind-down stats' })).toBeInTheDocument();
    expect(screen.getAllByText('current streak')).toHaveLength(2);
  });

  it('names every cell state in a legend, since six states are too many for hue alone', () => {
    renderView([MORNING]);

    for (const label of ['met', 'partial', 'missed', 'skipped', 'not logged', 'not tracked']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('opens the create dialog from the page header', async () => {
    const user = userEvent.setup();
    renderView([MORNING]);

    await user.click(screen.getByRole('button', { name: /new habit/i }));

    expect(screen.getByLabelText('Habit name')).toBeInTheDocument();
  });
});
