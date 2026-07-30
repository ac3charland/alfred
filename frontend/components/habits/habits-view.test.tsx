import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { HabitsView } from '@/components/habits/habits-view';
import * as apiClient from '@/lib/api-client';
import { applyHabitUpdate } from '@/lib/habits';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

jest.mock('@/lib/api-client');
const mockUpdateHabit = jest.mocked(apiClient.updateHabit);

const TODAY = '2026-07-28';
const ARCHIVED_AT = `${TODAY}T09:00:00Z`;

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

/** The rows the mocked route reads back from, so a PATCH echoes the habit it was sent for. */
let seeded: Habit[] = [];

function renderView(habits: Habit[]) {
  seeded = habits;
  return renderWithProviders(<HabitsView />, {
    habits: { habits, entries: [], today: TODAY },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // The route answers with the merged row; using the SAME pure merge the route does means
  // reconcile confirms the optimistic paint rather than fighting it.
  mockUpdateHabit.mockImplementation((id, input) =>
    Promise.resolve(
      applyHabitUpdate(seeded.find((habit) => habit.id === id) ?? MORNING, input, ARCHIVED_AT),
    ),
  );
});

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

describe('HabitsView — the card menu', () => {
  it('names the menu for its own habit, so each card’s is addressable', async () => {
    const user = userEvent.setup();
    renderView([MORNING, { ...MORNING, id: 'habit-2', name: 'Evening wind-down' }]);

    await user.click(screen.getByRole('button', { name: 'Options for Morning routine' }));

    expect(screen.getByRole('menuitem', { name: 'Edit habit…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete habit…' })).toBeInTheDocument();
  });

  it('opens the edit dialog prefilled from the habit it was opened on', async () => {
    const user = userEvent.setup();
    renderView([MORNING]);

    await user.click(screen.getByRole('button', { name: 'Options for Morning routine' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit habit…' }));

    expect(screen.getByLabelText('Habit name')).toHaveValue('Morning routine');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('opens the delete confirm naming the habit, without deleting anything yet', async () => {
    const user = userEvent.setup();
    renderView([MORNING]);

    await user.click(screen.getByRole('button', { name: 'Options for Morning routine' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete habit…' }));

    expect(screen.getByRole('heading', { name: 'Delete “Morning routine”?' })).toBeInTheDocument();
    // The confirm IS the gate: opening it must not have destroyed anything.
    expect(jest.mocked(apiClient.deleteHabit)).not.toHaveBeenCalled();
  });
});

describe('HabitsView — archive and the Archived section', () => {
  const RETIRED: Habit = {
    ...MORNING,
    id: 'habit-old',
    name: 'Evening pages',
    archived_at: '2026-05-18T09:00:00Z',
    started_on: '2026-02-03',
  };

  it('keeps archived habits out of the card list and in their own section', () => {
    renderView([MORNING, RETIRED]);

    expect(screen.getByRole('heading', { name: 'Morning routine' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Evening pages' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived (1)' })).toBeInTheDocument();
  });

  // Accurate rather than tidy: there are no ACTIVE habits, which is what the empty state says.
  it('still shows the empty state when every habit is archived', () => {
    renderView([RETIRED]);

    expect(screen.getByText('No habits yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived (1)' })).toBeInTheDocument();
  });

  it('moves a habit into the Archived section on the click, with no confirm in the way', async () => {
    const user = userEvent.setup();
    renderView([MORNING]);

    await user.click(screen.getByRole('button', { name: 'Options for Morning routine' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Morning routine' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Archived (1)' })).toBeInTheDocument();
  });

  it('brings a habit back to the list from the Archived section', async () => {
    const user = userEvent.setup();
    renderView([RETIRED]);

    await user.click(screen.getByRole('button', { name: 'Archived (1)' }));
    await user.click(screen.getByRole('button', { name: 'Unarchive' }));

    expect(await screen.findByRole('heading', { name: 'Evening pages' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument();
  });
});
