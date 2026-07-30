import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import { EditHabitDialog } from '@/components/habits/edit-habit-dialog';
import { ApiError } from '@/lib/api-client';
import type { UpdateHabitInput } from '@/lib/api/schemas';
import type { LoggedDays } from '@/lib/habits';
import { renderWithProviders } from '@/lib/test-utils';
import type { Habit } from '@/lib/types';

const MORNING: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [
    { key: 'wake', label: 'be up by', kind: 'time', target: 420, comparator: 'lte' },
    { key: 'light', label: 'get outside for light', kind: 'boolean' },
  ],
  active_days: [1, 2, 3, 4, 5],
  allowance: 1,
  started_on: '2026-06-12',
  archived_at: null,
  sort_order: null,
  created_at: '2026-06-12T00:00:00Z',
};

/** A habit with history freezes its cadence; `{ count: 0 }` leaves every slot open. */
const WITH_HISTORY: LoggedDays = { count: 63, isExact: true };
const NO_HISTORY: LoggedDays = { count: 0, isExact: true };

function renderDialog(logged: LoggedDays = WITH_HISTORY, habit: Habit = MORNING) {
  // Typed, so the recorded call arguments below are the real input shape rather than `any`.
  const onSave = jest.fn<Promise<Habit>, [string, UpdateHabitInput]>().mockResolvedValue(habit);
  const onOpenChange = jest.fn();
  renderWithProviders(
    <EditHabitDialog habit={habit} logged={logged} onOpenChange={onOpenChange} onSave={onSave} />,
  );
  return { onSave, onOpenChange };
}

describe('EditHabitDialog — reading the habit back', () => {
  it('opens the same sentence, prefilled from the habit', () => {
    renderDialog();

    expect(screen.getByLabelText('Habit name')).toHaveValue('Morning routine');
    expect(
      screen.getByRole('button', { name: 'Edit criterion: be up by 07:00' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Edit criterion: get outside for light' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('renames a habit through one PATCH', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.clear(screen.getByLabelText('Habit name'));
    await user.type(screen.getByLabelText('Habit name'), 'Mornings');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave).toHaveBeenCalledWith('habit-1', expect.objectContaining({ name: 'Mornings' }));
  });

  // The key is what stored history hangs off, so a label or target change must not mint a new one.
  it('keeps a criterion’s key across a retarget, so logged history stays attached', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit criterion: be up by 07:00' }));
    const target = screen.getByLabelText('No later than');
    await user.clear(target);
    await user.type(target, '06:15');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      criteria: [
        { key: 'wake', label: 'be up by', kind: 'time', target: 375, comparator: 'lte' },
        { key: 'light', label: 'get outside for light', kind: 'boolean' },
      ],
    });
  });

  it('removes a criterion through its own editor', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Edit criterion: get outside for light' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      criteria: [{ key: 'wake' }],
    });
  });

  it('adds a criterion through the same kind-first flow the create dialog uses', async () => {
    const user = userEvent.setup();
    const { onSave } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Add a criterion' }));
    await user.click(screen.getByRole('button', { name: /A count/ }));
    await user.type(screen.getByLabelText('Label'), 'glasses of water');
    const target = screen.getByLabelText('At least');
    await user.clear(target);
    await user.type(target, '3');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    expect(onSave.mock.calls[0]?.[1]).toMatchObject({
      criteria: [
        { key: 'wake' },
        { key: 'light' },
        { key: 'glasses_of_water', kind: 'count', target: 3, comparator: 'gte' },
      ],
    });
  });
});

describe('EditHabitDialog — the locked cadence', () => {
  it('announces the locked state before the value', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Locked: Days: weekday' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Locked: Allowance: 1 miss a week' }),
    ).toBeInTheDocument();
    // The open forms of those slots are gone, so neither can be edited by name.
    expect(screen.queryByRole('button', { name: 'Days: weekday' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Allowance: 1 miss a week' }),
    ).not.toBeInTheDocument();
  });

  // A control that simply doesn't respond gets clicked again, and then reported as a bug.
  it('explains itself on click, naming the days at stake and what can be changed instead', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Locked: Allowance: 1 miss a week' }));

    expect(await screen.findByText('Fixed for this habit')).toBeInTheDocument();
    expect(
      screen.getByText(/63 days are already logged\. Changing your slack would rewrite/),
    ).toBeInTheDocument();
    expect(screen.getByText(/You can still change/)).toBeInTheDocument();
  });

  it('offers no weekday toggles behind the locked days slot', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Locked: Days: weekday' }));

    await screen.findByText('Fixed for this habit');
    expect(screen.queryByRole('button', { name: 'Monday' })).not.toBeInTheDocument();
  });

  // The lock protects stored history, so a habit with none has nothing to protect.
  it('leaves every slot open on a habit with no logged days', () => {
    renderDialog(NO_HISTORY);

    expect(screen.getByRole('button', { name: 'Days: weekday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allowance: 1 miss a week' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Locked:/ })).not.toBeInTheDocument();
  });

  it('quotes the route’s own refusal rather than a retry prompt it cannot act on', async () => {
    const user = userEvent.setup();
    const onSave = jest
      .fn()
      .mockRejectedValue(
        new ApiError(
          'API PATCH failed: 409',
          409,
          'allowance is fixed once a habit has history — Morning routine has 63 logged days',
        ),
      );
    renderWithProviders(
      <EditHabitDialog
        habit={MORNING}
        logged={WITH_HISTORY}
        onOpenChange={jest.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        'allowance is fixed once a habit has history — Morning routine has 63 logged days',
      ),
    ).toBeInTheDocument();
  });

  it('falls back to a generic message when the failure explains nothing', async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockRejectedValue(new Error('network down'));
    renderWithProviders(
      <EditHabitDialog
        habit={MORNING}
        logged={WITH_HISTORY}
        onOpenChange={jest.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Could not save the habit. Try again.')).toBeInTheDocument();
  });
});
