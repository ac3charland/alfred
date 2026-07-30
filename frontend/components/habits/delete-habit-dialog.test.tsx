import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { DeleteHabitDialog } from '@/components/habits/delete-habit-dialog';
import type { LoggedDays } from '@/lib/habits';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const MORNING: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-06-12',
  archived_at: null,
  sort_order: null,
  created_at: '2026-06-12T00:00:00Z',
};

function renderDialog(logged: LoggedDays, habit: Habit = MORNING) {
  const onDelete = jest.fn().mockResolvedValue(undefined);
  const onOpenChange = jest.fn();
  renderWithProviders(
    <DeleteHabitDialog
      habit={habit}
      logged={logged}
      onOpenChange={onOpenChange}
      onDelete={onDelete}
    />,
  );
  return { onDelete, onOpenChange };
}

describe('DeleteHabitDialog', () => {
  it('names the habit in its title, so the wrong card can’t be deleted by accident', () => {
    renderDialog({ count: 63, isExact: true });

    expect(screen.getByRole('heading', { name: 'Delete “Morning routine”?' })).toBeInTheDocument();
  });

  it('names the exact cost when the whole history is in hand', () => {
    renderDialog({ count: 63, isExact: true });

    expect(screen.getByText(/63 days, since 12 June/)).toBeInTheDocument();
    expect(screen.getByText('Archive it instead')).toBeInTheDocument();
  });

  // Understating what is about to be destroyed is the one direction this may not be wrong in.
  it('never overstates certainty for a habit older than the seeded window', () => {
    renderDialog({ count: 118, isExact: false }, { ...MORNING, started_on: '2026-02-03' });

    expect(screen.getByText(/at least 118 days, since 3 February/)).toBeInTheDocument();
  });

  it('says plainly when nothing is at stake', () => {
    renderDialog({ count: 0, isExact: true });

    expect(screen.getByText(/Nothing has been logged against it yet/)).toBeInTheDocument();
  });

  it('destroys the habit on confirm', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDialog({ count: 63, isExact: true });

    await user.click(screen.getByRole('button', { name: 'Delete habit' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('habit-1');
    });
  });

  it('writes nothing on cancel', async () => {
    const user = userEvent.setup();
    const { onDelete, onOpenChange } = renderDialog({ count: 63, isExact: true });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // The dangerous button must never be the one a stray Return finds.
  it('opens with focus on Cancel rather than on the destructive action', async () => {
    renderDialog({ count: 63, isExact: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
  });

  it('surfaces a failed delete rather than closing as though it worked', async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn().mockRejectedValue(new Error('nope'));
    renderWithProviders(
      <DeleteHabitDialog
        habit={MORNING}
        logged={{ count: 1, isExact: true }}
        onOpenChange={jest.fn()}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete habit' }));

    expect(await screen.findByText('Could not delete the habit. Try again.')).toBeInTheDocument();
  });

  it('stays closed with no habit to act on', () => {
    renderWithProviders(
      <DeleteHabitDialog
        habit={undefined}
        logged={{ count: 0, isExact: true }}
        onOpenChange={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.queryByRole('heading', { name: /Delete/ })).not.toBeInTheDocument();
  });
});
